import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaProduction } from "@/lib/mediaProductions";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { runFilm, type FilmEngines } from "@/lib/films/run";
import { resumeFilm } from "@/lib/films/engines";
import type { FilmPlan } from "@/lib/films/plan";
import { filmShotList, verdictLines, verifyFinishedFilm, type VerifyDeps, type VerifyReply } from "@/lib/films/verifyFinished";
import { CLIP_RULES } from "@/lib/videos/frameCheck";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

const plan = {
  title: "The Blue Mug", summary: "s", cast: [{ name: "Willow", kind: "character" as const, locked: "Blue coat." }],
  shots: [
    { id: "a", subject_ids: [], framing: "wide", still: "x", motion: "m", seconds: 5 },
    { id: "b", subject_ids: [], framing: "medium", still: "x", motion: "m", seconds: 5, line: "Please put the blue mug back.", transition: "fade" as const },
    { id: "c", subject_ids: [], framing: "close", still: "x", motion: "m", seconds: 5, line: "It was my grandmother's.", transition: "cut" as const },
  ],
  music: "p", credits: [],
} as unknown as FilmPlan;
const reply = (checks: VerifyReply["checks"], duration: number): VerifyReply => ({ verdict: checks.some((c) => c.status === "fail") ? "fail" : "pass", checks, file: { duration_s: duration } });
const total = filmShotList(plan).total_s;
const fakeDeps = (result: unknown, sent: Record<string, unknown>[] = [], remote = false): VerifyDeps => ({
  remote: () => remote, sleep: async () => {},
  submit: async (input) => { sent.push(input); return { id: "j1", state: "done", result }; }, job: async () => ({ id: "j1", state: "done", result }),
});

describe("film shot list", () => {
  test("starts after the title card, overlaps a blended seam, not a cut", () => {
    const list = filmShotList(plan);
    expect(list.shots.map((s) => [s.id, s.start_s, s.end_s])).toEqual([["a", 3, 8], ["b", 7.5, 12.5], ["c", 12.5, 17.5]]);
    expect(list.shots[1]!.line).toBe("Please put the blue mug back."); expect(list.shots[0]!.line).toBeUndefined();
    expect(filmShotList({ ...plan, title_card: false, credits_card: false }).shots[0]!.start_s).toBe(0);
  });
  test("a shot the person skipped is not in the list", () => {
    const skipped = { ...plan, shots: plan.shots.map((s, i) => i === 0 ? { ...s, kept: false } : s) } as unknown as FilmPlan;
    expect(filmShotList(skipped).shots.map((s) => s.id)).toEqual(["b", "c"]);
  });
});

describe("verdict lines", () => {
  const ids = ["a", "b", "c"];
  test("shots that share sound are one line, not one per pair", () => {
    const pairs = [["a", "b"], ["b", "c"], ["a", "c"]].map(([x, y]) => ({ check: "sound.copied", status: "fail", shot_id: x, other_shot_id: y }));
    expect(verdictLines(reply(pairs, total), ids)).toEqual(["Shots 1, 2 and 3 carry the same sound. Render them again."]);
  });
  test("plain lines say what is wrong and what to do, by shot number", () => {
    const lines = verdictLines(reply([
      { check: "speech.line", status: "fail", shot_id: "b", value: 0 },
      { check: "speech.line", status: "fail", shot_id: "c", other_shot_id: "b" },
      { check: "sound.copied", status: "fail", shot_id: "a", other_shot_id: "b" },
      { check: "picture.frozen", status: "fail", shot_id: "c" },
      { check: "sound.silent", status: "pass", shot_id: "a" },
    ], total), ids);
    expect(lines).toEqual([
      "Shots 1 and 2 carry the same sound. Render them again.",
      "Shot 2: no speech is heard where a line is expected. Render that shot again.",
      "Shot 3: its line is heard in shot 2 instead. Render shot 3 again.",
      "Shot 3: the picture stops moving. Render that shot again.",
    ]);
    for (const line of lines) expect(line).not.toMatch(/—|LUFS|lag|ffmpeg|Stack|correlat/i);
  });
});

describe("verifyFinishedFilm", () => {
  test("sends the shot list with the lines and Home's one rule table, and returns the card lines", async () => {
    const sent: Record<string, unknown>[] = [];
    const verdict = await verifyFinishedFilm({ path: "/x/film.mp4", plan }, fakeDeps(reply([{ check: "speech.line", status: "fail", shot_id: "b", value: 0 }], total), sent));
    expect(verdict).toEqual({ checked: true, lines: ["Shot 2: no speech is heard where a line is expected. Render that shot again."], entries: [{ line: "Shot 2: no speech is heard where a line is expected. Render that shot again.", shots: ["b"] }], faults: [{ shot_id: "b", kind: "no_speech" }] });
    const input = sent[0] as { rules: Record<string, number>; expect: { shots: Array<{ id: string; line?: string }>; has_audio: boolean } };
    expect(input.rules).toEqual({ blackLuma: CLIP_RULES.blackLuma, blackSeconds: CLIP_RULES.blackSeconds, frozenDiff: CLIP_RULES.frozenDiff, frozenSeconds: CLIP_RULES.frozenSeconds });
    expect(input.expect.shots.map((s) => s.line)).toEqual([undefined, "Please put the blue mug back.", "It was my grandmother's."]);
  });
  test("a clean film is checked with no lines", async () => { expect(await verifyFinishedFilm({ path: "/x", plan }, fakeDeps(reply([], total)))).toEqual({ checked: true, lines: [], entries: [], faults: [] }); });
  test("a file whose length is not what the plan adds up to is not checked, never wrongly failed", async () => {
    expect(await verifyFinishedFilm({ path: "/x", plan }, fakeDeps(reply([{ check: "speech.line", status: "fail", shot_id: "b", value: 0 }], total + 9)))).toEqual({ checked: false, lines: [] });
  });
  test("a remote Stack, a failed job and a thrown error all mean not checked", async () => {
    expect((await verifyFinishedFilm({ path: "/x", plan }, fakeDeps(reply([], total), [], true))).checked).toBe(false);
    expect((await verifyFinishedFilm({ path: "/x", plan }, { ...fakeDeps(null), submit: async () => ({ id: "j", state: "failed" }) })).checked).toBe(false);
    expect((await verifyFinishedFilm({ path: "/x", plan }, { ...fakeDeps(null), submit: async () => { throw new Error("down"); } })).checked).toBe(false);
  });
});

function person(id: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role: "adult", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((row) => row.id === id)!;
}
describe("the film runner reports the verdict on the film's own card", () => {
  beforeEach(() => resetDb());
  const engines = (actor: PersonRow, verify?: FilmEngines["verifyCut"]): FilmEngines => ({
    async waitForIdle() {}, async ensureSubject(i) { return createMediaSubject(actor, { name: i.name, kind: i.kind, look: i.locked }).id; },
    async makeStill({ shot }) { return `picture:${shot.id}`; }, async makeClip({ shot }) { return `clip:${shot.id}`; }, async makeMusic() { return "music-1"; }, async assemble() { return "cut-1"; },
    ...(verify ? { verifyCut: verify } : {}),
  });
  test("lines land in the note, the film still finishes", async () => {
    const actor = person("film-owner"); const production = createMediaProduction(actor, { title: "Draft" });
    const e = engines(actor, async ({ cutFileId }) => { expect(cutFileId).toBe("cut-1"); return { checked: true, lines: ["Shot 2: no speech is heard where a line is expected. Render that shot again."] }; });
    const result = await runFilm({ actor, productionId: production.id, plan, engines: e, signal: new AbortController().signal });
    expect(result.finished_cut_file_ids).toEqual(["cut-1"]);
    expect(e.note).toBe("Shot 2: no speech is heard where a line is expected. Render that shot again.");
  });
  test("a check that throws, or an unchecked film, adds nothing and never fails the film", async () => {
    const actor = person("film-owner"); const production = createMediaProduction(actor, { title: "Draft" });
    const e = engines(actor, async () => { throw new Error("stack down"); });
    expect((await runFilm({ actor, productionId: production.id, plan, engines: e, signal: new AbortController().signal })).finished_cut_file_ids).toEqual(["cut-1"]);
    expect(e.note).toBeUndefined();
  });
  test("resumeFilm uses the engines it is given, so the note the card saves is the one the run wrote (found on the real run: a resumed film's notes were lost)", async () => {
    const actor = person("film-owner"); const production = createMediaProduction(actor, { title: "Draft" });
    const e = engines(actor, async () => ({ checked: true, lines: ["Shot 1: the picture goes black. Render that shot again."] }));
    await resumeFilm({ actor, productionId: production.id, plan, signal: new AbortController().signal, engines: e });
    expect(e.note).toBe("Shot 1: the picture goes black. Render that shot again.");
  });
});

describe("VF-REPAIR-01 slice 1: the faults the repair rule acts on", () => {
  const ids = ["shot-1", "shot-2", "shot-3", "shot-4"];
  const reply = (checks: Array<Record<string, unknown>>) => ({ verdict: "fail" as const, checks: checks as never, file: { duration_s: 20 } });
  test("a missing line, silence, copied sound, a frozen picture and a black picture map to one fault each, in shot order; other failures stay plain lines only", async () => {
    const { faultsOf } = await import("@/lib/films/verifyFinished");
    expect(faultsOf(reply([
      { check: "picture.frozen", status: "fail", shot_id: "shot-4" },
      { check: "speech.line", status: "fail", shot_id: "shot-2", value: 0 },
      { check: "sound.silent", status: "fail", shot_id: "shot-2" },
      { check: "sound.copied", status: "fail", shot_id: "shot-3", other_shot_id: "shot-1" },
      { check: "picture.black", status: "fail", shot_id: "shot-1" },
      { check: "speech.line", status: "fail", shot_id: "shot-2", value: 2 },
      { check: "sound.quiet", status: "fail", shot_id: "shot-3" },
      { check: "picture.frozen", status: "pass", shot_id: "shot-3" },
    ]), ids)).toEqual([
      { shot_id: "shot-1", kind: "copied_sound" }, { shot_id: "shot-1", kind: "black" },
      { shot_id: "shot-2", kind: "no_speech" },
      { shot_id: "shot-3", kind: "copied_sound" },
      { shot_id: "shot-4", kind: "frozen" },
    ]);
  });
  test("a fault on a shot that is not in the film is dropped", async () => {
    const { faultsOf } = await import("@/lib/films/verifyFinished");
    expect(faultsOf(reply([{ check: "picture.frozen", status: "fail", shot_id: "shot-9" }]), ids)).toEqual([]);
  });
});

describe("the verdict lines know which shots they are about", () => {
  test("each line carries the shots it names (a copied-sound group names every shot of the group), so a repair can drop exactly its own", async () => {
    const { verdictEntries } = await import("@/lib/films/verifyFinished");
    const ids = ["shot-1", "shot-2", "shot-3", "shot-4"];
    const entries = verdictEntries({ verdict: "fail", file: { duration_s: 20 }, checks: [
      { check: "sound.copied", status: "fail", shot_id: "shot-2", other_shot_id: "shot-3" },
      { check: "sound.quiet", status: "fail", shot_id: "shot-4" },
      { check: "shape.duration", status: "fail" },
    ] as never }, ids);
    expect(entries).toEqual([
      { line: "Shots 2 and 3 carry the same sound. Render them again.", shots: ["shot-2", "shot-3"] },
      { line: "Shot 4 is much quieter than the others. Render that shot again.", shots: ["shot-4"] },
      { line: "The finished film is not the size or length that was asked for. Make it again.", shots: [] },
    ]);
  });
});
