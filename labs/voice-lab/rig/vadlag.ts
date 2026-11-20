// How long after a person's voice really ends does the speech detector say "not speech"? (offline, same detector as the lab)
import { FrameVad } from "../src/vad";
const TTS = "http://127.0.0.1:9923";
const texts = ["What is a good name for a goldfish?", "How far away is the moon?", "Tell me a joke about cats.", "Why is the sky blue?", "What time is it in Tokyo right now?"];
const lags: number[] = [];
for (const text of texts) {
  const f = new FormData(); f.set("text", text); f.set("voice", "lj");
  const b = new Uint8Array(await (await fetch(TTS + "/tts", { method: "POST", body: f })).arrayBuffer());
  const dv = new DataView(b.buffer, 44), n = Math.floor((b.length - 44) / 2), m = Math.floor(n * 2 / 3), x = new Float32Array(m + 16000);
  for (let i = 0; i < m; i++) { const p = i * 1.5, a = Math.floor(p), c = Math.min(n - 1, a + 1), fr = p - a; x[i] = (dv.getInt16(a * 2, true) * (1 - fr) + dv.getInt16(c * 2, true) * fr) / 32768; }
  // true end: last 32 ms frame with rms above 0.01
  let endFrame = 0; for (let i = 0; i + 512 <= m; i += 512) { let s = 0; for (let j = 0; j < 512; j++) s += x[i + j]! ** 2; if (Math.sqrt(s / 512) > 0.01) endFrame = i / 512; }
  const vad = new FrameVad(); let lastSpeech = -1; const flags: number[] = [];
  for (let i = 0, k = 0; i + 512 <= x.length; i += 512, k++) { const v = vad.detect(x.subarray(i, i + 512)); flags.push(v ? 1 : 0); if (v) lastSpeech = k; }
  lags.push((lastSpeech - endFrame) * 32); console.log(text.padEnd(40), "real end frame", endFrame, "last 'speech' frame", lastSpeech, "lag", (lastSpeech - endFrame) * 32, "ms", vad.mode);
}
console.log("median lag ms", lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)]);
