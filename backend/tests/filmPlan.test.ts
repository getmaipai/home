import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { __setFilmPlanCompleterForTests, FILM_PLAN_PROMPT, FILM_PLAN_RESPONSE_FORMAT, filmPlanSchema, planFilm, type FilmPlan } from "@/lib/films/plan";

const productionShot = z.object({ id: z.string().min(1).max(80), subject_ids: z.array(z.string()), clip_file_id: z.string().nullable().optional(), picture_file_id: z.string().nullable().optional(), music_line_id: z.string().nullable().optional(), voice_line_id: z.string().nullable().optional() });
const goodPlan: FilmPlan = {
  title: "The Quiet Crossing", summary: "A sailor meets a sea creature at dusk.",
  cast: [{ name: "Mira", kind: "character", locked: "Blue coat, silver braid, three freckles, never a hat." }],
  shots: [
    { id: "shot-1", subject_ids: [], framing: "wide establishing", still: "Mira in a blue coat with a silver braid and three freckles, never a hat, beside a flat empty sea meeting a plain hazy sky.", motion: "The tide rolls gently.", seconds: 6, transition: "fade" },
    { id: "shot-2", subject_ids: [], framing: "calm closing wide", still: "Mira in a blue coat with a silver braid and three freckles, never a hat, walks along the shore.", motion: "The water settles.", seconds: 6 },
  ],
  music: "A quiet instrumental piano and strings score.", credits: [],
};

beforeEach(() => __setFilmPlanCompleterForTests(null));

describe("film planner", () => {
  test("returns a valid plan using schema constrained completion", async () => {
    let seenFormat: unknown;
    __setFilmPlanCompleterForTests(async (_messages, options) => { seenFormat = options?.response_format; return { ok: true, text: JSON.stringify(goodPlan) }; });
    expect(await planFilm({ idea: "A sailor meets a sea creature" })).toEqual({ ok: true, plan: goodPlan });
    expect(seenFormat).toEqual(FILM_PLAN_RESPONSE_FORMAT);
  });

  test.each([
    ["one shot", { ...goodPlan, shots: [goodPlan.shots[0]] }],
    ["seconds 30", { ...goodPlan, shots: goodPlan.shots.map((shot, i) => i ? shot : { ...shot, seconds: 30 }) }],
    ["bad transition", { ...goodPlan, shots: goodPlan.shots.map((shot, i) => i ? shot : { ...shot, transition: "spin" }) }],
  ])("repairs %s and includes validation errors", async (_name, invalid) => {
    const messages: string[] = [];
    let calls = 0;
    __setFilmPlanCompleterForTests(async (request) => { calls++; messages.push(request[0]?.content ?? ""); return { ok: true, text: JSON.stringify(calls === 1 ? invalid : goodPlan) }; });
    expect(await planFilm({ idea: "A sailor crosses the sea" })).toMatchObject({ ok: true, plan: goodPlan });
    expect(calls).toBe(2);
    expect(messages[1]).toContain("Repair the plan to satisfy these validation errors:");
    expect(messages[1]).toMatch(/shots|seconds|transition/);
  });

  test("refuses after two invalid plans in plain words", async () => {
    let calls = 0;
    __setFilmPlanCompleterForTests(async () => { calls++; return { ok: true, text: JSON.stringify({ ...goodPlan, shots: [] }) }; });
    expect(await planFilm({ idea: "A sailor crosses the sea" })).toEqual({ ok: false, line: "I couldn't plan that film. Try describing it in a sentence or two, with who is in it and where." });
    expect(calls).toBe(2);
  });

  test("prompt carries the film planning rules", () => {
    for (const phrase of ["never what is absent", "flat empty sea", "Repeat the locked description", "shot on 35mm", "wide establishing", "facing the camera", "extreme close-up", "dolly zoom", "wide retreat", "reaction shot", "calm closing wide", "real person's name", "under 12 words", "At most one character", "5 to 7 seconds", "4 to 8 shots"]) expect(FILM_PLAN_PROMPT).toContain(phrase);
  });

  test("plan shots reduce to the production shot shape and JSON schema matches zod properties", () => {
    const parsed = filmPlanSchema.parse(goodPlan);
    for (const shot of parsed.shots) {
      const { framing: _framing, still: _still, motion: _motion, seconds: _seconds, line: _line, transition: _transition, ...stored } = shot;
      expect(productionShot.safeParse(stored).success).toBe(true);
    }
    const jsonSchema = FILM_PLAN_RESPONSE_FORMAT.json_schema.schema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(jsonSchema.properties).sort()).toEqual(Object.keys(filmPlanSchema.shape).sort());
    expect(jsonSchema.required).toEqual(Object.keys(filmPlanSchema.shape));
  });
});
