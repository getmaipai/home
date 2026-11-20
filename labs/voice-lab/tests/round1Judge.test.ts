import { expect, test } from "bun:test";
import { zeroRunStart, silentAfterMs, dipDb, wordsKept, judgeRun, type R1Run } from "../rig/round1/judge";
const rate = 24000, tone = (ms: number, a = 0.3) => Float32Array.from({ length: rate * ms / 1000 }, (_, i) => a * Math.sin(2 * Math.PI * 200 * i / rate) + 0.0004 * Math.sin(i));
const cat = (...p: Float32Array[]) => Float32Array.from(p.flatMap((x) => [...x])); const zeros = (ms: number) => new Float32Array(rate * ms / 1000);
const base: R1Run = { scenario: "mmhm", firstAudioAt: 500, userStartAt: 5000, userEndAt: 5800, askEndAt: 0, userText: "", texts: [], nods: 0, finals: [], stops: [], pauses: [] };
test("a clean recording has no silent run; a stop leaves one that is timed from the onset", () => {
  expect(zeroRunStart(tone(8000), rate, 1)).toBeNull();
  const stopped = cat(zeros(500), tone(5300), zeros(2000)); expect(silentAfterMs(stopped, rate, 5)).toBe(800);
});
test("known-bad: a false stop (silence while she should keep talking) fails the keep-talking cases", () => {
  const rec = cat(zeros(500), tone(4000), zeros(1500), tone(3000)); const v = judgeRun({ ...base, stops: [4600] }, rec);
  expect(v.pass).toBe(false); expect(v.reasons.join(" ")).toContain("false stop");
});
test("known-bad: a volume dip when the person speaks fails; the same speech at full volume passes", () => {
  const dipped = cat(zeros(500), tone(4500, 0.3), tone(3500, 0.08)); expect(dipDb(dipped, rate, 5)).toBeGreaterThan(6);
  expect(judgeRun(base, dipped).reasons.join(" ")).toContain("dipped");
  const full = cat(zeros(500), tone(8000, 0.3)); expect(judgeRun(base, full).pass).toBe(true); expect(dipDb(full, rate, 5)).toBeLessThan(1);
});
test("known-bad: a missed stop (she keeps talking) and a late stop fail the cut-in case; a prompt one passes", () => {
  const cut = { ...base, scenario: "stop", stops: [5100] };
  expect(judgeRun(cut, cat(zeros(500), tone(8000))).reasons.join(" ")).toContain("missed stop");
  expect(judgeRun(cut, cat(zeros(500), tone(7000), zeros(500))).reasons.join(" ")).toContain("silent only after");
  expect(judgeRun(cut, cat(zeros(500), tone(5100), zeros(2000))).pass).toBe(true); expect(judgeRun(cut, cat(zeros(500), tone(5300), zeros(2000))).reasons.join(" ")).toContain("limit 700");
  expect(judgeRun({ ...cut, stops: [] }, cat(zeros(500), tone(5400), zeros(2000))).reasons.join(" ")).toContain("no stop");
});
test("lost user words and a cut person fail the overlap and nod cases", () => {
  expect(wordsKept("Thursday?", "")).toBe(0); expect(wordsKept("one two three four", "one two three")).toBe(0.75);
  expect(judgeRun({ ...base, scenario: "overlap", userText: "Thursday?", texts: [] }, tone(8000)).pass).toBe(false);
  expect(judgeRun({ ...base, scenario: "overlap", userText: "Thursday?", texts: ["Thursday"] }, tone(8000)).pass).toBe(true);
  const nod = { ...base, scenario: "nodmid", askEndAt: 9000, userText: "a b c d e f", texts: ["a b c d e f"] };
  expect(judgeRun(nod, tone(8000)).pass).toBe(true); expect(judgeRun({ ...nod, finals: [4000] }, tone(8000)).reasons.join(" ")).toContain("took the turn");
  expect(judgeRun({ ...nod, pauses: [3000] }, tone(8000)).reasons.join(" ")).toContain("cut the person");
});
