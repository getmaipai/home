import { beforeEach, describe, expect, test } from "bun:test";
import { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";
import { weatherCard } from "@/lib/packageBlocks";
import { __resetMoonForTests, cardMoon, moonTile } from "@/lib/weatherMoon";

beforeEach(() => __resetMoonForTests());

describe("moonTile", () => {
  test("turns the almanac fraction into a whole percent", async () => {
    expect(await moonTile(async () => ({ phase: "Waxing Gibbous", illumination: 0.874 }))).toEqual({ phase: "Waxing Gibbous", illumination: 87 });
  });
  test("one run per day", async () => {
    let calls = 0;
    const run = async () => { calls += 1; return { phase: "Full Moon", illumination: 1 }; };
    const day = new Date("2026-10-28T10:00:00Z");
    await moonTile(run, day);
    await moonTile(run, new Date("2026-10-28T23:00:00Z"));
    expect(calls).toBe(1);
    await moonTile(run, new Date("2026-10-29T01:00:00Z"));
    expect(calls).toBe(2);
  });
  test("a failed or odd answer leaves the tile out and is retried", async () => {
    expect(await moonTile(async () => { throw new Error("down"); })).toBeUndefined();
    expect(await moonTile(async () => ({ phase: "New Moon" }))).toBeUndefined();
    expect(await moonTile(async () => ({ phase: "New Moon", illumination: 0 }))).toEqual({ phase: "New Moon", illumination: 0 });
  });
  test("keeps the next full and new moon dates when they are real calendar dates", async () => {
    const tile = await moonTile(async () => ({ phase: "Waxing Crescent", illumination: 0.28, next_full_moon: "2026-11-24", next_new_moon: "2026-11-09" }));
    expect(tile).toEqual({ phase: "Waxing Crescent", illumination: 28, nextFull: "2026-11-24", nextNew: "2026-11-09" });
  });
  test("drops a date that is not a real calendar date and keeps the tile", async () => {
    const tile = await moonTile(async () => ({ phase: "Full Moon", illumination: 1, next_full_moon: "2026-02-31", next_new_moon: "soon" }));
    expect(tile).toEqual({ phase: "Full Moon", illumination: 100 });
  });
});

describe("cardMoon", () => {
  const data = {
    place: "Springfield", temperature: 61, unit: "fahrenheit", conditions: "Clear", block_code: 0, block_is_day: 0,
    block_day_dates: ["2026-10-30"], block_day_highs: [70], block_day_lows: [50], block_day_codes: [0],
  };
  test("keeps only the phase and percent lit, and the card still passes the spec", () => {
    const moon = cardMoon({ phase: "Waning Gibbous", illumination: 87, nextFull: "2026-11-24", nextNew: "2026-11-09" });
    expect(moon).toEqual({ phase: "Waning Gibbous", illumination: 87 });
    const card = weatherCard("weather", "weather", data)!;
    card.props = { ...(card.props as Record<string, unknown>), moon };
    expect(AnswerBlock.safeParse(card).success).toBe(true);
  });
  test("is absent when the almanac app could not answer, so the card stays as before", () => {
    expect(cardMoon(undefined)).toBeUndefined();
    const card = weatherCard("weather", "weather", data)!;
    expect(AnswerBlock.safeParse(card).success).toBe(true);
    expect((card.props as Record<string, unknown>).moon).toBeUndefined();
  });
});
