// Level matching on the SAME synthesized chunks: join jumps raw vs matched (and one-piece for reference). 3 repeats of 6 replies.
// Usage: bun rig/joincheck2.ts   (voice server on 9923; refused while a clean run holds the lab)
import "./lockguard";
import { speech } from "../src/stack";
import { Chunker } from "../src/chunker";
import { joinJump } from "./listen/judge";
import { LevelMatcher } from "../src/levelMatch";
const TEXTS = ["Hey, I'm doing pretty well. Thanks for asking. Just keeping things calm and steady over here. How are you doing today?", "Oh okay, here's a classic. Why did the scarecrow win an award? Because he was outstanding in his field. I hope that got a little smile out of you.", "I'm so sorry. That's a heavy loss. Do you want to talk about him, or would you rather just sit in the quiet for a bit?", "Uh yeah, I've got one. There was this dragon named Barnaby who lived in a cave filled with flour dust. He had a secret obsession with baking bread. Every morning he would knead the dough with his claws.", "Hmm, that depends on the vibe. Bubbles is always a safe bet, or maybe something like Nugget if he's chunky. You could also go with Captain Finn.", "Ah, right, the classic. It's because sunlight scatters off gas molecules in the air, and blue light scatters the most. So the sky looks blue to us."];
async function synth(text: string) { const r = await speech(text, undefined, { voice: "casual" }); const b = new Uint8Array(await r.arrayBuffer()); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const n = Math.floor((b.length - 44) / 2); const x = new Int16Array(n); for (let i = 0; i < n; i++) x[i] = dv.getInt16(44 + i * 2, true); return { x, rate: dv.getUint32(24, true) }; }
const chunk = (t: string) => { const c = new Chunker(); return [...c.push(t), ...c.flush()]; };
const cat = (xs: Int16Array[]) => { const o = new Int16Array(xs.reduce((a, b) => a + b.length, 0)); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
const f32 = (x: Int16Array) => Float32Array.from(x, (v) => v / 32768);
const raw = { st: [] as number[], db: [] as number[] }, matched = { st: [] as number[], db: [] as number[] };
for (let rep = 0; rep < 3; rep++) for (const t of TEXTS) {
  const parts = chunk(t); const sy: Int16Array[] = []; let rate = 24000; for (const p of parts) { const s = await synth(p); sy.push(s.x); rate = s.rate; }
  const lm = new LevelMatcher(); const m: Int16Array[] = sy.map((pcm) => { lm.startChunk(); const outs: Int16Array[] = []; for (let i = 0; i < pcm.length; i += 2400) outs.push(...lm.push(pcm.subarray(i, i + 2400))); outs.push(...lm.endChunk()); return cat(outs); });
  const bounds = (xs: Int16Array[]) => { const at: number[] = []; let o = 0; for (const x of xs) { o += x.length; at.push(o / rate); } at.pop(); return at; };
  const A = f32(cat(sy)), B = f32(cat(m));
  for (const a of bounds(sy)) { const j = joinJump(A, rate, a); if (j.semitones !== null) { raw.st.push(j.semitones); raw.db.push(j.db); } }
  for (const a of bounds(m)) { const j = joinJump(B, rate, a); if (j.semitones !== null) { matched.st.push(j.semitones); matched.db.push(j.db); } }
}
const absMed = (a: number[]) => { const v = a.map(Math.abs).sort((p, q) => p - q); return v[v.length >> 1]!; }, mx = (a: number[]) => Math.max(...a.map(Math.abs));
const mean = (a: number[]) => a.map(Math.abs).reduce((p, q) => p + q, 0) / a.length;
console.log(`RAW      ${raw.st.length} joins: |dB| median ${absMed(raw.db).toFixed(1)} mean ${mean(raw.db).toFixed(1)} max ${mx(raw.db).toFixed(1)}; |st| median ${absMed(raw.st).toFixed(1)} max ${mx(raw.st).toFixed(1)}`);
console.log(`MATCHED  ${matched.st.length} joins: |dB| median ${absMed(matched.db).toFixed(1)} mean ${mean(matched.db).toFixed(1)} max ${mx(matched.db).toFixed(1)}; |st| median ${absMed(matched.st).toFixed(1)} max ${mx(matched.st).toFixed(1)}`);
