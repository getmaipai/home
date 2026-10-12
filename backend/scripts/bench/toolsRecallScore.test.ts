import { describe, expect, test } from "bun:test";
import data from "./datasets/tools-recall-01.json";
import { BASE_TOOLS, childSearchViolation, classify, countRows, isHeldOut, pairedInterval, rewriteToolDescriptions, rowMeans, summarizeArm, validateFixture, type Row, type Run } from "./toolsRecallScore";

const rows = data.rows as Row[];
const row = (over: Partial<Row>): Row => ({ id: "x", kind: "positive", expected: "weather", band: "adult", heldOut: false, prompt: "p", ...over });
const run = (r: string, arm: string, firstCalls: string[], over: Partial<Run> = {}): Run => ({ arm, row: r, rep: 1, error: null, firstCalls, laterCalls: [], fixtureQueries: 0, ...over });

describe("TOOLS-RECALL-01 fixture", () => {
  test("is sound: unique ids and prompts, labels match the tool list, split matches the id hash", () => {
    expect(validateFixture(rows)).toEqual([]);
  });
  test("has 8 positives and 4 follow-ups per base tool, 24 no-tool rows and 12 near-misses", () => {
    const c = countRows(rows);
    for (const t of BASE_TOOLS) expect(c.perTool[t]!).toEqual({ positive: 8, followup: 4 });
    expect([c.none, c.nearmiss, c.total]).toEqual([24, 12, 156]);
  });
  test("keeps child and spoken rows and holds out roughly 40 percent", () => {
    const c = countRows(rows);
    expect(c.bands.child!).toBeGreaterThan(10);
    expect(c.bands.spoken!).toBeGreaterThan(10);
    expect(c.heldOut / c.total).toBeGreaterThan(0.33);
    expect(c.heldOut / c.total).toBeLessThan(0.47);
  });
  test("every near-miss row expects no tool at all", () => {
    for (const r of rows.filter((x) => x.kind === "nearmiss")) expect(r.expected).toBeNull();
  });
  test("the held-out split is a pure function of the id", () => {
    expect(isHeldOut("tr-weather-p01")).toBe(isHeldOut("tr-weather-p01"));
    expect(rows.every((r) => r.heldOut === isHeldOut(r.id))).toBe(true);
  });
  test("validateFixture flags a mislabeled row", () => {
    expect(validateFixture([row({ expected: "nonsense" })]).length).toBeGreaterThan(0);
    expect(validateFixture([row({ band: "child", expected: "websearch", id: "y", prompt: "q" })]).some((p) => p.includes("child"))).toBe(true);
  });
});

describe("classify", () => {
  test("calling the expected tool is correct, even beside another call", () => {
    expect(classify(row({}), ["weather"])).toBe("correct");
    expect(classify(row({}), ["math", "weather"])).toBe("correct");
  });
  test("no call on a should-call row is missed, a different tool is wrong_tool", () => {
    expect(classify(row({}), [])).toBe("missed");
    expect(classify(row({}), ["timer"])).toBe("wrong_tool");
  });
  test("any call on a no-tool or near-miss row is a false call", () => {
    expect(classify(row({ kind: "none", expected: null }), ["websearch"])).toBe("false_call");
    expect(classify(row({ kind: "nearmiss", expected: null, confusable: "timer" }), ["timer"])).toBe("false_call");
    expect(classify(row({ kind: "none", expected: null }), [])).toBe("clean");
  });
});

describe("child safety", () => {
  test("a child row with a websearch call in any round or a fixture query is a violation", () => {
    const c = row({ band: "child", kind: "none", expected: null });
    expect(childSearchViolation(c, { firstCalls: [], laterCalls: ["websearch"], fixtureQueries: 0 })).toBe(true);
    expect(childSearchViolation(c, { firstCalls: [], laterCalls: [], fixtureQueries: 1 })).toBe(true);
    expect(childSearchViolation(c, { firstCalls: ["timer"], laterCalls: [], fixtureQueries: 0 })).toBe(false);
    expect(childSearchViolation(row({ band: "adult" }), { firstCalls: ["websearch"], laterCalls: [], fixtureQueries: 1 })).toBe(false);
  });
});

describe("summarizeArm", () => {
  const rs: Row[] = [
    row({ id: "a", heldOut: false }), row({ id: "b", heldOut: true }),
    row({ id: "c", kind: "none", expected: null, heldOut: false }), row({ id: "d", kind: "nearmiss", expected: null, confusable: "timer", heldOut: true }),
  ];
  const runs: Run[] = [run("a", "base", ["weather"]), run("b", "base", ["timer"]), run("c", "base", ["math"]), run("d", "base", []), run("a", "var", [])];
  test("reports per-tool recall, wrong-tool rate and false-call rate per kind", () => {
    const s = summarizeArm(rs, runs, "base", "all");
    expect(s.perTool.weather!).toEqual({ n: 2, recall: 0.5, wrongTool: 0.5, missed: 0 });
    expect(s.falseCall.none).toEqual({ n: 1, rate: 1 });
    expect(s.falseCall.nearmiss).toEqual({ n: 1, rate: 0 });
  });
  test("reports held-out and tuning separately", () => {
    expect(summarizeArm(rs, runs, "base", "heldout").perTool.weather!.recall).toBe(0);
    expect(summarizeArm(rs, runs, "base", "tuning").perTool.weather!.recall).toBe(1);
  });
  test("errored runs are counted but never scored, and arms do not mix", () => {
    const s = summarizeArm(rs, [...runs, run("a", "base", [], { error: "hung", rep: 2 })], "base", "all");
    expect(s.errors).toBe(1);
    expect(s.perTool.weather!.n).toBe(2);
  });
});

describe("pairedInterval", () => {
  test("is deterministic for a seed and brackets the true paired difference", () => {
    const base = new Map(Array.from({ length: 40 }, (_, i) => [`r${i}`, i % 2]));
    const variant = new Map(Array.from({ length: 40 }, (_, i) => [`r${i}`, 1]));
    const a = pairedInterval(base, variant, 500, 7)!;
    expect(pairedInterval(base, variant, 500, 7)).toEqual(a);
    expect(a.diff).toBeCloseTo(0.5);
    expect(a.lo).toBeLessThanOrEqual(0.5);
    expect(a.hi).toBeGreaterThanOrEqual(0.5);
  });
  test("an identical arm gives a zero interval and rows missing from one arm are dropped", () => {
    const m = new Map([["a", 1], ["b", 0]]);
    expect(pairedInterval(m, m, 200, 1)).toEqual({ n: 2, diff: 0, lo: 0, hi: 0 });
    expect(pairedInterval(m, new Map([["a", 1]]), 50, 1)!.n).toBe(1);
    expect(pairedInterval(new Map(), m)).toBeNull();
  });
  test("rowMeans averages repeats per row", () => {
    const rs = [row({ id: "a" })];
    const m = rowMeans(rs, [run("a", "base", ["weather"]), run("a", "base", [], { rep: 2 })], "base", "recall", "all");
    expect(m.get("a")).toBe(0.5);
  });
});

describe("rewriteToolDescriptions", () => {
  test("replaces only the named tools' descriptions on the wire", () => {
    const body = JSON.stringify({ tools: [{ function: { name: "timer", description: "old" } }, { function: { name: "math", description: "keep" } }] });
    const out = rewriteToolDescriptions(body, { timer: "new" });
    const tools = (JSON.parse(out.body) as { tools: { function: { description: string } }[] }).tools;
    expect(out.rewritten).toBe(1);
    expect(tools.map((t) => t.function.description)).toEqual(["new", "keep"]);
    expect(rewriteToolDescriptions("not json", { timer: "x" })).toEqual({ body: "not json", rewritten: 0 });
  });
});
