import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaProduction, getMediaProduction } from "@/lib/mediaProductions";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { facelessFilmPlanSchema, planFilm, __setFilmPlanCompleterForTests } from "@/lib/films/plan";
import { FilmStepError, runFilm, type FilmEngines } from "@/lib/films/run";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

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
});
