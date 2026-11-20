// Level matching between phrase chunks: each phrase is synthesized on its own, so its loudness is its own (joins jumped up to 7 to 10 dB). The first chunk sets the reply's level;
// every later chunk is scaled toward the running level (limited to +/-6 dB) with a short ramp at its start. No pitch change. The measure uses the first 300 ms of voiced sound of the chunk, which later chunks have already waited for while the earlier chunk plays.
export const LEVEL = { measureSamples: 7200, minVoiced: 0.01, maxGain: 2, minGain: 0.5, rampSamples: 1200, follow: 0.3 };
const rmsVoiced = (x: Int16Array): { rms: number; n: number } => { let s = 0, n = 0; const f = 480; for (let i = 0; i + f <= x.length; i += f) { let a = 0; for (let k = i; k < i + f; k++) a += (x[k]! / 32768) ** 2; const r = Math.sqrt(a / f); if (r > LEVEL.minVoiced) { s += r; n++; } } return { rms: n ? s / n : 0, n }; };
export class LevelMatcher {
  private ref = 0; private buf: Int16Array[] = []; private buffered = 0; private gain = 1; private decided = false; private emitted = 0; private chunkIndex = 0;
  /** Call at the start of every chunk (phrase). */
  startChunk() { this.buf = []; this.buffered = 0; this.decided = false; this.emitted = 0; this.gain = 1; }
  /** Returns the pieces to send now (possibly none while the first 300 ms are being measured). */
  push(pcm: Int16Array): Int16Array[] {
    if (this.decided) return [this.apply(pcm)];
    this.buf.push(pcm); this.buffered += pcm.length; if (this.buffered < LEVEL.measureSamples) return [];
    return this.decide();
  }
  /** Call when the chunk's audio ends: releases anything still held. */
  endChunk(): Int16Array[] { const out = this.decided ? [] : this.decide(); this.chunkIndex++; return out; }
  private decide(): Int16Array[] {
    const all = new Int16Array(this.buffered); let o = 0; for (const b of this.buf) { all.set(b, o); o += b.length; } this.buf = [];
    const m = rmsVoiced(all); this.decided = true;
    if (m.n >= 8) {
      if (this.ref === 0) this.ref = m.rms;                               // the first voiced chunk sets the level
      else { this.gain = Math.min(LEVEL.maxGain, Math.max(LEVEL.minGain, this.ref / m.rms)); this.ref = this.ref * (1 - LEVEL.follow) + m.rms * LEVEL.follow; }
    }
    return all.length ? [this.apply(all)] : [];
  }
  private apply(x: Int16Array): Int16Array {
    if (this.gain === 1) { this.emitted += x.length; return x; }
    const out = new Int16Array(x.length);
    for (let i = 0; i < x.length; i++) { const t = Math.min(1, (this.emitted + i) / LEVEL.rampSamples); const g = 1 + (this.gain - 1) * t; out[i] = Math.max(-32768, Math.min(32767, Math.round(x[i]! * g))); }
    this.emitted += x.length; return out;
  }
}
