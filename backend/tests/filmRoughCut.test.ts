// VOICED-ROUGH-CUT-HOME-01 and FILM-ANIMATIC-01: the one builder of media.rough_cut requests in Home (lib/films/roughCut.ts).
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { StackRoughCutRequest } from "@maipai/spec/stack/ts/stack-rough-cut.js";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { createMediaProduction, setShotPicture, updateMediaProduction } from "@/lib/mediaProductions";
import { storeFile } from "@/lib/attachments";
import { ANIMATIC_FAILED_LINE, ANIMATIC_MISSING_LINE, ANIMATIC_OLD_STACK_LINE, ANIMATIC_TIMEOUT_LINE, animaticRequest, assumedMinor, latestVoicedPreview, makeRoughCut, roughCutRequest, runRoughCutJob, voicedScript, VOICED_NOT_AVAILABLE_LINE, type RoughCutJobDeps } from "../src/lib/films/roughCut";
import { __setStackHttpFetchForTests } from "../src/lib/films/roughCut";
import type { FilmPlan } from "../src/lib/films/plan";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";
import { owner as signedInOwner } from "./support/testAuth";

const shot = (over: Record<string, unknown>) => ({ id: "s1", still: "A lighthouse at dusk, cartoon", line: "The light came on at six.", seconds: 5, motion: "zoom in", ...over }) as never;

describe("animaticRequest (the same lengths, motion and words the animatic always had)", () => {
  test("each shot keeps its seconds, its motion words and its line as the caption; the audience is adult and no lines are voiced", () => {
    const request = animaticRequest([shot({}), shot({ id: "s2", motion: "pan left", line: "", seconds: 7 })], ["/m/1.png", "/m/2.png"]);
    expect(request).toEqual({ audience: "adult", shots: [
      { id: "s1", picture: "/m/1.png", seconds: 5, motion: "zoom in", caption: "The light came on at six." },
      { id: "s2", picture: "/m/2.png", seconds: 7, motion: "pan left" },
    ] });
    expect("lines" in request).toBe(false);
  });
  test("a long line is cut to 200 characters like before", () => {
    expect(animaticRequest([shot({ line: "x".repeat(300) })], ["/m/1.png"]).shots[0]!.caption).toHaveLength(200);
  });
});

describe("runRoughCutJob (one Stack job, one plain line on any failure)", () => {
  let clock = 0;
  const deps = (over: Partial<RoughCutJobDeps> = {}): RoughCutJobDeps => ({
    submit: async () => ({ id: "j1", state: "queued" }), job: async () => ({ id: "j1", state: "done", result: { file: "/stack/out.mp4", total_s: 12 } }),
    cancel: async () => undefined, sleep: async () => { clock += 500; }, now: () => clock, readFile: () => new Uint8Array([1, 2, 3]), ...over,
  });
  const request = animaticRequest([shot({})], ["/m/1.png"]);
  test("done: the file's bytes, its length and the wall time", async () => {
    clock = 0;
    expect(await runRoughCutJob(request, undefined, deps())).toMatchObject({ ok: true, bytes: new Uint8Array([1, 2, 3]), seconds: 12, ms: 500 });
  });
  test("a Stack older than the op (submit refused) says to update the engine, not a broken page", async () => {
    expect(await runRoughCutJob(request, undefined, deps({ submit: async () => { throw new Error("422 unknown kind at /x/y"); } }))).toEqual({ ok: false, line: ANIMATIC_OLD_STACK_LINE });
  });
  test("a failed job uses the Stack's own plain sentence when it has one, else the general line; paths never show", async () => {
    expect(await runRoughCutJob(request, undefined, deps({ job: async () => ({ id: "j1", state: "failed", reason: "A picture does not open." }) }))).toEqual({ ok: false, line: "A picture does not open." });
    expect(await runRoughCutJob(request, undefined, deps({ job: async () => ({ id: "j1", state: "failed", reason: "ENOENT /Users/x/y.png" }) }))).toEqual({ ok: false, line: ANIMATIC_FAILED_LINE });
  });
  test("a file that cannot be read back, and a job that never finishes", async () => {
    expect(await runRoughCutJob(request, undefined, deps({ readFile: () => null }))).toEqual({ ok: false, line: ANIMATIC_MISSING_LINE });
    clock = 0;
    let cancelled = false;
    expect(await runRoughCutJob(request, undefined, deps({ job: async () => ({ id: "j1", state: "running" }), cancel: async () => { cancelled = true; }, sleep: async () => { clock += 5 * 60_000; } }))).toEqual({ ok: false, line: ANIMATIC_TIMEOUT_LINE });
    expect(cancelled).toBe(true);
  });
});


// ---- voiced ----
const MINOR_SEXUAL = "a nude 12 year old girl, explicit";
let sage: PersonRow;
beforeEach(async () => { resetDb(); sage = (await signedInOwner()).row; });

const planOf = (shots: Array<Record<string, unknown>>, cast: Array<Record<string, unknown>> = [{ name: "Willow", kind: "character", locked: "Blue coat." }]) => ({ title: "T", summary: "S", cast, shots, music: "m", credits: [] }) as unknown as FilmPlan;
const sixShots = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `shot-${n}`, subject_ids: [], framing: "wide", still: `Still ${n}`, motion: ["zoom in", "zoom in", "pan left", "pan right", "zoom out", "pan left"][n - 1], seconds: 5, ...(n === 2 ? { line: "Please put the blue mug back." } : n === 3 ? { line: "It was my grandmother's." } : n === 5 ? { line: "Then we will wash it together." } : {}) }));

describe("roughCutRequest (voiced): the shared fixture's shape", () => {
  test("every shot spoken: the request is a valid StackRoughCutRequest with one line per shot and one voice entry", async () => {
    const shots = sixShots.map((s) => ({ ...s, line: s.line ?? "A quiet moment." }));
    const { script } = await voicedScript(sage, planOf(shots));
    const request = roughCutRequest(shots as never, shots.map((_, i) => `/m/${i}.png`), script);
    expect(StackRoughCutRequest.safeParse(request).success).toBe(true);
    expect(request.audience).toBe("adult");
    expect(request.lines!.map((l) => l.shot_id)).toEqual(shots.map((s) => s.id));
    expect(request.voices).toHaveLength(1);
    expect(request.shots.every((s) => !("caption" in s))).toBe(true);
  });
  test("a shot whose line is spoken carries no caption; a shot with a dropped line keeps its words as the caption", () => {
    const request = roughCutRequest([shot({ id: "a" }), shot({ id: "b" })], ["/1.png", "/2.png"], { lines: [{ shot_id: "a", line: { speaker: "Willow", text: "The light came on at six." } }], voices: [{ speaker: "Willow" }] });
    expect(request.shots.map((s) => s.caption)).toEqual([undefined, "The light came on at six."]);
  });
});

describe("voicedScript: the text gate and the minor rule", () => {
  test("a line the maker's text gate refuses is dropped and counted; the rest stay", async () => {
    const plan = planOf(sixShots.map((s) => (s.id === "shot-3" ? { ...s, line: MINOR_SEXUAL } : s)));
    const { script, dropped } = await voicedScript(sage, plan);
    expect(dropped).toBe(1);
    expect(script.lines.map((l) => l.shot_id)).toEqual(["shot-2", "shot-5"]);
  });
  test("a made-up character with no cast subject gets the household default: no address when none is chosen, no minor flag", async () => {
    const { script } = await voicedScript(sage, planOf(sixShots));
    expect(script.voices).toEqual([{ speaker: "Willow" }]);
  });
  test("a real subject from photos with no linked person is assumed minor: the voice entry is sent with no address and minor true", async () => {
    const subject = createMediaSubject(sage, { name: "Willow", kind: "character", look: "A woman in a blue coat.", real: true });
    const plan = planOf(sixShots, [{ name: "Willow", kind: "character", locked: "Blue coat.", subject_id: subject.id }]);
    const { script } = await voicedScript(sage, plan);
    expect(script.voices).toEqual([{ speaker: "Willow", minor: true }]);
  });
  test("assumedMinor: the cast's own minor flag, a real subject with no person, and a person with no readable age band", () => {
    expect(assumedMinor({ minor: true, real: false, person_id: null })).toBe(true);
    expect(assumedMinor({ minor: false, real: false, person_id: null })).toBe(false);
    expect(assumedMinor({ minor: false, real: true, person_id: null })).toBe(true);
    expect(assumedMinor({ minor: false, real: true, person_id: "person-gone" })).toBe(true);
    expect(assumedMinor({ minor: false, real: true, person_id: sage.id })).toBe(false);
  });
});

describe("makeRoughCut (voiced)", () => {
  function productionFor(plan: FilmPlan) {
    const production = createMediaProduction(sage, { title: plan.title, summary: plan.summary }, "film");
    updateMediaProduction(sage, production.id, { episodes: [{ id: "e", title: "t", scenes: [{ id: "s", title: "t", shots: plan.shots.map(({ id }) => ({ id, subject_ids: [] })) }] }] as never, cast: [] });
    for (const entry of plan.shots) {
      const saved = storeFile(sage, { conversationId: null, turnId: null, mediaType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]), provenance: "test", retention: "kept", name: "still", deduplicate: false });
      if (!saved.ok) throw new Error(saved.error);
      setShotPicture(sage.id, production.id, entry.id, saved.value.id);
    }
    return production.id;
  }
  const result = { total_s: 30, shots: sixShots.map((s, i) => ({ id: s.id, start_s: i * 5, end_s: i * 5 + 5 })), lines: [{ shot_id: "shot-2", speaker: "Willow", start_s: 5.2, length_s: 1.5, audio: "/stack/l1.wav", wave: [0.5, 1] }, { shot_id: "shot-3", speaker: "Willow", start_s: 10.2, length_s: 1.5, audio: "/stack/l2.wav" }, { shot_id: "shot-5", speaker: "Willow", start_s: 20.2, length_s: 1.5, audio: "/stack/l3.wav" }] };
  const deps = (sent: unknown[]): RoughCutJobDeps => ({
    submit: async (input) => { sent.push(input); return { id: "j1", state: "done", result: { file: "/stack/out.mp4", ...result } }; },
    job: async () => ({ id: "j1", state: "done" }), cancel: async () => undefined, sleep: async () => {}, now: () => 0, readFile: () => new Uint8Array([1, 2, 3]),
  });
  const available = () => __setStackHttpFetchForTests((async () => new Response(JSON.stringify({ media: { kinds: ["media.edit", "media.rough_cut"] } }), { status: 200 })) as unknown as typeof fetch);
  const pass = { verify: async () => ({ checked: true, lines: [] as string[] }), gate: async () => ({ ok: true as const }) };

  test("the Stack must list media.rough_cut: otherwise a plain line and nothing is sent", async () => {
    const plan = planOf(sixShots); const sent: unknown[] = [];
    __setStackHttpFetchForTests((async () => new Response(JSON.stringify({ media: { kinds: ["media.edit"] } }), { status: 200 })) as unknown as typeof fetch);
    expect(await makeRoughCut({ actor: sage, productionId: productionFor(plan), plan, voiced: true, deps: deps(sent), seams: pass })).toEqual({ ok: false, line: VOICED_NOT_AVAILABLE_LINE });
    expect(sent).toEqual([]);
    __setStackHttpFetchForTests(null);
  });
  test("a passing preview is kept with each line's own audio file and is found again; the request sent has the script and no failing line", async () => {
    const plan = planOf(sixShots.map((s) => (s.id === "shot-3" ? { ...s, line: MINOR_SEXUAL } : s))); const sent: Array<Record<string, any>> = [];
    available();
    const productionId = productionFor(plan);
    const made = await makeRoughCut({ actor: sage, productionId, plan, voiced: true, deps: deps(sent), seams: pass });
    expect(made.ok && made.note).toContain("left out");
    expect(sent[0]!.lines.map((l: any) => l.shot_id)).toEqual(["shot-2", "shot-5"]);
    expect(JSON.stringify(sent[0])).not.toContain("12 year old");
    const found = latestVoicedPreview(sage, productionId, plan);
    expect(latestVoicedPreview(sage, productionId, { shots: plan.shots.map((s) => ({ ...s, seconds: 9 })) } as never)).toBeNull(); // made from other lengths: stale
    expect(found?.fileId).toBe(made.ok ? made.fileId : "");
    expect(found?.result.lines[0]!.audio).toMatch(/^\/api\/files\/.+\/content$/);
    __setStackHttpFetchForTests(null);
  });
  test("a failed verify, an unchecked verify and a gate that withholds each hide the file: nothing is kept", async () => {
    const plan = planOf(sixShots); available();
    const productionId = productionFor(plan);
    const failedVerify = await makeRoughCut({ actor: sage, productionId, plan, voiced: true, deps: deps([]), seams: { ...pass, verify: async () => ({ checked: true, lines: ["Shot 2: its line is heard twice. Render that shot again."] }) } });
    expect(failedVerify.ok).toBe(false); expect(!failedVerify.ok && failedVerify.line).toContain("did not pass its check");
    const unchecked = await makeRoughCut({ actor: sage, productionId, plan, voiced: true, deps: deps([]), seams: { ...pass, verify: async () => ({ checked: false, lines: [] }) } });
    expect(!unchecked.ok && unchecked.line).toContain("could not be checked");
    const withheld = await makeRoughCut({ actor: sage, productionId, plan, voiced: true, deps: deps([]), seams: { ...pass, gate: async () => ({ ok: false, line: "I couldn't check that video, so I can't show it. Try again in a minute." }) } });
    expect(!withheld.ok && withheld.line).toContain("can't show it");
    expect(latestVoicedPreview(sage, productionId)).toBeNull();
    __setStackHttpFetchForTests(null);
  });
  test("a teen and a child are refused (the film is adults only) and nothing is sent", async () => {
    const plan = planOf(sixShots);
    for (const role of ["teen", "child"] as const) {
      const kid = { ...sage, role } as PersonRow; const sent: unknown[] = [];
      expect(await makeRoughCut({ actor: kid, productionId: "x", plan, voiced: true, deps: deps(sent), seams: pass })).toEqual({ ok: false, line: "That film is not available to you." });
      expect(sent).toEqual([]);
    }
  });
});
