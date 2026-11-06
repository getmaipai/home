import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaProduction, getMediaProduction, updateMediaProduction } from "@/lib/mediaProductions";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { facelessFilmPlanSchema, planFilm, __setFilmPlanCompleterForTests } from "@/lib/films/plan";
import { FilmStepError, runFilm, type FilmEngines } from "@/lib/films/run";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";
import { makeFilm, realFilmEngines } from "@/lib/films/engines";
import { storeFile } from "@/lib/attachments";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { testJpeg, testMp4 } from "./videoFixture";

function person(id: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role: "adult", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((row) => row.id === id)!;
}

const plan = {
  title: "A Quiet Crossing", summary: "A paper boat crosses a rain filled street.", cast: [],
  shots: ["one", "two"].map((id) => ({ id, subject_ids: [], framing: "wide", still: "A paper boat floats along a rain filled street.", motion: "pan left", seconds: 5, line: "Rain gathers along the quiet street as a small paper boat begins its slow journey toward the bright end of the road." })),
  music: "A soft piano theme", credits: [],
};

function engines(calls: string[], options: { blockNarration?: boolean } = {}): FilmEngines {
  return {
    async waitForIdle() {},
    async ensureSubject() { throw new Error("faceless film should have no cast"); },
    async makeStill({ shot }) { calls.push(`still:${shot.id}`); return `still:${shot.id}`; },
    async makeClip() { throw new Error("faceless film should not generate character clips"); },
    async makeNarration({ shot }) { calls.push(`narration:${shot.id}`); if (options.blockNarration) throw new Error("The narration line could not be used."); return { fileId: `voice:${shot.id}`, seconds: 6.25 }; },
    async readNarration({ fileId }) { calls.push(`read:${fileId}`); return { fileId, seconds: 6.25 }; },
    async makeMotionClip({ shot, seconds }) { calls.push(`motion:${shot.id}:${seconds}`); return `clip:${shot.id}`; },
    async makeMusic() { calls.push("music"); return "music"; },
    async assemble() { calls.push("assemble"); return "finished-film"; },
  };
}

describe("FILM-05 faceless films", () => {
  let edit: FakeEditStack;
  beforeEach(() => { edit = installFakeEditStack(); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } }))); __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]); });
  afterEach(() => { edit.restore(); __setKeyframesForTests(null); });
  beforeEach(() => resetDb());

  test("faceless planner accepts an empty cast with its JSON schema output", async () => {
    const complete = async (_messages: unknown[], options?: { response_format?: unknown }) => {
      expect((options?.response_format as { json_schema?: { name?: string } })?.json_schema?.name).toBe("faceless_film_plan");
      return { ok: true as const, text: JSON.stringify(plan) };
    };
    const result = await planFilm({ idea: "A paper boat crossing the street", faceless: true }, complete as never);
    expect(result).toMatchObject({ ok: true, plan: { cast: [] } });
    expect(facelessFilmPlanSchema.safeParse(plan).success).toBe(true);
    __setFilmPlanCompleterForTests(null);
  });

  test("orders stills, narration and motion per shot, then music and assembly", async () => {
    const actor = person("film-faceless"), production = createMediaProduction(actor, { title: "Draft" }), calls: string[] = [];
    await runFilm({ actor, productionId: production.id, plan: plan as never, faceless: true, engines: engines(calls), signal: new AbortController().signal });
    expect(calls).toEqual(["still:one", "still:two", "narration:one", "motion:one:6.85", "narration:two", "motion:two:6.85", "music", "assemble"]);
    expect(getMediaProduction(actor, production.id)?.finished_cut_file_ids).toEqual(["finished-film"]);
  });

  test("a blocked narration line stops at that shot and preserves prior progress", async () => {
    const actor = person("film-blocked"), production = createMediaProduction(actor, { title: "Draft" }), calls: string[] = [];
    const progress: Array<{ stage: string; done: number }> = [];
    const blockedEngines = engines(calls, { blockNarration: true });
    blockedEngines.onProgress = (value) => progress.push({ stage: value.stage, done: value.done });
    await expect(runFilm({ actor, productionId: production.id, plan: plan as never, faceless: true, engines: blockedEngines, signal: new AbortController().signal })).rejects.toBeInstanceOf(FilmStepError);
    expect(calls).toEqual(["still:one", "still:two", "narration:one"]);
    expect(progress).toEqual([{ stage: "stills", done: 1 }, { stage: "stills", done: 2 }]);
    expect(getMediaProduction(actor, production.id)?.episodes[0]?.scenes[0]?.shots.map((shot) => shot.picture_file_id)).toEqual(["still:one", "still:two"]);
  });

  test("the regular film still uses the generate-video engine", async () => {
    const actor = person("film-normal"), production = createMediaProduction(actor, { title: "Draft" }), calls: string[] = [];
    const regular: FilmEngines = { ...engines(calls), async ensureSubject({ name, kind, locked }) { return createMediaSubject(actor, { name, kind, look: locked }).id; }, async makeClip({ shot }) { calls.push(`clip:${shot.id}`); return `clip:${shot.id}`; } };
    await runFilm({ actor, productionId: production.id, plan: { ...plan, cast: [{ name: "Boat", kind: "prop", locked: "A paper boat." }] } as never, engines: regular, signal: new AbortController().signal });
    expect(calls).toContain("clip:one");
    expect(calls.some((call) => call.startsWith("narration:"))).toBe(false);
  });

  test("assembles a faceless film in one edit with clips then music and shared film operations", async () => {
    const actor = person("person-filmfacial"), production = createMediaProduction(actor, { title: plan.title, summary: plan.summary });
    const keep = (mediaType: string, bytes: Uint8Array, name: string) => {
      const result = storeFile(actor, { conversationId: null, turnId: null, mediaType, bytes, provenance: "test:file", retention: "kept", name, deduplicate: false });
      if (!result.ok) throw new Error(result.error);
      return result.value.id;
    };
    const clips = [keep("video/mp4", testMp4(), "one.mp4"), keep("video/mp4", testMp4(), "two.mp4")];
    const music = keep("audio/mpeg", new Uint8Array([1, 2, 3]), "music.mp3");
    updateMediaProduction(actor, production.id, { episodes: [{ id: "episode", scenes: [{ id: "scene", shots: [{ id: "one", subject_ids: [], clip_file_id: clips[0] }, { id: "two", subject_ids: [], clip_file_id: clips[1] }] }] }] });
    const engines = realFilmEngines({ actor, productionId: production.id, signal: new AbortController().signal, faceless: true });
    const id = await engines.assemble({ plan: { ...plan, look: "noir", letterbox: "2.39:1", shots: plan.shots.map((shot, i) => ({ ...shot, transition: i ? "dissolve" : undefined })) } as never, clipFileIds: clips, musicFileId: music }, { signal: new AbortController().signal });
    expect(edit.jobs).toHaveLength(1);
    expect(edit.jobs[0]!.input.inputs).toHaveLength(3);
    expect(edit.jobs[0]!.input.ops).toContainEqual({ op: "transition", kind: "dissolve", duration_s: 0.5 });
    expect(edit.jobs[0]!.input.ops.some((op) => op.op === "title_card" && op.text === plan.title)).toBe(true);
    expect(edit.jobs[0]!.input.ops.some((op) => op.op === "credits" && (op.lines as unknown[]).some((line) => (line as { name?: string }).name === "MaiPai"))).toBe(true);
    expect(edit.jobs[0]!.input.ops).toContainEqual({ op: "film_look", preset: "noir" });
    expect(edit.jobs[0]!.input.ops).toContainEqual({ op: "letterbox", ratio: "2.39:1" });
    expect(edit.jobs[0]!.input.ops).toContainEqual({ op: "audio_overlay", input: 2, gain_db: -12, clip_gain_db: 0, start_s: 0, duck: false, fade_out_s: 2 });
    expect(id).toBeTruthy();
  });

  test("refuses an overlong faceless film before submitting a job", async () => {
    const actor = person("person-filmfacelong"), production = createMediaProduction(actor, { title: plan.title, summary: plan.summary });
    const clipIds = ["clip-one", "clip-two"];
    const music = storeFile(actor, { conversationId: null, turnId: null, mediaType: "audio/mpeg", bytes: new Uint8Array([1]), provenance: "test:file", retention: "kept", name: "music", deduplicate: false });
    updateMediaProduction(actor, production.id, { episodes: [{ id: "episode", scenes: [{ id: "scene", shots: clipIds.map((clip_file_id, i) => ({ id: plan.shots[i]!.id, subject_ids: [], clip_file_id })) }] }] });
    const engines = realFilmEngines({ actor, productionId: production.id, signal: new AbortController().signal, faceless: true });
    await expect(engines.assemble({ plan: { ...plan, shots: plan.shots.map((shot) => ({ ...shot, seconds: 301 })) } as never, clipFileIds: clipIds, musicFileId: music.ok ? music.value.id : "missing" }, { signal: new AbortController().signal })).rejects.toThrow("longer than 10 minutes");
    expect(edit.jobs).toHaveLength(0);
  });

  test("withholds and does not keep a faceless edit when finished-item checks are blocked", async () => {
    const actor = person("person-filmwithheld"), production = createMediaProduction(actor, { title: plan.title, summary: plan.summary });
    const keep = (mediaType: string, bytes: Uint8Array, name: string) => {
      const result = storeFile(actor, { conversationId: null, turnId: null, mediaType, bytes, provenance: "test:file", retention: "kept", name, deduplicate: false });
      if (!result.ok) throw new Error(result.error);
      return result.value.id;
    };
    const clips = [keep("video/mp4", testMp4(), "one.mp4"), keep("video/mp4", testMp4(), "two.mp4")], music = keep("audio/mpeg", new Uint8Array([1]), "music.mp3");
    updateMediaProduction(actor, production.id, { episodes: [{ id: "episode", scenes: [{ id: "scene", shots: clips.map((clip_file_id, i) => ({ id: plan.shots[i]!.id, subject_ids: [], clip_file_id })) }] }] });
    __setAgeCheckRunnerForTests(async () => [{ ok: false as const, why: "unavailable" as const }]);
    const engines = realFilmEngines({ actor, productionId: production.id, signal: new AbortController().signal, faceless: true });
    await expect(engines.assemble({ plan: plan as never, clipFileIds: clips, musicFileId: music }, { signal: new AbortController().signal })).rejects.toThrow();
    expect(edit.jobs).toHaveLength(1);
    expect(db.select().from(people).all()).toHaveLength(1);
    expect(getMediaProduction(actor, production.id)?.finished_cut_file_ids).toEqual([]);
  });
});
