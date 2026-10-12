// MEMORY-RECALL-01: the fixture is valid, the split is stable, the scorers tell the failures apart.
import { describe, expect, test } from "bun:test";
import { bySplit, countFixture, loadFixture, pairedDelta, passRate, scoreJudgeRow, scorePolicyRow, scoreRecallRow, splitOf, summarizeJudge, validateFixture, type ArmRow } from "./memoryRecall01Score";

const fixture = loadFixture();

describe("fixture", () => {
  test("is valid: persona names only, households consistent, no address shapes", () => {
    expect(validateFixture(fixture)).toEqual([]);
  });
  test("covers every judge kind, multi-person households, follow-ups and abstention", () => {
    const c = countFixture(fixture);
    for (const kind of ["fact", "preference", "state", "update", "possessive", "reported", "noise", "curiosity"]) expect(c[`judge:${kind}`]).toBeGreaterThan(0);
    expect(Object.keys(fixture.households).length).toBeGreaterThanOrEqual(2);
    expect(c["recall:followUp"]).toBeGreaterThanOrEqual(4);
    expect(c["recall:abstain"]).toBeGreaterThanOrEqual(2);
  });
  test("the split is deterministic and lands near 60/40", () => {
    const c = countFixture(fixture);
    expect(splitOf("j01")).toBe(splitOf("j01"));
    const share = c["split:tuning"]! / (c["split:tuning"]! + c["split:heldout"]!);
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.7);
  });
  test("credential rows are caught and not-credential rows are not, by the deterministic policy alone", () => {
    for (const row of fixture.policy.filter((p) => p.kind === "credential" || p.kind === "not_credential")) {
      expect(scorePolicyRow(row)?.pass).toBe(true);
    }
  });
});

describe("judge scoring", () => {
  const possessive = fixture.judge.find((r) => r.id === "j11")!;
  const noise = fixture.judge.find((r) => r.id === "j26")!;
  test("a correct possessive resolves to the speaker's real name", () => {
    const s = scoreJudgeRow(possessive, ["Willow's sister Quill lives in Lisbon"]);
    expect(s).toMatchObject({ truePositives: 1, misses: 0, wrongPerson: [] });
  });
  test("a generic 'the user' is a wrong-person finding even when the keywords match", () => {
    const s = scoreJudgeRow(possessive, ["The user's sister Quill lives in Lisbon"]);
    expect(s.wrongPerson).toHaveLength(1);
    const sum = summarizeJudge([s]);
    expect(sum.wrongAttributionRows).toBe(1);
    expect(sum.attributionAccuracy).toBe(0);
  });
  test("anything saved from a noise row is a false save; nothing saved is clean", () => {
    expect(summarizeJudge([scoreJudgeRow(noise, ["Willow asked about the weather"])])).toMatchObject({ falseSaves: 1, falseSaveRows: 1, noiseRows: 1 });
    expect(summarizeJudge([scoreJudgeRow(noise, [])])).toMatchObject({ falseSaves: 0, falseSaveRows: 0 });
  });
  test("recall counts missed facts only", () => {
    const fact = fixture.judge.find((r) => r.id === "j01")!;
    expect(summarizeJudge([scoreJudgeRow(fact, []), scoreJudgeRow(fact, ["Willow is a nurse at Riverside"])]).recall).toBeCloseTo(0.5);
  });
});

describe("recall scoring", () => {
  const r01 = fixture.recall.find((r) => r.id === "r01")!;
  test("passes when the right memory surfaces and the other person's does not", () => {
    expect(scoreRecallRow(r01, ["a-marlow-job"], ["Marlow"]).pass).toBe(true);
  });
  test("a wrong-person memory in the top results is a leak and fails the row", () => {
    expect(scoreRecallRow(r01, ["a-willow-job", "a-marlow-job"], ["Willow", "Marlow"])).toMatchObject({ hit: true, leak: true, pass: false });
  });
  test("a follow-up needs the resolved subject, not just any memory", () => {
    const r19 = fixture.recall.find((r) => r.id === "r19")!;
    expect(scoreRecallRow(r19, ["a-pippa-snack"], ["Pippa"]).pass).toBe(true);
    expect(scoreRecallRow(r19, ["a-willow-tea"], ["Willow"]).pass).toBe(false);
  });
  test("an abstention row passes on an empty result and fails when a forbidden memory surfaces", () => {
    const r26 = fixture.recall.find((r) => r.id === "r26")!;
    expect(scoreRecallRow(r26, [], []).pass).toBe(true);
    // Nadia's own other facts surfacing is acceptable (MEMORY-FIX-01 C3); another person's are not.
    expect(scoreRecallRow(r26, ["b-nadia-bday"], ["Nadia"]).pass).toBe(true);
    expect(scoreRecallRow(r26, ["b-sage-job"], ["Sage"]).pass).toBe(false);
  });
});

describe("policy rows scored apart", () => {
  const child = fixture.policy.find((p) => p.kind === "child")!;
  test("child and teen rows have no offline score and pass only when the gated memory stays hidden", () => {
    expect(scorePolicyRow(child)).toBeNull();
    expect(scorePolicyRow(child, { surfaced: false })?.pass).toBe(true);
    expect(scorePolicyRow(child, { surfaced: true })?.pass).toBe(false);
  });
  test("a credential that gets remembered fails the row", () => {
    const cred = fixture.policy.find((p) => p.kind === "credential")!;
    expect(scorePolicyRow(cred, { surfaced: false, remembered: true })?.pass).toBe(false);
  });
});

describe("paired statistics", () => {
  const arm = (ids: string[], ok: (i: number, rep: number) => boolean): ArmRow[] => ids.flatMap((id, i) => [0, 1, 2].map((rep) => ({ id, rep, ok: ok(i, rep) })));
  const ids = Array.from({ length: 40 }, (_, i) => `x${i}`);
  test("a candidate that fixes rows shows a positive interval above zero; identical arms show zero", () => {
    const base = arm(ids, () => false);
    const better = arm(ids, () => true);
    const d = pairedDelta(base, better, 500);
    expect(d.estimate).toBeCloseTo(1);
    expect(d.low).toBeGreaterThan(0);
    const same = pairedDelta(base, base, 500);
    expect(same).toMatchObject({ estimate: 0, low: 0, high: 0 });
  });
  test("pass rate and split helpers", () => {
    const rows = arm(ids, (i) => i % 2 === 0);
    expect(passRate(rows)).toBeCloseTo(0.5);
    expect(passRate([])).toBeNull();
    expect(bySplit(rows, "tuning").length + bySplit(rows, "heldout").length).toBe(rows.length);
  });
});
