// Pure judges for the listener: each takes recorded audio (or the written text) and says what a person would notice.
import { rms, pitch } from "./audio";
export const LIMITS = { speakerSim: 0.30, gapMs: 60, gapsPerReply: 0, clicksPerReply: 0, joinSemitones: 7, joinDb: 6.5, wer: 0.35, fillerShare: 0.6, firstWordShare: 0.5 };

/** Digital-silence holes inside the spoken part (between the first and last audible sample) of at least minMs. Underruns leave exact zeros; the voice engine's own pauses keep a little noise. */
export function holes(x: Float32Array, rate: number, minMs = LIMITS.gapMs, boundaries: number[] = []): Array<{ at: number; ms: number }> {
  const out: Array<{ at: number; ms: number }> = []; let first = 0, last = x.length - 1;
  while (first < x.length && Math.abs(x[first]!) < 0.003) first++; while (last > first && Math.abs(x[last]!) < 0.003) last--;
  let run = 0;
  for (let i = first; i <= last; i++) { if (Math.abs(x[i]!) < 1e-5) run++; else { if (run / rate * 1000 >= minMs) { const at = (i - run) / rate, ms = run / rate * 1000; const atBoundary = boundaries.some((b) => at < b + 0.2 && at + ms / 1000 > b - 0.2); if (!atBoundary || ms > 450) out.push({ at, ms }); } run = 0; } }
  return out;
}
/** Clicks: an abrupt jump between neighbouring samples far above the local loudness (a buffer edge or a dropped piece). */
export function clicks(x: Float32Array, rate: number, boundaries: number[] = []): number[] {
  const out: number[] = []; const w = Math.round(rate * 0.01);
  for (let i = w + 1; i < x.length - 1; i++) {
    const d = Math.abs(x[i]! - x[i - 1]!); if (d < 0.45) continue;
    if (boundaries.some((b) => Math.abs(i / rate - b) < 0.2)) continue; // a phrase starting is judged by the joins
    if (rms(x, i - w, i) < 0.02) continue;
    let typical = 0; for (let k = i - w; k < i; k++) typical += Math.abs(x[k]! - x[k - 1]!); typical /= w;
    if (d > 30 * typical) { out.push(i / rate); i += w; }
  }
  return out;
}
/** Jump in pitch (semitones) and loudness (dB) across a join at `at` seconds, comparing the 250 ms of voiced sound on each side. null when a side is not voiced. */
/** Loudness (mean rms of the voiced 20 ms frames) and pitch (median f0 of voiced 40 ms frames) of the speech in [from, to] seconds. */
function side(x: Float32Array, rate: number, from: number, to: number): { level: number; f0: number } | null {
  const f = Math.round(rate * 0.02); const lv: number[] = [], ps: number[] = [];
  for (let i = Math.max(0, Math.round(from * rate)); i + 2 * f < Math.min(x.length, Math.round(to * rate)); i += f) { const r = rms(x, i, i + f); if (r > 0.01) { lv.push(r); const p = pitch(x, rate, i, i + 2 * f); if (p > 0) ps.push(p); } }
  if (lv.length < 8) return null; ps.sort((a, b) => a - b); return { level: lv.reduce((a, b) => a + b, 0) / lv.length, f0: ps.length >= 4 ? ps[Math.floor(ps.length / 2)]! : 0 };
}
/** Jump in pitch (semitones) and loudness (dB) between the speech in the 1.2 s before `at` and the speech in the 1.2 s after `afterAt` (default the same point). */
export function joinJump(x: Float32Array, rate: number, at: number, afterAt = at): { semitones: number | null; db: number } {
  const a = side(x, rate, at - 1.2, at), b = side(x, rate, afterAt, afterAt + 1.2); if (!a || !b) return { semitones: null, db: 0 };
  return { semitones: a.f0 > 0 && b.f0 > 0 ? 12 * Math.log2(b.f0 / a.f0) : null, db: 20 * Math.log10((b.level + 1e-6) / (a.level + 1e-6)) };
}
export const joinFails = (j: { semitones: number | null; db: number }) => (j.semitones !== null && Math.abs(j.semitones) > LIMITS.joinSemitones) || Math.abs(j.db) > LIMITS.joinDb;
export function firstAudible(x: Float32Array, rate: number, fromSec = 0, level = 0.01): number | null { const w = Math.round(rate * 0.02); for (let i = Math.round(fromSec * rate); i + w < x.length; i += Math.round(w / 2)) if (rms(x, i, i + w) > level) return i / rate; return null; }
const words = (t: string) => t.toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
/** Word error rate of `heard` against `written` (tags removed). */
export function wer(written: string, heard: string): number {
  const r = words(written), h = words(heard); if (!r.length) return h.length ? 1 : 0;
  const d: number[][] = Array.from({ length: r.length + 1 }, (_, i) => [i, ...new Array(h.length).fill(0)]); for (let j = 1; j <= h.length; j++) d[0]![j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length]![h.length]! / r.length;
}
const FILLERS = ["um", "uh", "you know", "i mean", "like", "hmm", "well", "so", "oh", "ah", "right"];
export function stumbleReport(replies: string[]) {
  const n = replies.length; const per = replies.map((t) => { const lw = words(t); const rep = lw.filter((w, i) => i > 0 && w === lw[i - 1] && w.length < 5).length; return { fillers: FILLERS.filter((f) => ` ${lw.join(" ")} `.includes(` ${f} `)), repeats: rep, first: lw[0] ?? "" }; });
  const share = (f: string) => per.filter((p) => p.fillers.includes(f)).length / Math.max(1, n);
  const firstShare = Object.values(per.reduce((a: Record<string, number>, p) => ((a[p.first] = (a[p.first] ?? 0) + 1), a), {})).reduce((m, v) => Math.max(m, v), 0) / Math.max(1, n);
  const worstFiller = FILLERS.map((f) => [f, share(f)] as const).sort((a, b) => b[1] - a[1])[0]!;
  const fail = n >= 5 && (worstFiller[1] > LIMITS.fillerShare || firstShare > LIMITS.firstWordShare);
  return { replies: n, worstFiller: worstFiller[0], worstFillerShare: +worstFiller[1].toFixed(2), firstWordShare: +firstShare.toFixed(2), totalRepeats: per.reduce((s, p) => s + p.repeats, 0), fail };
}
