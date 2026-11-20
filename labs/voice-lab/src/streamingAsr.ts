import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
// Running (partial) text while the person is still speaking, from a small streaming recognizer in the same sherpa-onnx library. It only
// feeds the early start of a reply draft; the whole-utterance recognizer (Parakeet) still has the final word on every turn.
const DIR = Bun.env.LAB_STREAM_ASR ?? join(import.meta.dir, "..", "..", "..", "data-scratch", "models", "nemo80");
export const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
let recognizer: any = null, failed = false;
function load() {
  if (recognizer || failed) return recognizer;
  try {
    const sub = existsSync(DIR) ? readdirSync(DIR).find((x) => x.startsWith("sherpa")) : undefined; if (!sub) throw new Error("model missing");
    const d = join(DIR, sub), sherpa = require("sherpa-onnx-node");
    recognizer = new sherpa.OnlineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, decodingMethod: "greedy_search", enableEndpoint: false,
      modelConfig: { transducer: { encoder: join(d, "encoder.int8.onnx"), decoder: join(d, "decoder.int8.onnx"), joiner: join(d, "joiner.int8.onnx") }, tokens: join(d, "tokens.txt"), numThreads: 2, provider: "cpu", modelType: "nemo_transducer" } });
  } catch { failed = true; recognizer = null; }
  return recognizer;
}
export class StreamingAsr {
  private stream: any = null; fed = 0;
  get available() { return !!load(); }
  reset() { const r = load(); this.stream = r ? r.createStream() : null; this.fed = 0; }
  accept(samples: Float32Array) { const r = load(); if (!r) return; if (!this.stream) this.reset(); this.stream.acceptWaveform({ sampleRate: 16000, samples }); while (r.isReady(this.stream)) r.decode(this.stream); this.fed += samples.length; }
  text(): string { const r = load(); return r && this.stream ? String(r.getResult(this.stream).text ?? "").trim() : ""; }
}
