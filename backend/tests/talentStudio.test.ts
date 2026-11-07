import { afterEach, describe, expect, test } from "bun:test";
import { __setStackClientForTests, getStackClient } from "@/lib/stackEngine";
import { layout, renderLines, speakableText, splitAtWord } from "@/lib/talent/studio";
import type { StackClient } from "@/lib/stack/client";
import type { Line, Script, CastMember } from "@/lib/talent/types";
import type { ShowFormat } from "@maipai/spec/gen/ts/show-format.js";

afterEach(() => __setStackClientForTests(null));

function line(part: string, text: string, patch: Partial<Line["timing"]> = {}): Line {
  return { part, text, delivery: { energy: "mid", pace: "mid", tags: [] }, timing: { gap_ms: null, overlap_ms: null, cut_in_at_word: null, talked_over: null, backchannels: [], ...patch } };
}
const cast: CastMember[] = [
  { synth_id: "synth-a", part: "host", display_name: "A", persona: { filler_density: "none" } as unknown as CastMember["persona"], voice: "voice-a", minor: true, absent: null },
  { synth_id: "synth-b", part: "guest", display_name: "B", persona: { filler_density: "none" } as unknown as CastMember["persona"], voice: "voice-b", minor: true, absent: null },
];
function script(lines: Line[], goals = ["Opening", "Second segment"]): Script {
  return { title: "Test", segments: lines.length > 1 ? [{ kind: "intro", goal: goals[0]!, lines: [lines[0]!] }, { kind: "exchange", goal: goals[1]!, lines: lines.slice(1) }] : [{ kind: "intro", goal: goals[0]!, lines }] };
}
const format = { gap_ms: 250, talk_over: "lively" } as ShowFormat;

function stackFixture() {
  let next = 0;
  const results = new Map<string, unknown>();
  const client = {
    submitJob: async ({ input }: { input: Record<string, unknown> }) => {
      const id = `job-${++next}`;
      const lines = input.lines as Array<{ id: string; text: string }>;
      results.set(id, { lines: lines.map((row) => ({ id: row.id, path: `/tmp/${row.id}.wav`, duration_s: row.text.trim().split(/\s+/).length * 0.06, sha256: "hash" })) });
      return { id, state: "done", result: results.get(id), reason: null };
    },
    job: async (id: string) => ({ id, state: "done", result: results.get(id), reason: null }),
  } as unknown as StackClient;
  __setStackClientForTests(client);
  return { client, count: () => next };
}

describe("talent studio", () => {
  test("splits at a word boundary", () => expect(splitAtWord("one two three four", 3)).toEqual(["one two", "three four"]));

  test("lays out a yielding interruption", () => {
    const first = line("host", "one two three four", { cut_in_at_word: 3, overlap_ms: 400, talked_over: "yield" });
    const second = line("guest", "wait here");
    const rendered = [
      { line_id: "1-1", part: "host", clip_path: "1-a.wav", duration_ms: 1000, sha256: "a" },
      { line_id: "1-1", part: "host", clip_path: "1-b.wav", duration_ms: 800, sha256: "b" },
      { line_id: "2-1", part: "guest", clip_path: "2.wav", duration_ms: 500, sha256: "c" },
    ];
    const result = layout(script([first, second]), rendered, format);
    expect(result.tracks.find((track) => track.path === "1-a.wav")?.start_ms).toBe(0);
    expect(result.tracks.find((track) => track.path === "2.wav")?.start_ms).toBe(600);
    expect(result.tracks.some((track) => track.path === "1-b.wav")).toBe(false);
    // A clip shorter than the overlap never pushes the interrupter before time zero.
    const short = layout(script([first, second]), [{ ...rendered[0]!, duration_ms: 120 }, rendered[1]!, rendered[2]!], format);
    expect(short.tracks.find((track) => track.path === "2.wav")?.start_ms).toBe(0);
  });

  test("continues an interrupted line quietly and caps the tail", () => {
    const first = line("host", "one two three four", { cut_in_at_word: 3, overlap_ms: 400, talked_over: "continue" });
    const rendered = [
      { line_id: "1-1", part: "host", clip_path: "1-a.wav", duration_ms: 120, sha256: "a" },
      { line_id: "1-1", part: "host", clip_path: "1-b.wav", duration_ms: 1800, sha256: "b" },
      { line_id: "2-1", part: "guest", clip_path: "2.wav", duration_ms: 120, sha256: "c" },
    ];
    const tail = layout(script([first, line("guest", "wait")]), rendered, format).tracks.find((track) => track.path === "1-b.wav");
    expect(tail?.start_ms).toBe(120);
    expect(tail?.gain_db).toBe(-6);
    expect(tail?.end_ms).toBeLessThanOrEqual(1500);
  });

  test("places backchannels proportionally and chapters at segment starts", () => {
    const first = line("host", "one two three four", { backchannels: [{ part: "guest", word_index: 2, text: "right" }] });
    const result = layout(script([first, line("guest", "next")]), [
      { line_id: "1-1", part: "host", clip_path: "1.wav", duration_ms: 1000, sha256: "a" },
      { line_id: "bc-guest-4529d1d980fe", part: "guest", clip_path: "bc.wav", duration_ms: 50, sha256: "b" },
      { line_id: "2-1", part: "guest", clip_path: "2.wav", duration_ms: 200, sha256: "c" },
    ], format);
    expect(result.tracks.find((track) => track.path === "bc.wav")).toMatchObject({ start_ms: 500, gain_db: -10 });
    expect(result.chapters).toEqual([{ start_ms: 0, title: "Opening" }, { start_ms: 1250, title: "Second segment" }]);
  });

  test("uses format gaps and lets a line override them", () => {
    const result = layout({ title: "Test", segments: [{ kind: "intro", goal: "Opening", lines: [line("host", "one"), line("guest", "two", { gap_ms: 100 }), line("host", "three")] }] }, [
      { line_id: "1-1", part: "host", clip_path: "1.wav", duration_ms: 100, sha256: "a" },
      { line_id: "1-2", part: "guest", clip_path: "2.wav", duration_ms: 100, sha256: "b" },
      { line_id: "1-3", part: "host", clip_path: "3.wav", duration_ms: 100, sha256: "c" },
    ], format);
    expect(result.tracks.map((track) => track.start_ms)).toEqual([0, 350, 550]);
  });

  test("keeps supported delivery tags and strips unsupported tags", () => {
    const spoken = line("host", "That is funny. [laugh]");
    expect(speakableText(spoken, ["laugh"])).toContain("[laugh]");
    expect(speakableText(spoken, [])).not.toContain("[laugh]");
  });

  test("sends 401 lines as two jobs", async () => {
    const fixture = stackFixture();
    const lines = Array.from({ length: 401 }, (_, index) => line("host", `line ${index + 1}`));
    const rendered = await renderLines(script(lines), cast, "/tmp/talent");
    expect(fixture.count()).toBe(2);
    expect(rendered).toHaveLength(401);
    expect(getStackClient()).toBe(fixture.client);
  });
});
