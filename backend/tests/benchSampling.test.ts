import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  seedFields,
  __setSamplingSeedForBench,
  promptNow,
  __setPromptClockForBench,
  seededOutcomeFor,
  __setSeededOutcomesForBench,
} from "@/lib/benchSampling";

beforeEach(() => {
  __setSeededOutcomesForBench(null);
  __setSamplingSeedForBench(null);
  __setPromptClockForBench(null);
});

afterEach(() => {
  __setSeededOutcomesForBench(null);
  __setSamplingSeedForBench(null);
  __setPromptClockForBench(null);
});

describe("seedFields", () => {
  test("returns an empty object when no seed is pinned", () => {
    expect(seedFields()).toEqual({});
  });

  test("returns the pinned seed when set", () => {
    __setSamplingSeedForBench(42);
    expect(seedFields()).toEqual({ seed: 42 });
  });

  test("returns an empty object after unpinning", () => {
    __setSamplingSeedForBench(42);
    __setSamplingSeedForBench(null);
    expect(seedFields()).toEqual({});
  });

  test("spreads into a request object", () => {
    __setSamplingSeedForBench(7);
    const req = { temperature: 0.7, ...seedFields() };
    expect(req).toEqual({ temperature: 0.7, seed: 7 });
    __setSamplingSeedForBench(null);
    const req2 = { temperature: 0.7, ...seedFields() };
    expect(req2).toEqual({ temperature: 0.7 });
  });
});

describe("promptNow", () => {
  test("returns the real current time when nothing is pinned", () => {
    const d = promptNow();
    expect(d).toBeInstanceOf(Date);
    expect(Math.abs(d.getTime() - Date.now())).toBeLessThan(1000);
  });

  test("returns the pinned instant when set", () => {
    const pinned = new Date("2026-01-01T00:00:00.000Z");
    __setPromptClockForBench(() => pinned);
    expect(promptNow()).toBe(pinned);
  });

  test("returns the real time after unpinning", () => {
    const pinned = new Date("2026-01-01T00:00:00.000Z");
    __setPromptClockForBench(() => pinned);
    __setPromptClockForBench(null);
    const d = promptNow();
    expect(Math.abs(d.getTime() - Date.now())).toBeLessThan(1000);
  });
});

describe("seeded outcomes (NAT-01 bench seam)", () => {
  test("default: nothing is seeded for any package", () => {
    expect(seededOutcomeFor("weather")).toBeNull();
  });

  test("override: the seeded result is returned for its package only, and clears", () => {
    const result = { reply: { text: "70% chance of rain this afternoon." }, actions: [] };
    __setSeededOutcomesForBench({ weather: result });
    expect(seededOutcomeFor("weather")).toBe(result);
    expect(seededOutcomeFor("websearch")).toBeNull();
    __setSeededOutcomesForBench(null);
    expect(seededOutcomeFor("weather")).toBeNull();
  });
});
