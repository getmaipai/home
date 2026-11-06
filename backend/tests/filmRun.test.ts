import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaProduction, getMediaProduction } from "@/lib/mediaProductions";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { changeMusic, FilmStepError, redoShot, runFilm, type FilmEngines } from "@/lib/films/run";
import type { FilmPlan } from "@/lib/films/plan";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

function person(id: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role: "adult", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((row) => row.id === id)!;
}
const plan: FilmPlan = {
  title: "Crossing", summary: "A quiet crossing.", cast: [{ name: "Mira", kind: "character", locked: "Blue coat and silver braid." }],
  shots: [1, 2, 3].map((n) => ({ id: `shot-${n}`, subject_ids: [], framing: "wide", still: "Mira in a blue coat and silver braid.", motion: "Moves slowly.", seconds: 5 })),
  music: "Soft piano.", credits: [],
};
function fake(record: string[], failClip?: string): FilmEngines {
  let active = 0;
  const track = async (call: string) => { active++; if (active > 1) record.push("OVERLAP"); record.push(call); await Promise.resolve(); active--; };
  return {
    async waitForIdle() {},
    async ensureSubject(input) { await track(`cast:${input.name}`); return createMediaSubject(actorForEngines!, { name: input.name, kind: input.kind, look: input.locked }).id; },
    async makeStill({ shot }) { await track(`still:${shot.id}`); return `picture:${shot.id}`; },
    async makeClip({ shot }) { await track(`clip:${shot.id}`); if (shot.id === failClip) throw new Error("engine failed"); return `clip:${shot.id}`; },
    async makeMusic() { await track("music"); return "music-1"; },
    async assemble() { await track("assemble"); return "cut-1"; },
  };
}
let actorForEngines: PersonRow | null = null;
describe("film runner", () => {
  beforeEach(() => resetDb());
  test("runs in order, stores artifacts, then skips a completed film", async () => {
    const actor = person("film-owner"); actorForEngines = actor; const production = createMediaProduction(actor, { title: "Draft" }), calls: string[] = [], engines = fake(calls);
    const result = await runFilm({ actor, productionId: production.id, plan, engines, signal: new AbortController().signal });
    expect(calls).toEqual(["cast:Mira", "still:shot-1", "still:shot-2", "still:shot-3", "clip:shot-1", "clip:shot-2", "clip:shot-3", "music", "assemble"]);
    expect(result.episodes[0]?.scenes[0]?.shots.map((shot) => [shot.picture_file_id, shot.clip_file_id])).toEqual([["picture:shot-1", "clip:shot-1"], ["picture:shot-2", "clip:shot-2"], ["picture:shot-3", "clip:shot-3"]]);
    expect(result.music_line_ids).toEqual(["music-1"]); expect(result.finished_cut_file_ids).toEqual(["cut-1"]);
    calls.length = 0;
    await runFilm({ actor, productionId: production.id, plan, engines, signal: new AbortController().signal });
    expect(calls).toEqual([]);
  });
  test("a failed third clip preserves progress and resumes at that clip", async () => {
    const actor = person("film-owner"); actorForEngines = actor; const production = createMediaProduction(actor, { title: "Draft" }), calls: string[] = [];
    try { await runFilm({ actor, productionId: production.id, plan, engines: fake(calls, "shot-3"), signal: new AbortController().signal }); } catch (error) { expect(error).toBeInstanceOf(FilmStepError); }
    expect(calls.slice(-3)).toEqual(["clip:shot-1", "clip:shot-2", "clip:shot-3"]);
    const partial = getMediaProduction(actor, production.id)!;
    expect(partial.episodes[0]?.scenes[0]?.shots.map((shot) => shot.clip_file_id)).toEqual(["clip:shot-1", "clip:shot-2", undefined]);
    calls.length = 0;
    await runFilm({ actor, productionId: production.id, plan, engines: fake(calls), signal: new AbortController().signal });
    expect(calls).toEqual(["clip:shot-3", "music", "assemble"]);
  });
  test("redoShot and changeMusic limit generation to their dependencies", async () => {
    const actor = person("film-owner"); actorForEngines = actor; const production = createMediaProduction(actor, { title: "Draft" });
    await runFilm({ actor, productionId: production.id, plan, engines: fake([]), signal: new AbortController().signal });
    const calls: string[] = [];
    await redoShot({ actor, productionId: production.id, plan, shotId: "shot-2", engines: fake(calls), signal: new AbortController().signal });
    expect(calls).toEqual(["still:shot-2", "clip:shot-2", "assemble"]);
    calls.length = 0;
    await changeMusic({ actor, productionId: production.id, plan, engines: fake(calls), signal: new AbortController().signal });
    expect(calls).toEqual(["music", "assemble"]);
  });
  test("abort stops before the next engine call and refuses a non-owner", async () => {
    const owner = person("film-owner"), outsider = person("film-outsider"), production = createMediaProduction(owner, { title: "Draft" }), calls: string[] = []; actorForEngines = owner;
    await expect(runFilm({ actor: outsider, productionId: production.id, plan, engines: fake(calls), signal: new AbortController().signal })).rejects.toThrow();
    const controller = new AbortController();
    const engines = fake(calls);
    engines.ensureSubject = async () => { controller.abort(); return "subject-mira"; };
    await expect(runFilm({ actor: owner, productionId: production.id, plan, engines, signal: controller.signal })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
