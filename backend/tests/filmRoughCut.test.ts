// VOICED-ROUGH-CUT-HOME-01 and FILM-ANIMATIC-01: the one builder of media.rough_cut requests in Home (lib/films/roughCut.ts).
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { StackRoughCutRequest } from "@maipai/spec/stack/ts/stack-rough-cut.js";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { createMediaProduction, setShotPicture, updateMediaProduction } from "@/lib/mediaProductions";
import { storeFile } from "@/lib/attachments";
import { ANIMATIC_FAILED_LINE, ANIMATIC_MISSING_LINE, ANIMATIC_OLD_STACK_LINE, ANIMATIC_TIMEOUT_LINE, animaticRequest, latestVoicedPreview, makeRoughCut, roughCutRequest, runRoughCutJob, voicedScript, droppedLinesNote, VOICED_NOT_AVAILABLE_LINE, type RoughCutJobDeps } from "../src/lib/films/roughCut";
import { __setStackHttpFetchForTests } from "../src/lib/films/roughCut";
import type { FilmPlan } from "../src/lib/films/plan";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";
import { owner as signedInOwner } from "./support/testAuth";

const shot = (over: Record<string, unknown>) => ({ id: "s1", still: "A lighthouse at dusk, cartoon", line: "The light came on at six.", seconds: 5, motion: "zoom in", ...over }) as never;

describe("animaticRequest (the same lengths, motion and words the animatic always had)", () => {
  test("each shot keeps its seconds, its motion words and its line as the caption; the audience is adult and no lines are voiced", () => {
    const request = animaticRequest({ cast: [], shots: [shot({}), shot({ id: "s2", motion: "pan left", line: "", seconds: 7 })] } as never, ["/m/1.png", "/m/2.png"]);
    expect(request).toEqual({ audience: "adult", shots: [
      { id: "s1", picture: "/m/1.png", seconds: 5, motion: "zoom in", caption: "The light came on at six." },
      { id: "s2", picture: "/m/2.png", seconds: 7, motion: "pan left" },
    ] });
    expect("lines" in request).toBe(false);
  });
  test("a long line is cut to 200 characters like before", () => {
    expect(animaticRequest({ cast: [], shots: [shot({ line: "x".repeat(300) })] } as never, ["/m/1.png"]).shots[0]!.caption).toHaveLength(200);
  });
});

describe("runRoughCutJob (one Stack job, one plain line on any failure)", () => {
  let clock = 0;
  const deps = (over: Partial<RoughCutJobDeps> = {}): RoughCutJobDeps => ({
    submit: async () => ({ id: "j1", state: "queued" }), job: async () => ({ id: "j1", state: "done", result: { file: "/stack/out.mp4", total_s: 12 } }),
    cancel: async () => undefined, sleep: async () => { clock += 500; }, now: () => clock, readFile: () => new Uint8Array([1, 2, 3]), ...over,
  });
  const request = animaticRequest({ cast: [], shots: [shot({})] } as never, ["/m/1.png"]);
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
    const request = roughCutRequest({ cast: [], shots } as never, shots.map((_, i) => `/m/${i}.png`), script);
    expect(StackRoughCutRequest.safeParse(request).success).toBe(true);
    expect(request.audience).toBe("adult");
    expect(request.lines!.map((l) => l.shot_id)).toEqual(shots.map((s) => s.id));
    expect(request.voices).toHaveLength(1);
    expect(request.shots.every((s) => !("caption" in s))).toBe(true);
  });
  test("a shot whose line is spoken carries no caption; a shot with a dropped line keeps its words as the caption", () => {
    const request = roughCutRequest({ cast: [], shots: [shot({ id: "a" }), shot({ id: "b" })] } as never, ["/1.png", "/2.png"], { lines: [{ shot_id: "a", line: { speaker: "Willow", text: "The light came on at six." } }], voices: [{ speaker: "Willow" }] });
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
  test("FILM-NO-CHILD-DISTINCTION-01: a real subject (a photo of a person, a household child included) is voiced like any other speaker: no minor flag, the household's address", async () => {
    const subject = createMediaSubject(sage, { name: "Willow", kind: "character", look: "A woman in a blue coat.", real: true });
    const plan = planOf(sixShots, [{ name: "Willow", kind: "character", locked: "Blue coat.", subject_id: subject.id }]);
    const { script, dropped } = await voicedScript(sage, plan);
    expect(dropped).toBe(0);
    expect(script.voices).toEqual([{ speaker: "Willow" }]);
    expect(script.voices.every((voice) => !("minor" in voice))).toBe(true);
  });
});

describe("FILM-LINES-01 slice 2: an exchange in one shot, one voice per speaker", () => {
  const two = [{ name: "Willow", kind: "character", locked: "Blue coat." }, { name: "Marlow", kind: "character", locked: "Green scarf." }];
  const exchange = (extra: Record<string, unknown> = {}) => sixShots.map((s) => (s.id === "shot-2" ? { ...Object.fromEntries(Object.entries(s).filter(([key]) => key !== "line")), lines: [{ speaker: "Willow", text: "Is that mine?" }, { speaker: "Marlow", text: "It was never yours." }, { speaker: "Narration", text: "They both laughed." }], ...extra } : Object.fromEntries(Object.entries(s).filter(([key]) => key !== "line"))));
  test("every line of the shot is sent in order under the one shot id, with one voice entry per speaker", async () => {
    const { script, dropped } = await voicedScript(sage, planOf(exchange(), two));
    expect(dropped).toBe(0);
    expect(script.lines).toEqual([
      { shot_id: "shot-2", line: { speaker: "Willow", text: "Is that mine?" } },
      { shot_id: "shot-2", line: { speaker: "Marlow", text: "It was never yours." } },
      { shot_id: "shot-2", line: { speaker: "Narration", text: "They both laughed." } },
    ]);
    expect(script.voices.map((voice) => voice.speaker)).toEqual(["Willow", "Marlow", "Narration"]);
    const request = roughCutRequest(planOf(exchange(), two), sixShots.map((_, i) => `/m/${i}.png`), script);
    expect(StackRoughCutRequest.safeParse(request).success).toBe(true);
    expect(request.shots.find((entry) => entry.id === "shot-2")!.caption).toBeUndefined();
  });
  test("FILM-NO-CHILD-DISTINCTION-01: no speaker in an exchange carries a minor flag, whoever they are", async () => {
    const real = createMediaSubject(sage, { name: "Marlow", kind: "character", look: "A woman.", real: true });
    const cast = [two[0]!, { ...two[1]!, subject_id: real.id }];
    const { script } = await voicedScript(sage, planOf(exchange(), cast));
    expect(script.voices.find((voice) => voice.speaker === "Marlow")).toEqual({ speaker: "Marlow" });
    expect(script.voices.every((voice) => !("minor" in voice) && !("voice_reference" in voice))).toBe(true);
  });
  test("one line the text gate refuses drops ALL of that shot's lines, counted, and the other shots stay", async () => {
    const plan = planOf(exchange({ lines: [{ speaker: "Willow", text: "Fine." }, { speaker: "Marlow", text: MINOR_SEXUAL }] }), two);
    const { script, dropped, droppedByShot } = await voicedScript(sage, plan);
    expect(dropped).toBe(2);
    expect(droppedByShot).toEqual([{ shot: 2, lines: 2 }]);
    expect(script.lines).toEqual([]);
    expect(script.withheld).toEqual(["shot-2"]);
  });
  test("the note counts lines and names the shot, never a speaker, an age or a filter", () => {
    expect(droppedLinesNote([{ shot: 3, lines: 1 }])).toBe("One line in shot 3 was left out of the voiced preview because it could not be used. Change that line to include it. The rest are spoken.");
    expect(droppedLinesNote([{ shot: 3, lines: 2 }, { shot: 5, lines: 1 }])).toBe("2 lines in shot 3 and 1 line in shot 5 were left out of the voiced preview because they could not be used. Change those lines to include them. The rest are spoken.");
  });
});
