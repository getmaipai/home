import { describe, expect, test } from "bun:test";
import ks1 from "./datasets/ks-bench-01.json";
import { callShapes, judge, rescoreRecorded, scopeOf, scopeUse, stripScopeFromBody, wasRescued, type CategoryRule, type RecordedRun } from "./ksBenchScore";

const call = (args: Record<string, unknown>, name = "websearch") => ({ name, arguments: JSON.stringify(args) });
const rules = ks1.arms as Record<string, CategoryRule>;

describe("KS-BENCH-01 scorer", () => {
  test("a turn with no tool call is no_tool and passes stable and no_tool rows", () => {
    const shapes = callShapes([], []);
    expect([...shapes]).toEqual(["no_tool"]);
    expect(judge(shapes, rules.stable!).pass).toBe(true);
    expect(judge(shapes, rules.no_tool!).pass).toBe(true);
    expect(judge(shapes, rules.recency!).pass).toBe(false);
  });
  test("a reference-only turn passes stable and is forbidden on recency", () => {
    const shapes = callShapes([call({ expression: "marie curie", scope: "reference" })], []);
    expect(shapes.has("scope_reference_only")).toBe(true);
    expect(judge(shapes, rules.stable!).pass).toBe(true);
    expect(judge(shapes, rules.recency!)).toEqual({ pass: false, forbidden: true });
  });
  test("a library call followed by a web call is not reference-only", () => {
    const shapes = callShapes([call({ scope: "reference" })], [call({ scope: "web" })]);
    expect(shapes.has("scope_reference_only")).toBe(false);
  });
  test("an unscoped call is the baseline shape: passes recency, misses stable, forbidden on no_tool", () => {
    const shapes = callShapes([call({ expression: "bitcoin price" })], []);
    expect([...shapes]).toEqual(["scope_omitted"]);
    expect(judge(shapes, rules.recency!).pass).toBe(true);
    expect(judge(shapes, rules.stable!)).toEqual({ pass: false, forbidden: false });
    expect(judge(shapes, rules.no_tool!)).toEqual({ pass: false, forbidden: true });
  });
  test("a web scope is forbidden on stable rows", () => {
    expect(judge(callShapes([call({ scope: "web" })], []), rules.stable!)).toEqual({ pass: false, forbidden: true });
  });
  test("another tool is neither acceptable nor forbidden", () => {
    const shapes = callShapes([call({ expression: "2+2" }, "math")], []);
    expect([...shapes]).toEqual(["other_tool"]);
    expect(judge(shapes, rules.no_tool!)).toEqual({ pass: false, forbidden: false });
  });
  test("scope parsing ignores junk and counts scoped searches", () => {
    expect(scopeOf({ name: "websearch", arguments: "not json" })).toBeNull();
    expect(scopeOf(call({ scope: "everything" }))).toBeNull();
    expect(scopeUse([call({ scope: "web" }), call({}), call({ scope: "x" }, "math")])).toEqual({ searches: 2, scoped: 1 });
  });
  test("stripScopeFromBody removes scope from the websearch schema only", () => {
    const body = JSON.stringify({ tools: [{ function: { name: "websearch", parameters: { properties: { expression: {}, scope: {} }, required: ["expression", "scope"] } } }, { function: { name: "math", parameters: { properties: { scope: {} } } } }] });
    const out = stripScopeFromBody(body);
    const parsed = JSON.parse(out.body);
    expect(out.stripped).toBe(true);
    expect(Object.keys(parsed.tools[0].function.parameters.properties)).toEqual(["expression"]);
    expect(parsed.tools[0].function.parameters.required).toEqual(["expression"]);
    expect(Object.keys(parsed.tools[1].function.parameters.properties)).toEqual(["scope"]);
    expect(stripScopeFromBody("{}")).toEqual({ body: "{}", stripped: false });
  });
});

// ROUTER-BUILD-01i. The run shapes below are the ones in data-scratch/chat-ab/router-build-01h/results.json
// (assist_rescue arm): a rescued turn has an empty first round, one backend query, and a final round with
// tool_choice "none"; the hub's forced call is never in the model's output.
describe("rescued search is a search (ROUTER-BUILD-01i)", () => {
  const run = (over: Partial<RecordedRun>): RecordedRun => ({ category: "recency", error: null, firstRound: { calls: [] }, laterCalls: [], fixtureQueries: 1, shapes: ["no_tool"], pass: false, forbidden: false, searches: 0, ...over });

  test("an empty first round plus a backend query is a rescue, and passes recency", () => {
    expect(wasRescued([], [], 1)).toBe(true);
    const r = rescoreRecorded(run({}), rules);
    expect(r).toMatchObject({ rescued: true, shapes: ["rescued_search"], pass: true, forbidden: false, searches: 1 });
  });
  test("an empty first round with no backend query stays no_tool", () => {
    expect(wasRescued([], [], 0)).toBe(false);
    expect(rescoreRecorded(run({ fixtureQueries: 0 }), rules)).toMatchObject({ rescued: false, shapes: ["no_tool"], pass: false, searches: 0 });
  });
  test("another tool that queried the backend is not a rescue", () => {
    const weather = [{ name: "weather", arguments: "{}" }];
    expect(wasRescued(weather, [], 2)).toBe(false);
    expect(rescoreRecorded(run({ firstRound: { calls: weather }, shapes: ["other_tool"], fixtureQueries: 2 }), rules)).toMatchObject({ rescued: false, shapes: ["other_tool"], searches: 0 });
  });
  test("a model websearch in a later round is the model's own search, not a rescue", () => {
    expect(wasRescued([], [call({ expression: "news" })], 1)).toBe(false);
  });
  test("a rescue on a no_tool row is forbidden and on a stable row is a miss", () => {
    expect(rescoreRecorded(run({ category: "no_tool" }), rules)).toMatchObject({ rescued: true, pass: false, forbidden: true, searches: 1 });
    expect(rescoreRecorded(run({ category: "stable" }), rules)).toMatchObject({ rescued: true, pass: false, forbidden: false, searches: 1 });
  });
  test("a run that already carries the field, or has no first round, is returned unchanged", () => {
    const done = run({ rescued: false });
    expect(rescoreRecorded(done, rules)).toBe(done);
    const none = run({ firstRound: null });
    expect(rescoreRecorded(none, rules)).toBe(none);
  });
  test("scopeUse counts a rescued search and callShapes agrees", () => {
    expect(scopeUse([], 1)).toEqual({ searches: 1, scoped: 0 });
    expect([...callShapes([], [], true)]).toEqual(["rescued_search"]);
    expect([...callShapes([], [], false)]).toEqual(["no_tool"]);
  });
});
