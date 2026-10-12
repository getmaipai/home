import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDecisionMessages, decide, eligible, parseDecision, systemPrompt, type DeciderTurn } from "./routerBuild02Decider";
import { assertLockboxMatches, clusterBootstrap, familyValues, sha256File } from "./routerBuild02Stats";
import { DEFAULT_MARKS, plainReturnedNoCall, replay, type PlainRun, type ReplayRow } from "./routerBuild02Replay";

const turn = (over: Partial<DeciderTurn> = {}): DeciderTurn => ({ band: "adult", modelToolCalls: 0, text: "who won the game last night", ...over });
const says = (word: string) => async () => word;

describe("deciders at the rescue position (M5)", () => {
  test("a child, a teen and a spoken turn never activate any decider, and nothing is forced", async () => {
    for (const arm of ["A", "B", "C", "D"] as const) {
      for (const t of [turn({ band: "child" }), turn({ band: "teen" }), turn({ band: "spoken" }), turn({ spoken: true })]) {
        const d = await decide(t, { arm, score: 0.99, threshold: 0.5, low: 0.2, high: 0.8, ask: says("SEARCH") });
        expect(d).toMatchObject({ decision: "NO_SEARCH", activated: false, reason: "not_eligible" });
      }
    }
  });
  test("a turn where the model already called a tool is never decided", async () => {
    expect((await decide(turn({ modelToolCalls: 1 }), { arm: "C", score: 0.99, threshold: 0.5 })).activated).toBe(false);
  });
  test("a pin mismatch forces no search for every arm", async () => {
    for (const arm of ["A", "B", "C", "D"] as const) {
      expect(await decide(turn(), { arm, score: 0.99, threshold: 0.5, low: 0.2, high: 0.8, ask: says("SEARCH"), pinOk: false })).toMatchObject({ decision: "NO_SEARCH", reason: "pin_mismatch" });
    }
  });
  test("B fails open on a timeout, an error and an unparsed answer", async () => {
    const slow = () => new Promise<string>((r) => setTimeout(() => r("SEARCH"), 200));
    expect(await decide(turn(), { arm: "B", ask: slow, timeoutMs: 20 })).toMatchObject({ decision: "NO_SEARCH", reason: "timeout", askedB: true });
    expect(await decide(turn(), { arm: "B", ask: async () => { throw new Error("HTTP 503"); } })).toMatchObject({ decision: "NO_SEARCH", reason: "error" });
    expect(await decide(turn(), { arm: "B", ask: says("Maybe, it depends") })).toMatchObject({ decision: "NO_SEARCH", reason: "unparsed" });
    expect(await decide(turn(), { arm: "B" })).toMatchObject({ decision: "NO_SEARCH", reason: "error" });
  });
  test("D fails open when B times out inside its band and does not call B outside it", async () => {
    let calls = 0;
    const ask = async () => { calls++; return "SEARCH"; };
    const cfg = { arm: "D" as const, low: 0.2, high: 0.8, ask };
    expect((await decide(turn(), { ...cfg, score: 0.9 })).decision).toBe("SEARCH");
    expect((await decide(turn(), { ...cfg, score: 0.1 })).decision).toBe("NO_SEARCH");
    expect(calls).toBe(0);
    expect(await decide(turn(), { ...cfg, score: 0.5 })).toMatchObject({ decision: "SEARCH", askedB: true });
    expect(calls).toBe(1);
    expect((await decide(turn(), { ...cfg, score: 0.5, ask: async () => { throw new Error("x"); } })).decision).toBe("NO_SEARCH");
  });
  test("D with a NaN or missing band fails open instead of becoming B, and a timeout aborts the request", async () => {
    expect(await decide(turn(), { arm: "D", score: 0.5, low: Number.NaN, high: 0.8, ask: says("SEARCH") })).toMatchObject({ decision: "NO_SEARCH", reason: "no_score", askedB: false });
    let aborted = false;
    const ask = (_m: unknown, signal?: AbortSignal) => new Promise<string>((_, rej) => signal?.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); }));
    expect((await decide(turn(), { arm: "B", ask, timeoutMs: 20 })).reason).toBe("timeout");
    expect(aborted).toBe(true);
  });
  test("A and C compare the score with the threshold, and a missing score fails open", async () => {
    expect((await decide(turn(), { arm: "A", score: 0.675, threshold: 0.67474 })).decision).toBe("SEARCH");
    expect((await decide(turn(), { arm: "C", score: 0.3, threshold: 0.67474 })).decision).toBe("NO_SEARCH");
    expect(await decide(turn(), { arm: "C", score: null, threshold: 0.5 })).toMatchObject({ decision: "NO_SEARCH", reason: "no_score" });
  });
});

describe("decision pass wording and parsing", () => {
  test("the context is the last exchange then the new message, and every variant ends with the one-word instruction", () => {
    const m = buildDecisionMessages(2, { text: "and the other team?", prior: { user: "Who won the Knicks game?", assistant: "The Knicks won 108 to 101." } });
    expect(m.map((x) => x.role)).toEqual(["system", "user", "assistant", "user"]);
    for (const v of [1, 2, 3] as const) expect(systemPrompt(v)).toContain("SEARCH or NO_SEARCH");
    expect(systemPrompt(3).length).toBeGreaterThan(systemPrompt(2).length);
  });
  test("answers parse the way the arm 0 router parses them", () => {
    expect(parseDecision("SEARCH")).toBe("SEARCH");
    expect(parseDecision(" no_search.\n")).toBe("NO_SEARCH");
    expect(parseDecision("hmm")).toBeNull();
  });
  test("eligibility is written adult turns with no model tool call", () => {
    expect(eligible(turn())).toBe(true);
    expect(eligible(turn({ spoken: true }))).toBe(false);
  });
});

describe("family bootstrap", () => {
  test("repeats average inside a row and rows inside a family before resampling", () => {
    const fam = familyValues([
      { family: "f1", row: "a", value: 1 }, { family: "f1", row: "a", value: 0 }, { family: "f1", row: "b", value: 1 },
      { family: "f2", row: "c", value: 0 },
    ]);
    expect([...fam]).toEqual([["f1", 0.75], ["f2", 0]]);
  });
  test("the interval is repeatable, needs two families, and a paired diff uses shared families only", () => {
    const a = new Map([["x", 1], ["y", 1], ["z", 0]]);
    const b = new Map([["x", 0], ["y", 1], ["w", 1]]);
    expect(clusterBootstrap(a, null, 500, 3)).toEqual(clusterBootstrap(a, null, 500, 3));
    expect(clusterBootstrap(new Map([["x", 1]]))).toBeNull();
    expect(clusterBootstrap(a, b, 500, 3)!.n).toBe(2);
  });
});

describe("lock box pre-registration check", () => {
  test("a lock box whose sha256 differs from PREREG.json is refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "rb3-"));
    const lock = join(dir, "lockbox.json");
    writeFileSync(lock, JSON.stringify({ rows: [] }));
    expect(() => assertLockboxMatches(lock, { lockbox: { sha256: sha256File(lock) } })).not.toThrow();
    writeFileSync(lock, JSON.stringify({ rows: [{ id: "edited" }] }));
    expect(() => assertLockboxMatches(lock, { lockbox: { sha256: "0".repeat(64) } })).toThrow(/needs a new pre-registration/);
    expect(() => assertLockboxMatches(lock, {})).toThrow(/names no lock box/);
  });
});

// Real shapes: a search-recency-02 run record has arm, row, band, rep, error, searches and firstRound.calls.
describe("stage 1 replay", () => {
  const rows: ReplayRow[] = [];
  const plain: PlainRun[] = [];
  const decisions: Record<string, Record<string, string>> = { C: {}, B: {} };
  const add = (id: string, category: string, family: string, opts: { followUp?: boolean; contested?: boolean; modelSearches?: number; otherTool?: boolean; c?: string; b?: string } = {}) => {
    rows.push({ id, category, family, followUp: opts.followUp, contested: opts.contested });
    for (const rep of [1, 2, 3]) {
      plain.push({ arm: "plain", row: id, band: "adult", rep, error: null, searches: opts.modelSearches ?? 0, firstRound: { calls: opts.modelSearches ? [{ name: "websearch" }] : opts.otherTool ? [{ name: "datetime" }] : [] } });
    }
    decisions.C![id] = opts.c ?? "NO_SEARCH";
    decisions.B![id] = opts.b ?? "NO_SEARCH";
  };
  for (let i = 0; i < 10; i++) add(`r${i}`, "recency", `fr${i}`, { modelSearches: i < 2 ? 1 : 0, c: "SEARCH", b: i === 9 ? "NO_SEARCH" : "SEARCH" });
  for (let i = 0; i < 6; i++) add(`s${i}`, "stable", `fs${i}`, { c: i === 0 ? "SEARCH" : "NO_SEARCH" });
  for (let i = 0; i < 6; i++) add(`n${i}`, "no_tool", `fn${i}`, { followUp: true, otherTool: i === 5, c: i === 5 ? "SEARCH" : "NO_SEARCH" });
  add("junk", "recency", "fj", { contested: true, c: "NO_SEARCH" });

  test("a decider acts only where plain returned no tool call, and contested rows are out of every denominator", () => {
    expect(plainReturnedNoCall(plain.find((r) => r.row === "n5")!)).toBe(false);
    const rep = replay(plain, rows, decisions);
    const get = (arm: string) => rep.arms.find((a) => a.arm === arm)!;
    expect(rep.contestedExcluded).toBe(1);
    expect(rep.rowsUsed).toBe(22);
    expect(get("plain").recall!.mean).toBeCloseTo(0.2, 5);
    expect(get("C").recall!.mean).toBe(1);
    expect(get("B").recall!.mean).toBeCloseTo(0.9, 5);
    expect(get("C").falseSearch.stable.rate!.mean).toBeCloseTo(1 / 6, 5);
    // n5 had another tool in plain's first round, so C's SEARCH on it never fires.
    expect(get("C").falseSearch.no_tool.rate!.mean).toBe(0);
    expect(get("C").fired).toBe(8 * 3 + 3);
  });
  test("marks: a decider with a stable false search above 3 fails M2; plain never passes M1", () => {
    const rep = replay(plain, rows, decisions);
    expect(rep.arms.find((a) => a.arm === "C")!.m2).toBe(false);
    expect(rep.arms.find((a) => a.arm === "plain")!.m1).toBe(false);
    expect(DEFAULT_MARKS.floor).toBe(0.91);
  });
  test("a missing decision for a turn it would act on is an error, not a silent no-search", () => {
    const partial = { C: { ...decisions.C! } };
    delete partial.C!.r5;
    expect(() => replay(plain, rows, partial)).toThrow(/no decision for row r5/);
  });
  test("per-repeat decisions are read per repeat", () => {
    const perRep = { B: Object.fromEntries(Object.keys(decisions.B!).map((k) => [k, { "1": "NO_SEARCH", "2": "NO_SEARCH", "3": "SEARCH" }])) };
    const rep = replay(plain, rows, perRep);
    const b = rep.arms.find((a) => a.arm === "B")!;
    expect(b.perRepRecall[1]).toBeCloseTo(0.2, 5);
    expect(b.perRepRecall[3]).toBe(1);
  });
});
