import { expect, test } from "bun:test";
import { holes, clicks, joinJump, joinFails, firstAudible, wer, stumbleReport } from "../rig/listen/judge";

const rate = 24000, tone = (ms: number, f: number, a = 0.3) => Float32Array.from({ length: rate * ms / 1000 }, (_, i) => a * Math.sin(2 * Math.PI * f * i / rate));
const cat = (...p: Float32Array[]) => Float32Array.from(p.flatMap((x) => [...x]));
test("a gap inside speech is found in the audio itself, and clean speech has none", () => {
  expect(holes(cat(tone(300, 200), tone(300, 210)), rate)).toEqual([]);
  const bad = cat(tone(300, 200), new Float32Array(rate * 0.12), tone(300, 210)); const h = holes(bad, rate);
  expect(h.length).toBe(1); expect(h[0]!.ms).toBeGreaterThan(100);
  expect(holes(cat(new Float32Array(rate), tone(300, 200)), rate)).toEqual([]); // silence before the voice is not a gap
});
test("an abrupt jump is a click; a smooth tone is not", () => {
  expect(clicks(tone(300, 200), rate)).toEqual([]);
  const x = tone(300, 200); for (let i = 3000; i < 3010; i++) x[i] = 0.9; expect(clicks(x, rate).length).toBeGreaterThan(0);
});
test("laugh-then-flat-talk: a big pitch or loudness jump at the join fails, a continuous voice passes", () => {
  const same = cat(tone(400, 200), tone(400, 200)); expect(joinFails(joinJump(same, rate, 0.4))).toBe(false);
  const jump = cat(tone(400, 300), tone(400, 180)); expect(joinFails(joinJump(jump, rate, 0.4))).toBe(true);   // about -8 semitones
  const loud = cat(tone(400, 200, 0.4), tone(400, 200, 0.05)); expect(joinFails(joinJump(loud, rate, 0.4))).toBe(true);
});
test("time to first audible sound is read from the recording", () => { expect(firstAudible(cat(new Float32Array(rate), tone(200, 200)), rate)).toBeCloseTo(1.0, 1); expect(firstAudible(new Float32Array(rate), rate)).toBeNull(); });
test("word error rate ignores tags and punctuation", () => { expect(wer("Oh [laugh] that is funny.", "oh that is funny")).toBe(0); expect(wer("that is funny", "that was funny")).toBeCloseTo(1 / 3, 2); });
test("a filler used in most replies, or the same opening word, is a pattern", () => {
  const same = ["Oh, um, that is nice.", "Well, um, sure.", "Hmm, um, okay then.", "Oh, um, right.", "Um, yes.", "Oh, um, fine."]; expect(stumbleReport(same).fail).toBe(true);
  const varied = ["That is nice.", "Well, I think so.", "Um, hard to say.", "Sure thing.", "You know, it depends.", "Honestly, yes."]; expect(stumbleReport(varied).fail).toBe(false);
});
import { judgeJoins } from "../rig/listen/judge";
test("joins: only the MEDIAN of a reply can fail it; outliers are a visible warning (recorded: a -7.1 st outlier among joins of 2.4 and 1.3 st)", () => {
  const ok = judgeJoins([{ at: 2.3, semitones: -7.1, db: -3.9 }, { at: 3.39, semitones: 2.4, db: 0.3 }, { at: 5.99, semitones: 1.3, db: 1.1 }]);
  expect(ok.fail).toBeNull(); expect(ok.warn).toContain("JOIN OUTLIER"); expect(ok.warn).toContain("-7.1 st");
  const bad = judgeJoins([{ at: 1, semitones: 4.5, db: 1 }, { at: 2, semitones: -4.1, db: 2 }, { at: 3, semitones: 5.2, db: 1 }]); expect(bad.fail).toContain("joins uneven");
  const loudBad = judgeJoins([{ at: 1, semitones: 1, db: 4.1 }, { at: 2, semitones: 1, db: -4.4 }, { at: 3, semitones: 1, db: 3.8 }]); expect(loudBad.fail).toContain("dB");
  expect(judgeJoins([{ at: 1, semitones: 2, db: 1 }]).fail).toBeNull();
});
import { voicedFraction, MIN_VOICED } from "../rig/listen/speaker";
test("a window that is mostly pause is not judged for speaker identity (recorded: first windows of replies starting 'Hey!')", () => {
  const rate = 24000, w = new Float32Array(rate * 1.5); for (let i = 0; i < rate * 0.4; i++) w[i] = Math.sin(i / 9) * 0.2;   // 0.4 s of sound, 1.1 s of pause
  expect(voicedFraction(w, rate)).toBeLessThan(MIN_VOICED);
  const full = new Float32Array(rate * 1.5).map((_, i) => Math.sin(i / 9) * 0.2); expect(voicedFraction(full, rate)).toBeGreaterThan(MIN_VOICED);
});
