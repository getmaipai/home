// Small audio helpers for the listener: wav reading, resampling, level and pitch measures.
import { readFileSync } from "node:fs";
export function readWav(path: string): { samples: Float32Array; rate: number } {
  const b = readFileSync(path); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let p = 12, rate = 16000, fmt = 1, bits = 16, ch = 1, data = 0, len = 0;
  while (p < b.length - 8) { const id = b.toString("ascii", p, p + 4), sz = dv.getUint32(p + 4, true); if (id === "fmt ") { fmt = dv.getUint16(p + 8, true); ch = dv.getUint16(p + 10, true); rate = dv.getUint32(p + 12, true); bits = dv.getUint16(p + 22, true); } if (id === "data") { data = p + 8; len = Math.min(sz, b.length - data); break; } p += 8 + sz + (sz & 1); }
  const n = Math.floor(len / (bits / 8) / ch), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) { const o = data + (i * ch + c) * (bits / 8); s += fmt === 3 ? dv.getFloat32(o, true) : bits === 16 ? dv.getInt16(o, true) / 32768 : dv.getInt32(o, true) / 2147483648; } out[i] = s / ch; }
  return { samples: out, rate };
}
export function writeWav(path: string, x: Float32Array, rate: number) { const pcm = new Int16Array(x.length); for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(x[i]! * 32767))); const b = new Uint8Array(44 + pcm.length * 2), v = new DataView(b.buffer); const w = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0))); w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length * 2, true); b.set(new Uint8Array(pcm.buffer), 44); require("node:fs").writeFileSync(path, b); }
/** Linear resample (good enough for measuring). */
export function resample(x: Float32Array, from: number, to: number): Float32Array { if (from === to) return x; const n = Math.floor(x.length * to / from), o = new Float32Array(n); for (let i = 0; i < n; i++) { const p = i * from / to, a = Math.floor(p), c = Math.min(x.length - 1, a + 1), f = p - a; o[i] = x[a]! * (1 - f) + x[c]! * f; } return o; }
export const rms = (x: Float32Array, a = 0, b = x.length) => { let s = 0; const n = Math.max(1, b - a); for (let i = a; i < b; i++) s += x[i]! * x[i]!; return Math.sqrt(s / n); };
/** Pitch (Hz) of a voiced stretch by autocorrelation, 0 when unvoiced. */
export function pitch(x: Float32Array, rate: number, a = 0, b = x.length): number {
  const n = b - a; if (n < rate * 0.04) return 0; const lo = Math.floor(rate / 400), hi = Math.floor(rate / 70); let best = 0, bestLag = 0; let e0 = 0; for (let i = a; i < b; i++) e0 += x[i]! * x[i]!; if (e0 / n < 1e-6) return 0;
  for (let lag = lo; lag <= Math.min(hi, n - 1); lag++) { let c = 0; for (let i = a; i + lag < b; i++) c += x[i]! * x[i + lag]!; if (c > best) { best = c; bestLag = lag; } }
  return best / e0 > 0.3 ? rate / bestLag : 0;
}
