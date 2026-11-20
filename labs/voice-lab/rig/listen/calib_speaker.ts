import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readWav, resample } from "./audio";
import { embed, cosine, windowSimilarities } from "./speaker";
const W = "/Users/jessetorres/Developer/github.com/getmaipai/wt/home-brisk-panda-voice-lab";
const ref = readWav(`${W}/data-scratch/voices/voices_store/casual/ref.wav`); const refE = embed(ref.samples, ref.rate);
async function say(text: string, voice: string) { const f = new FormData(); f.set("text", text); f.set("voice", voice); const b = new Uint8Array(await (await fetch("http://127.0.0.1:9923/tts", { method: "POST", body: f })).arrayBuffer()); const dv = new DataView(b.buffer, 44), n = (b.length - 44) >> 1, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = dv.getInt16(i * 2, true) / 32768; return o; }
const texts = ["Oh, I think that is a really good idea, honestly.", "Well, it depends on what you mean, but I would start with the cheaper option first.", "Okay, so the short version is that it takes about twenty minutes."];
const show = (label: string, sims: number[]) => console.log(label.padEnd(44), sims.map((s) => s.toFixed(2)).join(" "), "| min", Math.min(...sims).toFixed(2));
for (const [label, voice] of [["same voice (casual) spoken by the engine", "casual"], ["mild happy mood sample", "casual_mild_happy"], ["a different speaker (lj)", "lj"]] as const) { const sims: number[] = []; for (const t of texts) for (const w of windowSimilarities(await say(t, voice), 24000, refE)) sims.push(w.sim); show(label, sims); }
for (const [label, dir] of [["ex02 library sounds (same speaker)", `${W}/labs/voice-lab/engines/sounds/casual`]] as const) { const sims: number[] = []; for (const f of readdirSync(dir).filter((x) => x.endsWith(".wav"))) { const w = readWav(join(dir, f)); if (w.samples.length / w.rate < 0.5) continue; sims.push(cosine(embed(w.samples, w.rate), refE)); } show(label + " (whole clips)", sims); }
