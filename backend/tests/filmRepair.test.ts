// VF-REPAIR-01 slice 1: the bounded repair of a finished film (lib/films/repair.ts). Scripted engines; no model, no Stack.
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaProduction, getMediaProduction, setShotClip, setShotPicture, updateMediaProduction } from "@/lib/mediaProductions";
import { noteAfterRepair, repairFinishedFilm, repairLine, type RepairInput } from "@/lib/films/repair";
import type { FilmPlan } from "@/lib/films/plan";
import type { FilmFault } from "@/lib/films/verifyFinished";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

function person(id: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role: "adult", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((row) => row.id === id)!;
}
const basePlan = (marks: Record<string, boolean | undefined> = {}, repairs: Record<string, unknown> = {}): FilmPlan => ({
  title: "Crossing", summary: "A quiet crossing.", cast: [{ name: "Willow", kind: "character", locked: "Blue coat." }],
  shots: [1, 2, 3, 4].map((n) => ({ id: `shot-${n}`, subject_ids: [], framing: "wide", still: `Willow, shot ${n}.`, motion: "Moves slowly.", seconds: 5, ...(n === 2 || n === 3 ? { line: "Please put the blue mug back." } : {}), ...(marks[`shot-${n}`] !== undefined ? { kept: marks[`shot-${n}`] } : {}), ...(repairs[`shot-${n}`] ? { repair: repairs[`shot-${n}`] } : {}) })),
  music: "Soft piano.", credits: [],
}) as unknown as FilmPlan;

let actor: PersonRow, productionId: string, log: string[];
beforeEach(() => {
  resetDb(); actor = person("film-owner"); log = [];
  const production = createMediaProduction(actor, { title: "Crossing" });
  productionId = production.id;
  updateMediaProduction(actor, productionId, { episodes: [{ id: "e", title: "t", scenes: [{ id: "s", title: "t", shots: [1, 2, 3, 4].map((n) => ({ id: `shot-${n}`, subject_ids: [] })) }] }] as never, cast: [], finished_cut_file_ids: ["cut-1"] });
  for (const n of [1, 2, 3, 4]) { setShotPicture(actor.id, productionId, `shot-${n}`, `picture-${n}`); setShotClip(actor.id, productionId, `shot-${n}`, `clip-${n}`); }
});

/** Engines that script what each check says: `cutFaults` is a queue of answers for the next verifyCut calls, `clipFaults` says what a stored clip alone shows. */
function engines(over: { cutFaults?: FilmFault[][]; clipFaults?: Record<string, FilmFault[]>; takeFails?: boolean; spent?: Set<string> } = {}) {
  const cutQueue = [...(over.cutFaults ?? [[]])];
  let takes = 0;
  const e: RepairInput["engines"] = {
    async assemble({ clipFileIds }) { log.push(`assemble:${clipFileIds.join("+")}`); return `cut-${log.filter((l) => l.startsWith("assemble")).length + 1}`; },
    async makeClip({ shot, takeOf }) { takes++; log.push(`take:${shot.id}:of:${takeOf}`); if (over.takeFails) throw new Error("withheld"); return `fresh-${shot.id}-${takes}`; },
    async verifyCut() { return { checked: true, lines: [], faults: cutQueue.length ? cutQueue.shift()! : [] }; },
    async verifyClip({ clipFileId }) { return { checked: true, faults: over.clipFaults?.[clipFileId] ?? [] }; },
    say: (line) => { log.push(`say:${line}`); },
    retakeSpent: (clipFileId) => over.spent?.has(clipFileId) ?? false,
  };
  return e;
}
const run = (faults: FilmFault[], plan: FilmPlan, e: RepairInput["engines"]) => repairFinishedFilm({ actor, productionId, plan, cutId: "cut-1", musicFileId: "music-1", faults, engines: e, signal: new AbortController().signal });
const clipOf = (n: number) => getMediaProduction(actor, productionId)!.episodes[0]!.scenes[0]!.shots.find((shot) => shot.id === `shot-${n}`)!.clip_file_id;

describe("faults the cut has but the clip does not: rebuilt from the stored clips, no new take", () => {
  test("no sound where a line is expected, the clip alone is fine: the cut is put back together once and nothing is made again", async () => {
    const result = await run([{ shot_id: "shot-2", kind: "no_speech" }], basePlan(), engines({ cutFaults: [[]] }));
    expect(log.filter((l) => l.startsWith("take"))).toEqual([]);
    expect(log.filter((l) => l.startsWith("assemble"))).toEqual(["assemble:clip-1+clip-2+clip-3+clip-4"]);
    expect(log).toContain("say:Putting the film back together.");
    expect(result.acted).toBe(true); expect(result.lines).toEqual([]);
    expect(result.cutId).toBe("cut-2");
    expect(getMediaProduction(actor, productionId)!.finished_cut_file_ids).toEqual(["cut-1", "cut-2"]);
  });
  test("copied sound, the clip alone is fine: the same cheap repair", async () => {
    await run([{ shot_id: "shot-3", kind: "copied_sound" }, { shot_id: "shot-2", kind: "copied_sound" }], basePlan(), engines());
    expect(log.filter((l) => l.startsWith("take"))).toEqual([]);
    expect(log.filter((l) => l.startsWith("assemble"))).toHaveLength(1);
  });
});

describe("faults the clip itself has: one new take of that shot, then the film is put back together and checked", () => {
  test("a frozen picture on an unmarked shot: one take_of the first take, the cut is rebuilt with it and now passes", async () => {
    const result = await run([{ shot_id: "shot-3", kind: "frozen" }], basePlan(), engines({ cutFaults: [[]] }));
    expect(log.filter((l) => l.startsWith("take"))).toEqual(["take:shot-3:of:clip-3"]);
    expect(log).toContain("say:Fixing shot 3: its picture was frozen.");
    expect(result.lines).toEqual(["Shot 3 was made again and now passes."]);
    expect(clipOf(3)).toBe("fresh-shot-3-1");
    const repair = result.plan.shots[2]!.repair!;
    expect(repair).toMatchObject({ retries: 1, fault: "frozen", state: "fixed", first_clip_id: "clip-3", new_clip_id: "fresh-shot-3-1" });
    expect(getMediaProduction(actor, productionId)!.finished_cut_file_ids.at(-1)).toBe(result.cutId);
  });
  test("a missing line whose own clip has the fault is a new take, not a rebuild", async () => {
    await run([{ shot_id: "shot-2", kind: "no_speech" }], basePlan(), engines({ clipFaults: { "clip-2": [{ shot_id: "shot-2", kind: "no_speech" }] }, cutFaults: [[]] }));
    expect(log.filter((l) => l.startsWith("take"))).toEqual(["take:shot-2:of:clip-2"]);
    expect(log).toContain("say:Fixing shot 2: its line had no sound.");
  });
  test("a second failure: the first take stays in the cut, both takes are kept, the line says so and the card can offer the new take", async () => {
    const result = await run([{ shot_id: "shot-3", kind: "frozen" }], basePlan(), engines({ cutFaults: [[{ shot_id: "shot-3", kind: "frozen" }]] }));
    expect(log.filter((l) => l.startsWith("take"))).toHaveLength(1);                     // never a second new take
    expect(clipOf(3)).toBe("clip-3");                                                    // the first take is back in the cut
    expect(result.lines).toEqual(["Shot 3 still has a frozen picture after one more try. The film is ready with the first take."]);
    expect(result.plan.shots[2]!.repair).toMatchObject({ state: "failed", first_clip_id: "clip-3", new_clip_id: "fresh-shot-3-1" });
    expect(getMediaProduction(actor, productionId)!.finished_cut_file_ids.at(-1)).toBe("cut-1"); // no cut was added: the earlier one stays the film
  });
  test("a new take that fails on its own never reaches the cut", async () => {
    const result = await run([{ shot_id: "shot-3", kind: "frozen" }], basePlan(), engines({ clipFaults: { "fresh-shot-3-1": [{ shot_id: "shot-3", kind: "frozen" }] } }));
    expect(log.filter((l) => l.startsWith("assemble"))).toEqual([]);
    expect(clipOf(3)).toBe("clip-3");
    expect(result.plan.shots[2]!.repair).toMatchObject({ state: "failed", new_clip_id: "fresh-shot-3-1" });
  });
  test("a new take the lane gate withholds leaves the first take, with its line", async () => {
    const result = await run([{ shot_id: "shot-3", kind: "black" }], basePlan(), engines({ takeFails: true }));
    expect(result.lines).toEqual(["Shot 3's new take couldn't be shown, so the first take stays."]);
    expect(result.plan.shots[2]!.repair).toMatchObject({ retries: 1, state: "withheld", first_clip_id: "clip-3" });
    expect(clipOf(3)).toBe("clip-3");
  });
});

describe("whose shots may be swapped, and how many times", () => {
  test("a shot the person kept is flagged and left; a skipped shot is left out; neither is made again", async () => {
    const result = await run([{ shot_id: "shot-2", kind: "frozen" }, { shot_id: "shot-3", kind: "frozen" }], basePlan({ "shot-2": true, "shot-3": false }), engines());
    expect(log.filter((l) => l.startsWith("take") || l.startsWith("assemble"))).toEqual([]);
    expect(result.lines).toEqual(["Shot 2, which you kept, has a frozen picture. It was left as you kept it."]);
    expect(result.plan.shots[1]!.repair).toMatchObject({ state: "flagged", retries: 0 });
    expect(result.plan.shots[2]!.repair).toBeUndefined();
  });
  test("the one retry is shared: a shot that already used it (here or by the clip check's own retake) is not made again", async () => {
    const used = basePlan({}, { "shot-3": { retries: 1, fault: "frozen", state: "failed", first_clip_id: "clip-3", new_clip_id: "x" } });
    await run([{ shot_id: "shot-3", kind: "frozen" }], used, engines());
    await run([{ shot_id: "shot-4", kind: "black" }], basePlan(), engines({ spent: new Set(["clip-4"]) }));
    expect(log.filter((l) => l.startsWith("take") || l.startsWith("assemble"))).toEqual([]);
  });
  test("one pass: running the repair again on its own result changes nothing (never a loop)", async () => {
    const first = await run([{ shot_id: "shot-3", kind: "frozen" }], basePlan(), engines({ cutFaults: [[{ shot_id: "shot-3", kind: "frozen" }]] }));
    log.length = 0;
    const second = await run([{ shot_id: "shot-3", kind: "frozen" }], first.plan, engines());
    expect(log).toEqual([]); expect(second.acted).toBe(false);
  });
  test("no faults, nothing to do", async () => {
    const result = await run([], basePlan(), engines());
    expect(log).toEqual([]); expect(result).toMatchObject({ acted: false, lines: [], cutId: "cut-1" });
  });
});

test("the card lines are the architect's, word for word", () => {
  expect(repairLine(3, { retries: 1, fault: "no_speech", state: "fixed" })).toBe("Shot 3 was made again and now passes.");
  expect(repairLine(2, { retries: 0, fault: "frozen", state: "flagged" })).toBe("Shot 2, which you kept, has a frozen picture. It was left as you kept it.");
  expect(repairLine(3, { retries: 1, fault: "frozen", state: "failed" })).toBe("Shot 3 still has a frozen picture after one more try. The film is ready with the first take.");
  expect(repairLine(3, { retries: 1, fault: "black", state: "withheld" })).toBe("Shot 3's new take couldn't be shown, so the first take stays.");
});

describe("the note after a repair keeps what the repair did not settle", () => {
  const entries = [
    { line: "Shot 3 is much quieter than the others. Render that shot again.", shots: ["shot-3"] },
    { line: "Shot 2: the picture stops moving. Render that shot again.", shots: ["shot-2"] },
    { line: "Shot 4: its line is heard twice. Render that shot again.", shots: ["shot-4"] },
  ];
  const check = { lines: entries.map((entry) => entry.line), entries };
  test("the repair's lines replace the lines about the shots it dealt with; an advisory line for another shot stays, in order", () => {
    const note = noteAfterRepair({ note: `The film is ready, but I couldn't make its music. ${check.lines.join(" ")}`, check, repaired: { lines: ["Shot 2 was made again and now passes."], handled: ["shot-2"] } });
    expect(note).toBe("The film is ready, but I couldn't make its music. Shot 2 was made again and now passes. Shot 3 is much quieter than the others. Render that shot again. Shot 4: its line is heard twice. Render that shot again.");
  });
  test("a shot the repair could not touch (its retry was spent) keeps its own line; nothing handled drops nothing", () => {
    expect(noteAfterRepair({ note: check.lines.join(" "), check, repaired: { lines: [], handled: [] } })).toBe(check.lines.join(" "));
  });
  test("a note that held only the check's lines and a repair that settled all of them reads as the repair's lines alone; nothing at all is no note", () => {
    expect(noteAfterRepair({ note: check.lines[1], check: { lines: [check.lines[1]!], entries: [entries[1]!] }, repaired: { lines: [], handled: ["shot-2"] } })).toBeUndefined();
  });
  test("the repair reports the shots it dealt with: flagged, rebuilt for, and made again", async () => {
    const flagged = await run([{ shot_id: "shot-2", kind: "frozen" }], basePlan({ "shot-2": true }), engines());
    expect(flagged.handled).toEqual(["shot-2"]);
    const rebuilt = await run([{ shot_id: "shot-2", kind: "no_speech" }], basePlan(), engines());
    expect(rebuilt.handled).toEqual(["shot-2"]);
    const taken = await run([{ shot_id: "shot-3", kind: "frozen" }], basePlan(), engines({ cutFaults: [[]] }));
    expect(taken.handled).toEqual(["shot-3"]);
    const spent = await run([{ shot_id: "shot-3", kind: "frozen" }], basePlan({}, { "shot-3": { retries: 1, fault: "frozen", state: "failed", first_clip_id: "clip-3", new_clip_id: "x" } }), engines());
    expect(spent.handled).toEqual([]);
  });
});
