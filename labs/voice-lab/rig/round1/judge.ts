// Round-1 judges: what a person would notice about barge-in and duplex, read from the RECORDING of her speaker output plus the event times. Pure functions, calibrated by tests/round1Judge.test.ts.
import { rms } from "../listen/audio";
import { wer } from "../listen/judge";
export const R1 = { finishWordMs: 1500, zeroRunMs: 250, dipDb: 6, wordsKept: 0.8, settleMs: 300 };
/** Start (s) of the first run of digital silence of at least minMs at or after fromSec, or null. Underruns and stops leave exact zeros; her own pauses keep a little noise. */
export function zeroRunStart(rec: Float32Array, rate: number, fromSec: number, minMs = R1.zeroRunMs): number | null {
  let run = 0; const need = Math.round(rate * minMs / 1000);
  for (let i = Math.max(0, Math.round(fromSec * rate)); i < rec.length; i++) { if (Math.abs(rec[i]!) < 1e-5) { run++; if (run >= need) return (i - run + 1) / rate; } else run = 0; }
  return null;
}
/** ms from the person starting to the speaker going silent (first zero run after the onset), measured from the recording; null when she never stopped. */
export function silentAfterMs(rec: Float32Array, rate: number, onsetSec: number): number | null { const z = zeroRunStart(rec, rate, onsetSec); return z === null ? null : Math.round((z - onsetSec) * 1000); }
/** Loudness drop (dB, positive = quieter) of her voiced speech in the 2.3 s after `atSec` against the 2.3 s before. Frames below 0.01 rms (pauses) are left out of both. */
export function dipDb(rec: Float32Array, rate: number, atSec: number): number {
  const f = Math.round(rate * 0.02), lvl = (a: number, b: number) => { const v: number[] = []; for (let i = Math.max(0, Math.round(a * rate)); i + f < Math.min(rec.length, Math.round(b * rate)); i += f) { const r = rms(rec, i, i + f); if (r > 0.01) v.push(r); } return v.length >= 10 ? v.reduce((x, y) => x + y, 0) / v.length : 0; };
  const before = lvl(atSec - 2.5, atSec - 0.2), after = lvl(atSec + 0.2, atSec + 2.5); if (!before || !after) return before && !after ? 99 : 0;
  return 20 * Math.log10(before / after);
}
/** Share of the person's words that appear in what the hub heard. */
export function wordsKept(said: string, heard: string): number { const w = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean); const s = w(said); if (!s.length) return 1; const h = new Set(w(heard)); return s.filter((x) => h.has(x)).length / s.length; }
void wer;
export interface R1Run { scenario: string; selfStop?: boolean; firstAudioAt: number; userStartAt: number; userEndAt: number; askEndAt: number; userText: string; texts: string[]; nods: number; finals: number[]; stops: number[]; pauses: number[] }
export interface R1Verdict { pass: boolean; reasons: string[]; silentMs: number | null; dip: number | null; kept: number | null }
/** One run of one case: the verdict plus the numbers behind it. */
export function judgeRun(r: R1Run, rec: Float32Array, rate = 24000): R1Verdict {
  const reasons: string[] = []; let silentMs: number | null = null, dip: number | null = null, kept: number | null = null;
  const fa = r.firstAudioAt / 1000, onset = r.userStartAt / 1000;
  const stopsInReply = r.stops.filter((t) => t > r.firstAudioAt);
  const heard = r.texts.join(" ");
  if (["silent", "repeat", "mmhm", "yeah", "cough"].includes(r.scenario)) {
    const z = zeroRunStart(rec, rate, fa + 0.3); if (z !== null) reasons.push(`she went silent at ${z.toFixed(1)} s (a false stop)`);
    if (stopsInReply.length) reasons.push(`the hub sent stop ${stopsInReply.length}x`); if (r.selfStop) reasons.push("she interrupted herself");
    if (r.scenario !== "silent" && onset > 0) { dip = +dipDb(rec, rate, onset).toFixed(1); if (dip > R1.dipDb) reasons.push(`her voice dipped ${dip} dB`); }
  } else if (r.scenario === "stop" || r.scenario === "sentence") {
    if (!r.stops.some((t) => t >= r.userStartAt)) reasons.push("no stop after the person started");
    silentMs = silentAfterMs(rec, rate, onset); if (silentMs === null) reasons.push("she never went silent (missed stop)"); else if (silentMs > R1.finishWordMs) reasons.push(`silent only after ${silentMs} ms`);
    if (r.selfStop) reasons.push("she interrupted herself before the person spoke");
  } else if (r.scenario === "overlap") {
    kept = +wordsKept(r.userText, heard).toFixed(2); if (kept < R1.wordsKept) reasons.push(`only ${Math.round(kept * 100)}% of the person's words reached the transcript`);
  } else if (r.scenario === "nodmid") {
    kept = +wordsKept(r.userText, heard).toFixed(2); if (kept < R1.wordsKept) reasons.push(`only ${Math.round(kept * 100)}% of the person's words reached the transcript`);
    if (r.finals.some((t) => t < r.askEndAt)) reasons.push("her side took the turn before the person finished");
    if (r.stops.some((t) => t < r.askEndAt) || r.pauses.some((t) => t < r.askEndAt)) reasons.push("her side cut the person's audio (stop or pause while he talked)");
  } else reasons.push("unknown case " + r.scenario);
  return { pass: reasons.length === 0, reasons, silentMs, dip, kept };
}
