// RESEARCH-HOSTS-01: SearXNG engines that report themselves unavailable are benched for 5 minutes, and a pool left under two
// engines lets one benched engine through as a probe.
import { beforeEach, describe, expect, test } from "bun:test";
import { __benchEngineForTests, __lastResortEnginesForTests, __pickSearchEnginesForTests, __resetSearchRotationForTests, __searxngEngineBenchMsForTests } from "@/lib/packageHost";

beforeEach(() => __resetSearchRotationForTests());

describe("engine bench", () => {
  test("the bench lasts 5 minutes", () => {
    expect(__searxngEngineBenchMsForTests).toBe(5 * 60 * 1000);
  });

  test("with two or more available engines no benched one is asked", () => {
    __benchEngineForTests("brave", Date.now() + 60_000);
    expect(__pickSearchEnginesForTests(["brave", "bing", "mwmbl", "wikipedia"])).toEqual(["bing", "mwmbl"]);
  });

  test("with fewer than two available, the benched engine whose bench ends first joins as a probe", () => {
    __benchEngineForTests("brave", Date.now() + 200_000);
    __benchEngineForTests("google", Date.now() + 60_000);
    const picked = __pickSearchEnginesForTests(["brave", "google", "bing", "wikipedia"]);
    expect(picked).toContain("bing");
    expect(picked).toContain("google");
    expect(picked).not.toContain("brave");
  });

  test("an empty pool gets one probe, never wikipedia", () => {
    __benchEngineForTests("brave", Date.now() + 60_000);
    expect(__pickSearchEnginesForTests(["brave", "wikipedia"])).toEqual(["brave"]);
  });
});

describe("SEARCH-EMPTY-FAST-01: the last-resort engine list", () => {
  test("it ignores the bench: unbenched engines first, then benched ones by when their bench ends, never wikipedia", () => {
    __benchEngineForTests("yahoo", Date.now() + 200_000);
    __benchEngineForTests("brave", Date.now() + 60_000);
    expect(__lastResortEnginesForTests(["yahoo", "brave", "bing", "mwmbl", "wikipedia"])).toEqual(["bing", "mwmbl", "brave"]);
  });
});
