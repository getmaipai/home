// ANSWER-IMG-06: the bench waits for the engine to be quiet before each row, so
// a background title or summary request from the previous row never runs beside
// the next row's turn (the cross-row text leak the first real-turn run saw).
import { describe, expect, test } from "bun:test";
import { createEngineActivity } from "../scripts/bench/engineSettle";

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("engine settle", () => {
  test("a request still in flight keeps the next row waiting, even after a long quiet", async () => {
    const c = clock();
    const activity = createEngineActivity(c.now, c.sleep);
    activity.begin();
    expect(await activity.settle(2_000, 10_000)).toBe(false);
    expect(activity.inFlight()).toBe(1);
  });

  test("a request that ends inside the quiet window restarts the quiet period", async () => {
    const c = clock();
    const activity = createEngineActivity(c.now, c.sleep);
    activity.begin();
    c.advance(5_000);
    activity.end();
    c.advance(1_500); // a title request ending 1.5 s ago is not quiet yet for 2 s
    const before = c.now();
    expect(await activity.settle(2_000, 10_000)).toBe(true);
    expect(c.now() - before).toBeGreaterThanOrEqual(500);
  });

  test("nothing in flight and a long quiet resolves at once", async () => {
    const c = clock();
    const activity = createEngineActivity(c.now, c.sleep);
    c.advance(10_000);
    const before = c.now();
    expect(await activity.settle(2_000, 10_000)).toBe(true);
    expect(c.now()).toBe(before);
  });

  test("an end without a begin never drives the count below zero", () => {
    const activity = createEngineActivity();
    activity.end();
    expect(activity.inFlight()).toBe(0);
  });
});
