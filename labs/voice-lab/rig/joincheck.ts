// Are the pitch/level jumps at phrase joins caused by chunking? Synthesizes the same replies (a) phrase by phrase exactly as the lab does and (b) as ONE piece, and measures the same join metric at the same boundaries.
// Usage: bun rig/joincheck.ts   (needs the voice server on 9923; refused while a clean run holds the lab)
import "./lockguard";
import { speech } from "../src/stack";
import { Chunker } from "../src/chunker";
import { joinJump } from "./listen/judge";
import { LevelMatcher } from "../src/levelMatch";
const MATCH = Bun.env.MATCH === "1";
const SEED = Bun.env.SEED ? Number(Bun.env.SEED) : undefined;
const TEXTS = [
  "Hey, I'm doing pretty well. Thanks for asking. Just keeping things calm and steady over here. How are you doing today?",
  "Oh okay, here's a classic. Why did the scarecrow win an award? Because he was outstanding in his field. I hope that got a little smile out of you.",
  "I'm so sorry. That's a heavy loss. Do you want to talk about him, or would you rather just sit in the quiet for a bit?",
  "Uh yeah, I've got one. There was this dragon named Barnaby who lived in a cave filled with flour dust. He had a secret obsession with baking bread. Every morning he would knead the dough with his claws.",
  "Hmm, that depends on the vibe. Bubbles is always a safe bet, or maybe something like Nugget if he's chunky. You could also go with Captain Finn.",
  "Ah, right, the classic. It's because sunlight scatters off gas molecules in the air, and blue light scatters the most. So the sky looks blue to us.",
];
async function synth(text: string, seed?: number): Promise<{ x: Float32Array; rate: number }> {
  let r: Response; if (seed === undefined) r = await speech(text, undefined, { voice: "casual" }); else { const f = new FormData(); f.append("text", text); f.append("voice", "casual"); f.append("seed", String(seed)); r = await fetch("http://127.0.0.1:9923/tts", { method: "POST", body: f }); } const b = new Uint8Array(await r.arrayBuffer()); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const rate = dv.getUint32(24, true); const n = Math.floor((b.length - 44) / 2); const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = dv.getInt16(44 + i * 2, true) / 32768; return { x, rate };
}
const absMed = (a: number[]) => { const v = a.map(Math.abs).sort((p, q) => p - q); return v.length ? v[v.length >> 1]! : NaN; };
const chunk = (t: string) => { const c = new Chunker(); const out = c.push(t); return [...out, ...c.flush()]; };
const chunked: { st: number[]; db: number[] } = { st: [], db: [] }, whole: { st: number[]; db: number[] } = { st: [], db: [] };
for (const t of TEXTS) {
  const parts = chunk(t); const sy = [] as Array<{ x: Float32Array; rate: number }>; for (const p of parts) sy.push(await synth(p, SEED));
  if (MATCH) { const lm = new LevelMatcher(); for (let k = 0; k < sy.length; k++) { const pcm = Int16Array.from(sy[k]!.x, (v) => Math.round(v * 32767)); lm.startChunk(); const outs: Int16Array[] = []; for (let i = 0; i < pcm.length; i += 2400) outs.push(...lm.push(pcm.subarray(i, i + 2400))); outs.push(...lm.endChunk()); const all = new Int16Array(outs.reduce((a, b) => a + b.length, 0)); let o = 0; for (const b of outs) { all.set(b, o); o += b.length; } sy[k] = { x: Float32Array.from(all, (v) => v / 32768), rate: sy[k]!.rate }; } }
  const rate = sy[0]!.rate; const total = sy.reduce((a, s) => a + s.x.length, 0); const all = new Float32Array(total); let o = 0; const at: number[] = []; for (const s of sy) { all.set(s.x, o); o += s.x.length; at.push(o / rate); } at.pop();
  const one = await synth(t, SEED); const frac = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join(" ").length / t.length);
  for (const a of at) { const j = joinJump(all, rate, a); if (j.semitones !== null) { chunked.st.push(j.semitones); chunked.db.push(j.db); } }
  for (const f of frac) { // nearest quiet spot within 0.4 s of the proportional position
    const c0 = Math.round(f * one.x.length), w = Math.round(one.rate * 0.05); let best = c0, bestR = 1e9; for (let i = c0 - Math.round(0.4 * one.rate); i < c0 + Math.round(0.4 * one.rate); i += w) { if (i < w || i + w > one.x.length) continue; let r = 0; for (let k = i; k < i + w; k++) r += one.x[k]! ** 2; if (r < bestR) { bestR = r; best = i; } }
    const j = joinJump(one.x, one.rate, best / one.rate); if (j.semitones !== null) { whole.st.push(j.semitones); whole.db.push(j.db); }
  }
  console.log(`${parts.length} chunks: ${JSON.stringify(parts.map((p) => p.slice(0, 24)))}`);
}
console.log(`CHUNKED  joins ${chunked.st.length}: median |jump| ${absMed(chunked.st).toFixed(1)} st, ${absMed(chunked.db).toFixed(1)} dB; max ${Math.max(...chunked.st.map(Math.abs)).toFixed(1)} st, ${Math.max(...chunked.db.map(Math.abs)).toFixed(1)} dB`);
console.log(`ONE PIECE joins ${whole.st.length}: median |jump| ${absMed(whole.st).toFixed(1)} st, ${absMed(whole.db).toFixed(1)} dB; max ${Math.max(...whole.st.map(Math.abs)).toFixed(1)} st, ${Math.max(...whole.db.map(Math.abs)).toFixed(1)} dB`);
