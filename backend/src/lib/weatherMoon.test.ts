import { beforeEach, describe, expect, test } from "bun:test";
import { __resetMoonForTests, moonTile } from "@/lib/weatherMoon";

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
});
