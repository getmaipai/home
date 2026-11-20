// Continuation conditioning experiment: the same chunked replies, plain vs cont=1 (each chunk conditioned on the previous chunk's audio and words). Join jumps, same-speaker similarity, and time per later chunk.
// Usage: bun rig/joincheck3.ts [both]   (voice server on 9923 with the continuation code loaded; refused while a clean run holds the lab)
import "./lockguard";
import { Chunker } from "../src/chunker";
import { joinJump } from "./listen/judge";
import { readWav } from "./listen/audio";
import { embed, cosine } from "./listen/speaker";
import { join } from "node:path";
const MODE = process.argv[2] === "both" ? "both" : "tail";
const ROOT = join(import.meta.dir, "..", "..", "..", "data-scratch");
const TEXTS = ["Hey, I'm doing pretty well. Thanks for asking. Just keeping things calm and steady over here. How are you doing today?", "Oh okay, here's a classic. Why did the scarecrow win an award? Because he was outstanding in his field. I hope that got a little smile out of you.", "I'm so sorry. That's a heavy loss. Do you want to talk about him, or would you rather just sit in the quiet for a bit?", "Uh yeah, I've got one. There was this dragon named Barnaby who lived in a cave filled with flour dust. He had a secret obsession with baking bread. Every morning he would knead the dough with his claws.", "Hmm, that depends on the vibe. Bubbles is always a safe bet, or maybe something like Nugget if he's chunky. You could also go with Captain Finn.", "Ah, right, the classic. It's because sunlight scatters off gas molecules in the air, and blue light scatters the most. So the sky looks blue to us."];
async function synth(text: string, reply?: string): Promise<{ x: Float32Array; ms: number; rate: number }> {
  const f = new FormData(); f.append("text", text); f.append("voice", "casual"); if (reply) { f.append("reply", reply); f.append("cont", MODE === "both" ? "2" : "1"); }
  const t0 = performance.now(); const r = await fetch("http://127.0.0.1:9923/tts", { method: "POST", body: f }); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const b = new Uint8Array(await r.arrayBuffer()); const ms = performance.now() - t0; const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const n = Math.floor((b.length - 44) / 2); const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = dv.getInt16(44 + i * 2, true) / 32768; return { x, ms, rate: dv.getUint32(24, true) };
}
const chunk = (t: string) => { const c = new Chunker(); return [...c.push(t), ...c.flush()]; };
const refEmb = embed(readWav(join(ROOT, "voices", "voices_store", "casual", "ref.wav")).samples.subarray(0, 24000 * 12), 24000);
const res: Record<string, { st: number[]; db: number[]; sim: number[]; laterMs: number[]; firstMs: number[]; wordsOk: number }> = { plain: { st: [], db: [], sim: [], laterMs: [], firstMs: [], wordsOk: 0 }, cont: { st: [], db: [], sim: [], laterMs: [], firstMs: [], wordsOk: 0 } };
for (let rep = 0; rep < 3; rep++) for (const [ti, t] of TEXTS.entries()) for (const mode of ["plain", "cont"] as const) {
  const parts = chunk(t); const id = `jc3-${rep}-${ti}-${Math.random().toString(36).slice(2, 6)}`; const sy: Float32Array[] = []; let rate = 24000;
  for (const [i, p] of parts.entries()) { const s = await synth(p, mode === "cont" ? id : undefined); sy.push(s.x); rate = s.rate; (i === 0 ? res[mode]!.firstMs : res[mode]!.laterMs).push(s.ms); }
  const all = Float32Array.from(sy.flatMap((x) => Array.from(x))); let o = 0; const at: number[] = []; for (const x of sy) { o += x.length; at.push(o / rate); } at.pop();
  for (const a of at) { const j = joinJump(all, rate, a); if (j.semitones !== null) { res[mode]!.st.push(j.semitones); res[mode]!.db.push(j.db); } }
  for (const x of sy) if (x.length > rate * 1.2) res[mode]!.sim.push(cosine(embed(x, rate), refEmb));
}
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / Math.max(1, a.length); const absMed = (a: number[]) => { const v = a.map(Math.abs).sort((p, q) => p - q); return v[v.length >> 1]!; }, mx = (a: number[]) => Math.max(...a.map(Math.abs));
for (const m of ["plain", "cont"] as const) { const r = res[m]!; console.log(`${m.padEnd(6)} ${r.st.length} joins: |st| median ${absMed(r.st).toFixed(1)} max ${mx(r.st).toFixed(1)}; |dB| median ${absMed(r.db).toFixed(1)} max ${mx(r.db).toFixed(1)}; same-speaker ${mean(r.sim).toFixed(2)} (${r.sim.length} chunks); first chunk ${mean(r.firstMs).toFixed(0)} ms, later chunks ${mean(r.laterMs).toFixed(0)} ms`); }
