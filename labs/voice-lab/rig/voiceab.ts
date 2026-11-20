// A/B of base-voice and mood-sample variants on the SAME 4 lines (fixed seed): rate, pitch range, loudness spread, same-speaker similarity; wavs by blind letter.
// Usage: bun rig/voiceab.ts   (voice server on 9923 only; writes voices casual_abE and casual_abF into the lab voice store and wavs into data-scratch/voice-samples/)
import "./lockguard";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readWav, writeWav, resample, rms, pitch } from "./listen/audio";
import { embed, cosine } from "./listen/speaker";
import { transcribe } from "../src/stack";
import { encodeWav } from "../src/wav";
const ROOT = join(import.meta.dir, "..", "..", "..", "data-scratch"); const STORE = join(ROOT, "voices", "voices_store"); const OUT = join(ROOT, "voice-samples"); mkdirSync(OUT, { recursive: true });
const SR = 24000;
const LINES = ["Hey, I'm doing pretty well. Thanks for asking.", "Oh, that sounds like a lot of fun. What are you going to do first?", "Honestly, I think a quiet evening in sounds just about perfect.", "That's a good question. Let me think about it for a second."];
const SEED = 11;
const read = (v: string) => readWav(join(STORE, v, "ref.wav")).samples; const txt = (v: string) => require("node:fs").readFileSync(join(STORE, v, "ref.txt"), "utf8").trim();
const casual = read("casual"), happy = read("casual_happy");
// ---- segments of the casual reference: speech runs separated by 180 ms of quiet
const F = Math.round(SR * 0.02); const lvl: number[] = []; for (let i = 0; i + F <= casual.length; i += F) lvl.push(rms(casual, i, i + F));
const segs: Array<{ a: number; b: number }> = []; { let s = -1, quiet = 0; for (let k = 0; k < lvl.length; k++) { if (lvl[k]! > 0.012) { if (s < 0) s = k; quiet = 0; } else if (s >= 0 && ++quiet >= 9) { segs.push({ a: s * F, b: (k - quiet + 1) * F }); s = -1; quiet = 0; } } if (s >= 0) segs.push({ a: s * F, b: lvl.length * F }); }
const stats = (x: Float32Array) => { const f0: number[] = [], db: number[] = []; const W = Math.round(SR * 0.04); for (let i = 0; i + W <= x.length; i += F) { const r = rms(x, i, i + W); if (r > 0.01) { db.push(20 * Math.log10(r)); const p = pitch(x, SR, i, i + W); if (p > 0) f0.push(p); } } f0.sort((a, b) => a - b); const q = (p: number) => f0[Math.floor((f0.length - 1) * p)]!; const mean = db.reduce((a, b) => a + b, 0) / Math.max(1, db.length);
  return { voicedSec: db.length * 0.02, pitchRangeSt: f0.length > 10 ? 12 * Math.log2(q(0.9) / q(0.1)) : 0, loudStdDb: Math.sqrt(db.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, db.length)), medianF0: f0.length ? q(0.5) : 0 }; };
const cand = segs.filter((s) => s.b - s.a > SR * 1.2 && s.b - s.a < SR * 7).map((s) => { const st = stats(casual.subarray(s.a, s.b)); return { ...s, animation: (st.pitchRangeSt + st.loudStdDb) / ((s.b - s.a) / SR) ** 0.0 }; }).sort((a, b) => b.animation - a.animation);
let total = 0; const pick: typeof cand = []; for (const c of cand) { const d = (c.b - c.a) / SR; if (total + d <= 15) { pick.push(c); total += d; } if (total >= 12) break; }
pick.sort((a, b) => a.a - b.a);
const gap = new Float32Array(Math.round(SR * 0.15)); const parts: Float32Array[] = []; pick.forEach((s, i) => { if (i) parts.push(gap); parts.push(casual.subarray(s.a, s.b)); });
const refF = Float32Array.from(parts.flatMap((p) => Array.from(p))); const textF = await transcribe(encodeWav(resample(refF, SR, 16000), 16000));
// ---- E: the mood clip first (about 2.6 s, cut at the quietest point), the everyday clip LAST (its tail drives the delivery)
let cut = Math.round(SR * 2.6), bestR = 1e9; for (let i = Math.round(SR * 2.3); i < Math.round(SR * 3.0); i += F) { const r = rms(happy, i, i + F); if (r < bestR) { bestR = r; cut = i; } }
const refE = Float32Array.from([...happy.subarray(0, cut), ...gap, ...casual]); const textE = "They better put you on roller skates. " + txt("casual");
for (const [id, wav, text] of [["casual_abE", refE, textE], ["casual_abF", refF, textF]] as const) {
  const d = join(STORE, id); mkdirSync(d, { recursive: true }); writeWav(join(d, "ref.wav"), wav, SR); writeFileSync(join(d, "ref.txt"), text); writeFileSync(join(d, "meta.json"), JSON.stringify({ source_seconds: +(wav.length / SR).toFixed(2), seconds: +(wav.length / SR).toFixed(2), created: Math.floor(Date.now() / 1000) }));
}
console.log(`F (animated casual): ${pick.length} segments, ${(refF.length / SR).toFixed(1)} s, words: ${textF.slice(0, 120)}...`);
const VARIANTS: Array<{ name: string; voice: string }> = [{ name: "casual (current)", voice: "casual" }, { name: "casual + mild happy at the END (the live mild sample)", voice: "casual_mild_happy" }, { name: "casual_blend_happy", voice: "casual_blend_happy" }, { name: "E: mood clip FIRST, everyday clip last", voice: "casual_abE" }, { name: "F: animated 10 to 15 s of the casual clip", voice: "casual_abF" }];
async function synth(voice: string, text: string): Promise<Float32Array> {
  const f = new FormData(); f.append("text", text); f.append("voice", voice); f.append("seed", String(SEED)); const r = await fetch("http://127.0.0.1:9923/tts", { method: "POST", body: f }); if (!r.ok) throw new Error(`${voice}: ${r.status} ${await r.text()}`);
  const b = new Uint8Array(await r.arrayBuffer()); const dv = new DataView(b.buffer); const n = Math.floor((b.length - 44) / 2); const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = dv.getInt16(44 + i * 2, true) / 32768; return x;
}
const refEmb = embed(casual.subarray(0, Math.round(SR * 12)), SR);
const letters = ["A", "B", "C", "D", "E"]; const order = VARIANTS.map((_, i) => i).sort(() => Math.random() - 0.5); const key: Record<string, string> = {};
const rows: string[] = [];
for (const [k, vi] of order.entries()) {
  const v = VARIANTS[vi]!; const letter = letters[k]!; key[letter] = `${v.name} [${v.voice}]`;
  const outs: Float32Array[] = []; for (const line of LINES) outs.push(await synth(v.voice, line));
  const sil = new Float32Array(Math.round(SR * 0.6)); const all = Float32Array.from(outs.flatMap((o, i) => (i ? [...sil, ...o] : [...o]))); writeWav(join(OUT, `${letter}.wav`), all, SR);
  const st = outs.map(stats); const words = LINES.join(" ").split(/\s+/).length; const voiced = st.reduce((a, s) => a + s.voicedSec, 0);
  const pr = st.reduce((a, s) => a + s.pitchRangeSt, 0) / st.length, ld = st.reduce((a, s) => a + s.loudStdDb, 0) / st.length, f0 = st.reduce((a, s) => a + s.medianF0, 0) / st.length;
  const sims = outs.map((o) => cosine(embed(o, SR), refEmb)); const sim = sims.reduce((a, b) => a + b, 0) / sims.length;
  rows.push(`${v.name.padEnd(52)} rate ${(words / voiced).toFixed(2)} words per voiced s | pitch range ${pr.toFixed(1)} st (median f0 ${f0.toFixed(0)} Hz) | loudness spread ${ld.toFixed(1)} dB | same-speaker ${sim.toFixed(2)} | audio ${(all.length / SR).toFixed(1)} s`);
}
writeFileSync(join(ROOT, "voice-samples-key.json"), JSON.stringify(key, null, 1));
console.log(rows.join("\n")); console.log(`wavs: ${OUT}/A.wav ... E.wav (blind letters); key: ${join(ROOT, "voice-samples-key.json")} (not in the samples folder)`);
