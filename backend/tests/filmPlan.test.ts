import { beforeEach, describe, expect, test } from "bun:test";
import { filmOverhead, SEAM_SECONDS } from "@/lib/videos/editPlan";
import { z } from "zod";
import { __setFilmPlanCompleterForTests, FILM_PLAN_PROMPT, FILM_PLAN_RESPONSE_FORMAT, filmPlanSchema, fitPlanToLength, planFilm, shotsFor, type FilmPlan } from "@/lib/films/plan";

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

  test("sends the target length in planner data and accepts a plan in one call", async () => {
    let calls = 0;
    let userMessage = "";
    __setFilmPlanCompleterForTests(async (messages) => { calls++; userMessage = messages[1]?.content ?? ""; return { ok: true, text: JSON.stringify(goodPlan) }; });
    const planned = await planFilm({ idea: "A sailor crosses the sea", targetSeconds: 30 });
    expect(planned.ok).toBe(true);
    expect(calls).toBe(1);
    expect(JSON.parse(userMessage)).toMatchObject({ target_seconds: 30 });
  });

  test("repairs an overlong faceless narration once with measured duration and refuses a still-too-long repair", async () => {
    const longLine = "Rain gathers along the quiet street as a small paper boat begins its slow journey toward the bright end of the road while evening settles over the rooftops and lights glow in windows.";
    const veryLong = { ...goodPlan, cast: [], shots: Array.from({ length: 12 }, (_, i) => ({ ...goodPlan.shots[i % 2]!, id: `long-${i}`, motion: "pan left", line: longLine })) };
    const messages: string[] = [];
    let calls = 0;
    __setFilmPlanCompleterForTests(async (request) => { calls++; messages.push(request[0]?.content ?? ""); return { ok: true, text: JSON.stringify(veryLong) }; });
    const result = await planFilm({ idea: "A narrated boat story", faceless: true, targetSeconds: 30 });
    expect(result).toMatchObject({ ok: false, line: expect.stringContaining("I couldn't plan that film") });
    expect(calls).toBe(2);
    expect(messages[1]).toContain("The narration is about");
    expect(messages[1]).toContain("seconds; the film must fit about 22 seconds of shots");
    expect(messages[1]).toContain("Shorten each line to about");
  });

  test("does not duration-check plans without a requested length", async () => {
    let calls = 0;
    __setFilmPlanCompleterForTests(async () => { calls++; return { ok: true, text: JSON.stringify(goodPlan) }; });
    expect(await planFilm({ idea: "A sailor crosses the sea" })).toMatchObject({ ok: true, plan: goodPlan });
    expect(calls).toBe(1);
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
    expect(jsonSchema.required).toEqual(Object.keys(filmPlanSchema.shape).filter((key) => key !== "look" && key !== "letterbox" && key !== "title_card" && key !== "credits_card" && key !== "target_seconds"));
  });

  test("a plan is fitted to the asked length in code: shots plus overlaps plus the title and credits", async () => {
    for (const target of [13, 20, 30, 60, 120]) {
      const fitted = fitPlanToLength({ ...goodPlan, shots: Array.from({ length: shotsFor(target) }, (_, i) => ({ ...goodPlan.shots[i % 2]!, id: `s-${i}`, seconds: 7 })) }, target);
      const total = fitted.shots.reduce((n, s) => n + s.seconds, 0) - SEAM_SECONDS * (fitted.shots.length - 1) + filmOverhead(true, true, fitted.cast.length + 1);
      expect(Math.abs(total - target), `${target} s asked, ${total} s planned`).toBeLessThanOrEqual(1.5);
      expect(fitted.shots.every((s) => s.seconds >= 3 && s.seconds <= 10)).toBe(true);
      expect(fitted.shots[0]!.id).toBe("s-0"); expect(fitted.shots.at(-1)!.id).toBe(`s-${shotsFor(target) - 1}`);
    }
  });
});
