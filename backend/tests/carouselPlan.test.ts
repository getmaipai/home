import { afterEach, describe, expect, test } from "bun:test";
import { CAROUSEL_BAD_PLAN_LINE, CAROUSEL_PROMPT_MAX, CAROUSEL_UNAVAILABLE_LINE, carouselSize, parseCarouselPlan, planCarousel } from "@/lib/pictures/carouselPlan";

const reply = (look: string, scenes: string[]) => JSON.stringify({ look, scenes });
const LOOK = "Warm watercolor on cream paper, soft morning light.";

describe("parseCarouselPlan", () => {
  test("puts the scene first and the shared look after it in every prompt and keeps the first `size` scenes", () => {
    const parsed = parseCarouselPlan(reply(LOOK, ["a fox at a gate", "a fox on a hill", "a fox by a stream", "extra"]), 3);
    expect(parsed).toEqual({ ok: true, plan: { look: LOOK, prompts: [`a fox at a gate. ${LOOK}`, `a fox on a hill. ${LOOK}`, `a fox by a stream. ${LOOK}`] } });
  });
  test("reads JSON inside a code fence", () => {
    expect(parseCarouselPlan("```json\n" + reply(LOOK, ["a", "b"]) + "\n```", 2).ok).toBe(true);
  });
  test("bad JSON, a wrong shape and an empty look are refused", () => {
    expect(parseCarouselPlan("not json", 2)).toMatchObject({ ok: false });
    expect(parseCarouselPlan(JSON.stringify({ scenes: ["a", "b"] }), 2)).toMatchObject({ ok: false });
    expect(parseCarouselPlan(reply("   ", ["a", "b"]), 2)).toMatchObject({ ok: false });
  });
  test("too few scenes, empty strings and duplicates leave the set short and are refused", () => {
    expect(parseCarouselPlan(reply(LOOK, ["only one"]), 2)).toMatchObject({ ok: false });
    expect(parseCarouselPlan(reply(LOOK, ["a", "", "  ", "b"]), 3)).toMatchObject({ ok: false });
    expect(parseCarouselPlan(reply(LOOK, ["A boat", "a boat", "  A  BOAT "]), 2)).toMatchObject({ ok: false });
    expect(parseCarouselPlan(reply(LOOK, ["A boat", "a boat", "a pier"]), 2)).toMatchObject({ ok: true, plan: { prompts: [`A boat. ${LOOK}`, `a pier. ${LOOK}`] } });
  });
  test("over-long prompts are trimmed to 400 characters", () => {
    const parsed = parseCarouselPlan(reply(LOOK, ["x".repeat(900), "y".repeat(900)]), 2);
    expect(parsed.ok && parsed.plan.prompts.every((prompt) => prompt.length <= CAROUSEL_PROMPT_MAX && prompt.endsWith(LOOK))).toBe(true);
  });
});

describe("carouselSize", () => {
  test("accepts integers 2 to 8 only", () => {
    expect([1, 2, 8, 9, 2.5, "4", null, undefined].map(carouselSize)).toEqual([null, 2, 8, null, null, null, null, null]);
  });
});

describe("planCarousel", () => {
  afterEach(() => undefined);
  test("one call plans the set", async () => {
    let calls = 0;
    const result = await planCarousel({ theme: "a fox through the seasons", size: 2 }, async () => { calls += 1; return { ok: true, text: reply(LOOK, ["spring", "autumn"]) }; });
    expect(result).toMatchObject({ ok: true, plan: { prompts: [`spring. ${LOOK}`, `autumn. ${LOOK}`] } });
    expect(calls).toBe(1);
  });
  test("a bad first reply gets one repair try, and a second bad reply gives the plain line", async () => {
    const texts = ["nope", reply(LOOK, ["spring", "autumn"])];
    expect(await planCarousel({ theme: "t", size: 2 }, async () => ({ ok: true, text: texts.shift()! }))).toMatchObject({ ok: true });
    expect(await planCarousel({ theme: "t", size: 2 }, async () => ({ ok: true, text: "nope" }))).toEqual({ ok: false, line: CAROUSEL_BAD_PLAN_LINE, unavailable: false });
  });
  test("an unavailable model says one plain line", async () => {
    expect(await planCarousel({ theme: "t" }, async () => ({ ok: false, unavailable: true }))).toEqual({ ok: false, line: CAROUSEL_UNAVAILABLE_LINE, unavailable: true });
    expect(await planCarousel({ theme: "t" }, async () => { throw new Error("down"); })).toMatchObject({ ok: false, unavailable: true });
    expect(CAROUSEL_UNAVAILABLE_LINE).toBe("The planner is not available. Try again in a minute.");
  });
});
