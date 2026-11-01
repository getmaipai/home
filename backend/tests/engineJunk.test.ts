// RESEARCH-ENGINE-01: an engine that returns only rows unrelated to the query twice in a row is benched like a suspended one, so a research
// run's searches use the engines that answer (the live runs: one engine returned ten rows about the wrong subject for an eight-word query).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetSearchRotationForTests, engineBenchedUntil, recordEngineHealth } from "@/lib/packageHost";

beforeEach(() => __resetSearchRotationForTests());
afterEach(() => __resetSearchRotationForTests());

const row = (engine: string, title: string, content = "") => ({ engine, engines: [engine], title, content });
const junk = (engine: string, n = 6) => Array.from({ length: n }, (_, i) => row(engine, `Unrelated page ${i} about a famous singer`, "a singer with a large following"));
const good = (engine: string, n = 4) => Array.from({ length: n }, (_, i) => row(engine, `Alder 200 blender review ${i}`, "a blender for a small kitchen compared with others"));
const QUERY = "Alder 200 blender small kitchen review";

describe("engine health counts relevant rows", () => {
  test("an engine whose rows all ignore the query is benched after the second such search; a relevant engine is not", () => {
    const value = () => ({ results: [...junk("junkengine"), ...good("goodengine")] });
    recordEngineHealth(["junkengine", "goodengine"], value(), [], QUERY);
    expect(engineBenchedUntil("junkengine")).toBe(0);
    recordEngineHealth(["junkengine", "goodengine"], value(), [], QUERY);
    expect(engineBenchedUntil("junkengine")).toBeGreaterThan(Date.now());
    expect(engineBenchedUntil("goodengine")).toBe(0);
  });

  test("one junk search followed by a good one does not bench the engine", () => {
    recordEngineHealth(["flaky"], { results: junk("flaky") }, [], QUERY);
    recordEngineHealth(["flaky"], { results: good("flaky") }, [], QUERY);
    recordEngineHealth(["flaky"], { results: junk("flaky") }, [], QUERY);
    expect(engineBenchedUntil("flaky")).toBe(0);
  });

  test("a few rows are not enough to call an engine junk, and a query with no words to compare benches nothing", () => {
    recordEngineHealth(["thin"], { results: junk("thin", 3) }, [], QUERY);
    recordEngineHealth(["thin"], { results: junk("thin", 3) }, [], QUERY);
    expect(engineBenchedUntil("thin")).toBe(0);
    recordEngineHealth(["blank"], { results: junk("blank") }, [], "");
    recordEngineHealth(["blank"], { results: junk("blank") }, [], "");
    expect(engineBenchedUntil("blank")).toBe(0);
  });

  test("results that name no engine say nothing about any engine", () => {
    recordEngineHealth(["x"], { results: [{ title: "Unrelated", content: "nothing" }, { title: "Unrelated two", content: "nothing" }, { title: "u3" }, { title: "u4" }, { title: "u5" }, { title: "u6" }] }, [], QUERY);
    recordEngineHealth(["x"], { results: [{ title: "Unrelated", content: "nothing" }, { title: "u2" }, { title: "u3" }, { title: "u4" }, { title: "u5" }, { title: "u6" }] }, [], QUERY);
    expect(engineBenchedUntil("x")).toBe(0);
  });
});
