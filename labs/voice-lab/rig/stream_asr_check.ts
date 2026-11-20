// How early does a streaming recognizer know the words? Feeds spoken questions in real time (32 ms frames) and records, per model,
// when the partial text reached its final form (relative to the end of speech) and whether it matches the whole-utterance recognizer.
import { join } from "node:path";
import { transcribe, } from "../src/stack";
import { encodeWav } from "../src/wav";
const sherpa = require("sherpa-onnx-node");
const D = "/Users/jessetorres/Developer/github.com/getmaipai/wt/home-brisk-panda-voice-lab/data-scratch/models";
const models: Record<string, any> = {
  zipformer: () => { const d = join(D, "streaming-zipformer/sherpa-onnx-streaming-zipformer-en-2023-06-26"); return { transducer: { encoder: join(d, "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx"), decoder: join(d, "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx"), joiner: join(d, "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx") }, tokens: join(d, "tokens.txt"), numThreads: 2, provider: "cpu" }; },
  nemo80: () => { const d = join(D, "nemo80", require("node:fs").readdirSync(join(D, "nemo80")).find((x: string) => x.startsWith("sherpa"))); return { transducer: { encoder: join(d, "encoder.int8.onnx"), decoder: join(d, "decoder.int8.onnx"), joiner: join(d, "joiner.int8.onnx") }, tokens: join(d, "tokens.txt"), numThreads: 2, provider: "cpu", modelType: "nemo_transducer" }; },
};
const QUESTIONS = ["What is a good name for a goldfish?", "Can you tell me a short story about a lighthouse keeper?", "How far away is the moon from the earth?", "What should I make for dinner tonight, I have chicken and rice?", "Explain how a rainbow forms.", "Why is the sky blue and the sunset red?", "How do I get a red wine stain out of a carpet?", "Give me three ideas for a birthday party for a seven year old.", "What is the difference between a crocodile and an alligator?", "Do you remember what we talked about yesterday?"];
async function say(text: string): Promise<Float32Array> { const f = new FormData(); f.set("text", text); f.set("voice", "lj"); const b = new Uint8Array(await (await fetch("http://127.0.0.1:9923/tts", { method: "POST", body: f })).arrayBuffer()); const dv = new DataView(b.buffer, 44), n = Math.floor((b.length - 44) / 2), m = Math.floor(n * 2 / 3), out = new Float32Array(m); for (let i = 0; i < m; i++) { const x = i * 1.5, a = Math.floor(x), c = Math.min(n - 1, a + 1), fr = x - a; out[i] = (dv.getInt16(a * 2, true) * (1 - fr) + dv.getInt16(c * 2, true) * fr) / 32768; } let end = m; while (end > 0 && Math.abs(out[end - 1]!) < 0.01) end--; return out.subarray(0, end + 160); }
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const clips: Float32Array[] = []; for (const q of QUESTIONS) clips.push(await say(q)); const whole: string[] = []; for (const c of clips) whole.push(await transcribe(encodeWav(c)));
for (const [name, cfg] of Object.entries(models)) {
  const rec = new sherpa.OnlineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: cfg(), decodingMethod: "greedy_search", enableEndpoint: false });
  let same = 0, lagSum: number[] = [], wordsOk = 0, wordsAll = 0, compute: number[] = [];
  for (let q = 0; q < clips.length; q++) {
    const s = rec.createStream(); const c0 = clips[q]!; const c = Float32Array.from([...new Float32Array(Number(process.env.LEAD ?? 0)), ...c0]); let lastChange = 0, last = "", t = 0, cpu = 0;
    for (let i = 0; i + 512 <= c.length + 512; i += 512) { const frame = c.subarray(i, i + 512); const t0 = performance.now(); s.acceptWaveform({ sampleRate: 16000, samples: frame.length === 512 ? frame : Float32Array.from([...frame, ...new Float32Array(512 - frame.length)]) }); while (rec.isReady(s)) rec.decode(s); cpu += performance.now() - t0; const text = rec.getResult(s).text; t = (i + 512) / 16; if (text !== last) { last = text; lastChange = t; } }
    // tail padding then final
    const t0 = performance.now(); s.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(8000) }); s.inputFinished(); while (rec.isReady(s)) rec.decode(s); const fin = rec.getResult(s).text; cpu += performance.now() - t0; compute.push(cpu / (c.length / 16000));
    const endMs = c.length / 16; const partialAtEnd = last; const lag = Math.max(0, lastChange - endMs);
    const a = norm(fin), b = norm(whole[q]!); if (a === b) same++; const wa = a.split(" "), wb = b.split(" "); wordsAll += wb.length; wordsOk += wb.filter((w, i) => wa[i] === w).length; lagSum.push(lag);
    if (q < 3) console.log(`  [${name}] "${fin.trim()}" vs whole "${whole[q]}" lastChange ${Math.round(lastChange)} ms, speech end ${Math.round(endMs)} ms`);
  }
  console.log(`${name}: exact match with the whole-utterance text ${same}/${clips.length}; word agreement ${(100 * wordsOk / wordsAll).toFixed(0)}%; partial reached final form ${Math.round(lagSum.reduce((x, y) => x + y, 0) / lagSum.length)} ms after speech end on average; cpu ${(compute.reduce((x, y) => x + y, 0) / compute.length).toFixed(2)}x real time`);
}
process.exit(0);
