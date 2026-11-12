import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaProduction, getMediaProduction } from "@/lib/mediaProductions";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { __setFilmRetryDelaysForTests, changeMusic, isTransientStackError, FilmStepError, redoShot, runFilm, type FilmEngines } from "@/lib/films/run";
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
  test("the clip before a hidden product's closing shot ends on that exact picture", async () => {
    const actor = person("film-owner"); actorForEngines = actor; const production = createMediaProduction(actor, { title: "Draft" }), calls: string[] = [], ends: Record<string, string | undefined> = {}, engines = fake(calls);
    const reveal: FilmPlan = { ...plan, cast: [...plan.cast, { name: "Mug", kind: "prop", locked: "White mug.", reveal_last: true }], shots: plan.shots.map((shot, i) => i === 2 ? { ...shot, still: "Mug on a table." } : shot) };
    engines.makeClip = async ({ shot, endStillFileId }) => { ends[shot.id] = endStillFileId; return `clip:${shot.id}`; };
    await runFilm({ actor, productionId: production.id, plan: reveal, engines, signal: new AbortController().signal });
    expect(ends).toEqual({ "shot-1": undefined, "shot-2": "picture:shot-3", "shot-3": undefined });
  });
  test("a Stack that is restarting is waited for: the step is tried again instead of ending the film", async () => {
    const actor = person("film-retry"); actorForEngines = actor; const production = createMediaProduction(actor, { title: "Draft" }), calls: string[] = [];
    __setFilmRetryDelaysForTests([1, 1, 1]);
    let stillTries = 0;
    const engines = fake(calls);
    const real = engines.makeStill.bind(engines);
    engines.makeStill = async (input, options) => { stillTries++; if (stillTries <= 2) throw Object.assign(new Error("One moment. Pictures will be back by themselves in about a minute."), { status: 503, code: "stack_restarting" }); return real(input, options); };
    try {
      const result = await runFilm({ actor, productionId: production.id, plan, engines, signal: new AbortController().signal });
      expect(stillTries).toBe(5);
      expect(result.episodes[0]?.scenes[0]?.shots.every((shot) => shot.clip_file_id)).toBe(true);
      expect(engines.note).toContain("restarting");
    } finally { __setFilmRetryDelaysForTests(null); }
  });
  test("what counts as a wait: a restarting or unavailable engine, never an ordinary failure", () => {
    expect(isTransientStackError(Object.assign(new Error("x"), { code: "unavailable" }))).toBe(true);
    expect(isTransientStackError(Object.assign(new Error("x"), { status: 503 }))).toBe(true);
    expect(isTransientStackError(new Error("The Stack is not running: the socket refused"))).toBe(true);
    expect(isTransientStackError(new Error("bad picture"))).toBe(false);
    expect(isTransientStackError(Object.assign(new Error("refused"), { status: 422 }))).toBe(false);
    expect(isTransientStackError(null)).toBe(false);
  });
  test("a restart that lasts longer than the waits, and any other error, still ends the step plainly", async () => {
    const actor = person("film-noretry"); actorForEngines = actor; const production = createMediaProduction(actor, { title: "Draft" }), calls: string[] = [];
    __setFilmRetryDelaysForTests([1, 1]);
    const engines = fake(calls);
    let tries = 0;
    engines.makeStill = async () => { tries++; throw Object.assign(new Error("down"), { status: 503 }); };
    try {
      await expect(runFilm({ actor, productionId: production.id, plan, engines, signal: new AbortController().signal })).rejects.toBeInstanceOf(FilmStepError);
      expect(tries).toBe(3);
      const other = fake([]); let otherTries = 0;
      other.makeStill = async () => { otherTries++; throw new Error("bad picture"); };
      const production2 = createMediaProduction(actor, { title: "Draft 2" });
      await expect(runFilm({ actor, productionId: production2.id, plan, engines: other, signal: new AbortController().signal })).rejects.toBeInstanceOf(FilmStepError);
      expect(otherTries).toBe(1);
    } finally { __setFilmRetryDelaysForTests(null); }
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

describe("film runner with a real model's plan (found in the first real run, 2026-11-06)", () => {
  beforeEach(() => resetDb());
  test("a cast of two and shot subject_ids that are names, not ids, still run; a failed engine keeps its cause", async () => {
    const actor = person("film-real-owner"); actorForEngines = actor;
    const real: FilmPlan = {
      ...plan,
      cast: [{ name: "Orange Cat", kind: "character", locked: "Small orange cat." }, { name: "Lighthouse", kind: "place", locked: "Tall white lighthouse." }],
      shots: [1, 2].map((n) => ({ id: `s0${n}`, subject_ids: ["Orange Cat", "Lighthouse"], framing: "wide", still: "Orange cat by the lighthouse.", motion: "Walks.", seconds: 5 })),
    };
    const production = createMediaProduction(actor, { title: "Draft" }), calls: string[] = [];
    await runFilm({ actor, productionId: production.id, plan: real, engines: fake(calls), signal: new AbortController().signal });
    expect(calls).toEqual(["cast:Orange Cat", "cast:Lighthouse", "still:s01", "still:s02", "clip:s01", "clip:s02", "music", "assemble"]);
    const second = createMediaProduction(actor, { title: "Draft two" });
    const error = await runFilm({ actor, productionId: second.id, plan: real, engines: fake([], "s02"), signal: new AbortController().signal }).catch((e) => e);
    expect(error).toBeInstanceOf(FilmStepError);
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(((error as Error).cause as Error).message).toBe("engine failed");
  });
});
