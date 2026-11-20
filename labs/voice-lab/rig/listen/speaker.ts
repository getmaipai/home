// Speaker similarity: is this stretch of audio the same person as the voice sample?
import { join } from "node:path";
import { resample } from "./audio";
const MODEL = Bun.env.LAB_SPK_MODEL ?? join(import.meta.dir, "..", "..", "..", "..", "data-scratch", "models", "spk", "campplus.onnx");
let ex: any = null;
function extractor() { if (!ex) { const sherpa = require("sherpa-onnx-node"); ex = new sherpa.SpeakerEmbeddingExtractor({ model: MODEL, numThreads: 2, debug: false, provider: "cpu" }); } return ex; }
export function embed(x: Float32Array, rate: number): Float32Array { const e = extractor(); const s = e.createStream(); s.acceptWaveform({ sampleRate: 16000, samples: resample(x, rate, 16000) }); return Float32Array.from(e.compute(s)); }
export function cosine(a: Float32Array, b: Float32Array) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; } return d / Math.sqrt(na * nb + 1e-12); }
/** Similarity of every `win` second window (step `hop`) to the reference embedding, only windows with enough sound in them. */
export function windowSimilarities(x: Float32Array, rate: number, ref: Float32Array, win = 1.5, hop = 0.75): Array<{ at: number; sim: number }> {
  const out: Array<{ at: number; sim: number }> = []; const W = Math.round(win * rate), H = Math.round(hop * rate);
  for (let i = 0; i + W <= x.length; i += H) { const seg = x.subarray(i, i + W); let s = 0; for (const v of seg) s += v * v; if (Math.sqrt(s / W) < 0.01) continue; out.push({ at: i / rate, sim: cosine(embed(seg, rate), ref) }); }
  return out;
}
