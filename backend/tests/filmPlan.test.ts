import { beforeEach, describe, expect, test } from "bun:test";
import { filmOverhead, SEAM_SECONDS } from "@/lib/videos/editPlan";
import { z } from "zod";
import { __setFilmPlanCompleterForTests, FILM_PLAN_PROMPT, FILM_PLAN_RESPONSE_FORMAT, filmPlanSchema, fitPlanToLength, holdBackReveals, missingHeroScene, planFilm, shotsFor, type FilmPlan } from "@/lib/films/plan";

const productionShot = z.object({ id: z.string().min(1).max(80), subject_ids: z.array(z.string()), clip_file_id: z.string().nullable().optional(), picture_file_id: z.string().nullable().optional(), music_line_id: z.string().nullable().optional(), voice_line_id: z.string().nullable().optional() });
const goodPlan: FilmPlan = {
  title: "The Quiet Crossing", summary: "A sailor meets a sea creature at dusk.",
  cast: [{ name: "Mira", kind: "character", locked: "Blue coat, silver braid, three freckles, never a hat.", reveal_last: false }],
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

  test("a product marked reveal_last is shown, named, described and lettered only in the last shot, and never in the title", () => {
    const plan = { ...goodPlan, title: "The World's Greatest Mug", summary: "A blue mug with white lettering is made. It sits on a table.", cast: [...goodPlan.cast, { name: "Blue mug", kind: "prop" as const, locked: "blue ceramic mug with white lettering", reveal_last: true }], shots: [
      { ...goodPlan.shots[0]!, id: "a", still: "Wide shot of the factory floor. A smooth blue ceramic mug with bold white lettering rides the belt. Robotic arms swing." },
      { ...goodPlan.shots[1]!, id: "b", still: "Close on the wheel, hands shaping clay.", motion: "push in toward the blue mug" },
      { ...goodPlan.shots[0]!, id: "c", still: "Blue mug on a wooden table in morning light. The lettering reads CHEATER." },
    ] };
    const held = holdBackReveals(plan, 'A mug ad. Reveal "World\'s Greatest Cheater" only at the end.');
    for (const shot of held.shots.slice(0, 2)) { expect(`${shot.still} ${shot.motion}`.toLowerCase()).not.toMatch(/mug|lettering|cheater/); expect(shot.still.length).toBeGreaterThan(0); }
    expect(held.shots[0]!.still).toContain("Robotic arms swing.");
    expect(held.shots[2]!.still).toContain("Blue mug");
    expect(`${held.title} ${held.summary}`.toLowerCase()).not.toMatch(/mug|lettering/);
    expect(holdBackReveals({ ...plan, title: "The World's Greatest Cheater" }, 'Reveal "World\'s Greatest Cheater" at the end').title).toBe("The making of it");
    const none = { ...plan, cast: plan.cast.map((m) => ({ ...m, reveal_last: false })) };
    expect(holdBackReveals(none)).toEqual(none);
  });

  test("a planner call that gets no answer says the model was busy and that nothing was lost", async () => {
    __setFilmPlanCompleterForTests(async () => ({ ok: false, unavailable: true }));
    const result = await planFilm({ idea: "A sailor crosses the sea" });
    expect(result).toMatchObject({ ok: false, line: expect.stringContaining("Resume") });
  });

  test("a spoiled or empty plan is asked for again (up to three tries) and never planned from", async () => {
    const spoiled = JSON.stringify({ ...goodPlan, title: "T</think></s>", summary: "true" });
    const empty = JSON.stringify({ ...goodPlan, cast: [{ name: "weather", kind: "character", locked: "true", reveal_last: true }], shots: goodPlan.shots.map((shot) => ({ ...shot, still: "true" })) });
    let calls = 0;
    __setFilmPlanCompleterForTests(async () => { calls++; return { ok: true, text: calls === 1 ? spoiled : calls === 2 ? empty : JSON.stringify(goodPlan) }; });
    const result = await planFilm({ idea: "A sailor crosses the sea" });
    expect(calls).toBe(3);
    expect(result).toMatchObject({ ok: true });
    __setFilmPlanCompleterForTests(async () => ({ ok: true, text: spoiled }));
    expect(await planFilm({ idea: "A sailor crosses the sea" })).toMatchObject({ ok: false });
  });
  test("half of the quoted writing in a title still counts as the hidden writing", () => {
    const plan = { ...goodPlan, title: "The Greatest Cheater", cast: [...goodPlan.cast, { name: "White mug", kind: "prop" as const, locked: "white mug", reveal_last: true }] };
    expect(holdBackReveals(plan, 'Reveal "World\'s Greatest CHEATER" at the end').title).toBe("The making of it");
  });

  test("a request that has the actor hold the product at a place gets a shot with all three, asked for once and then written in code", async () => {
    const cast = [
      { name: "Man in apron", kind: "character" as const, locked: "a middle-aged man in a grey apron", reveal_last: false },
      { name: "Brick factory", kind: "place" as const, locked: "a red brick factory building", reveal_last: false },
      { name: "White mug", kind: "prop" as const, locked: "a white ceramic mug", reveal_last: true },
    ];
    const without = { ...goodPlan, cast, shots: ["A wide shot of the factory floor, photorealistic.", "Close on the machines, photorealistic.", "The man in an outside setting, photorealistic.", "The white mug on a table, photorealistic."].map((still, i) => ({ ...goodPlan.shots[0]!, id: `h${i}`, still, seconds: 6 })) };
    const idea = "A commercial for a mug that shows the man holding the mug outside the brick factory.";
    expect(missingHeroScene(without, idea)).not.toBeNull();
    expect(missingHeroScene(without, "A commercial for a mug.")).toBeNull();
    let calls = 0; const messages: string[] = [];
    __setFilmPlanCompleterForTests(async (request) => { calls++; messages.push(request[0]?.content ?? ""); return { ok: true, text: JSON.stringify(without) }; });
    const planned = await planFilm({ idea });
    expect(calls).toBe(2);
    expect(messages[1]).toContain("one shot must show Man in apron holding White mug at Brick factory");
    if (!planned.ok) throw new Error(planned.line);
    const hero = planned.plan.shots.at(-2)!;
    expect(hero.still).toContain("Man in apron"); expect(hero.still).toContain("Brick factory"); expect(hero.still).toContain("White mug"); expect(hero.still.toLowerCase()).toContain("holding");
    expect(planned.plan.shots.at(-1)!.still).not.toContain("Man in apron");
    expect(missingHeroScene(planned.plan, idea)).toBeNull();
  });

  test("mugs that belong to the factory shots are not stripped when another cast member shares the word", () => {
    const plan = { ...goodPlan, cast: [...goodPlan.cast, { name: "Mugs on conveyor", kind: "prop" as const, locked: "rows of unglazed mugs", reveal_last: false }, { name: "White ceramic mug", kind: "prop" as const, locked: "white mug", reveal_last: true }], shots: [
      { ...goodPlan.shots[0]!, id: "f1", still: "A wide shot of the factory floor. Rows of unglazed mugs ride the conveyor belt." },
      { ...goodPlan.shots[1]!, id: "f2", still: "Close on the forming machine." },
      { ...goodPlan.shots[0]!, id: "f3", still: "The white ceramic mug on a wooden table." },
    ] };
    expect(holdBackReveals(plan).shots[0]!.still).toContain("unglazed mugs");
  });
});
