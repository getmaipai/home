import { describe, expect, test } from "bun:test";
import ks1 from "./datasets/ks-bench-01.json";
import { callShapes, judge, scopeOf, scopeUse, stripScopeFromBody, type CategoryRule } from "./ksBenchScore";

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
