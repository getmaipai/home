// Word timings for short clips with the lab's recognizer (used to cut real laughs, sighs and coughs out of speech clips).
// Usage: bun rig/asr_times.ts <clips_dir> <meta.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const PARAKEET = Bun.env.LAB_PARAKEET ?? "/usr/local/maipai-home/stack/data/models/parakeet-tdt-0.6b-v2-int8/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";
const sherpa = require("sherpa-onnx-node");
const rec = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { transducer: { encoder: join(PARAKEET, "encoder.int8.onnx"), decoder: join(PARAKEET, "decoder.int8.onnx"), joiner: join(PARAKEET, "joiner.int8.onnx") }, tokens: join(PARAKEET, "tokens.txt"), modelType: "nemo_transducer", numThreads: 4, provider: "cpu", debug: 0 } });
function readWav(path: string): { samples: Float32Array; rate: number } {
  const b = readFileSync(path); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let p = 12, rate = 16000, fmt = 1, bits = 16, ch = 1, data = 0, len = 0;
  while (p < b.length - 8) { const id = b.toString("ascii", p, p + 4), sz = dv.getUint32(p + 4, true); if (id === "fmt ") { fmt = dv.getUint16(p + 8, true); ch = dv.getUint16(p + 10, true); rate = dv.getUint32(p + 12, true); bits = dv.getUint16(p + 22, true); } if (id === "data") { data = p + 8; len = sz; break; } p += 8 + sz + (sz & 1); }
  const n = Math.floor(len / (bits / 8) / ch), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) { const o = data + (i * ch + c) * (bits / 8); s += fmt === 3 ? dv.getFloat32(o, true) : bits === 16 ? dv.getInt16(o, true) / 32768 : dv.getInt32(o, true) / 2147483648; } out[i] = s / ch; }
  return { samples: out, rate };
}
const meta = JSON.parse(readFileSync(process.argv[3]!, "utf8")); const out: Record<string, unknown> = {};
for (const m of meta) {
  const { samples, rate } = readWav(join(process.argv[2]!, m.name + ".wav")); const k = Math.round(rate / 16000), n = Math.floor(samples.length / k), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < k; j++) s += samples[i * k + j]!; x[i] = s / k; }
  const s = rec.createStream(); s.acceptWaveform({ samples: x, sampleRate: 16000 }); await rec.decodeAsync(s); const r = rec.getResult(s);
  out[m.name] = { text: r.text, tokens: r.tokens, timestamps: r.timestamps, dur: n / 16000 };
}
writeFileSync(process.argv[4]!, JSON.stringify(out)); console.log("done", Object.keys(out).length);
