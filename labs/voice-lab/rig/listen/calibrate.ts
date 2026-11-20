// Calibration of the listener's thresholds on known-good audio (the voice engine's own clean output, phrases joined the way the lab joins them)
// and known-bad audio made from it (a no-buffer gap, a different speaker in the middle, a loudness jump). A check that cannot fail a known-bad case is not a check.
import { holes, clicks, joinJump, joinFails, LIMITS } from "./judge";
import { windowSimilarities, embed } from "./speaker";
import { readWav } from "./audio";
const W = "/Users/jessetorres/Developer/github.com/getmaipai/wt/home-brisk-panda-voice-lab";
async function say(text: string, voice: string) { const f = new FormData(); f.set("text", text); f.set("voice", voice); const b = new Uint8Array(await (await fetch("http://127.0.0.1:9923/tts", { method: "POST", body: f })).arrayBuffer()); const dv = new DataView(b.buffer, 44), n = (b.length - 44) >> 1, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = dv.getInt16(i * 2, true) / 32768; return o; }
const phrasesSets = [["Oh, I think that is a really good idea,", "honestly, I would go with the first option.", "It is simpler and it costs less."], ["Well, it depends on what you mean,", "but I would start by looking at the cheaper one.", "Then you can always change your mind later."], ["Okay, so the short version is this.", "It takes about twenty minutes,", "and then you just let it rest for a bit."], ["Hmm, that is a good question.", "I am not completely sure,", "but I think the answer is somewhere in the middle."]];
const cat = (...p: Float32Array[]) => Float32Array.from(p.flatMap((x) => [...x]));
const refW = readWav(`${W}/data-scratch/voices/voices_store/casual/ref.wav`); const refE = embed(refW.samples, refW.rate);
const good: Float32Array[][] = []; for (const set of phrasesSets) { const parts: Float32Array[] = []; for (const t of set) parts.push(await say(t, "casual")); good.push(parts); }
const other = await say("This is a sentence spoken by somebody else entirely.", "lj");
const rate = 24000; const bounds = (parts: Float32Array[]) => { let at = 0; return parts.slice(0, -1).map((p) => (at += p.length / rate)); }; const stats = { holes: [] as number[], clicks: [] as number[], semis: [] as number[], dbs: [] as number[], sims: [] as number[] };
for (const parts of good) { const x = cat(...parts); stats.holes.push(holes(x, rate, LIMITS.gapMs, bounds(parts)).length); stats.clicks.push(clicks(x, rate, bounds(parts)).length); let at = 0; for (const p of parts.slice(0, -1)) { at += p.length / rate; const j = joinJump(x, rate, at); if (j.semitones !== null) stats.semis.push(Math.abs(j.semitones)); stats.dbs.push(Math.abs(j.db)); } for (const w of windowSimilarities(x, rate, refE)) stats.sims.push(w.sim); }
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]!.toFixed(2);
console.log(`KNOWN GOOD (4 replies of 3 phrases, voice engine output, phrases joined as the lab joins them)`);
console.log(`  holes per reply ${stats.holes.join(",")}; clicks per reply ${stats.clicks.join(",")}`);
console.log(`  phrase-join pitch jump (semitones): median ${q(stats.semis, 0.5)} p90 ${q(stats.semis, 0.9)} max ${q(stats.semis, 1)}; loudness jump (dB): median ${q(stats.dbs, 0.5)} p90 ${q(stats.dbs, 0.9)} max ${q(stats.dbs, 1)}`);
console.log(`  speaker similarity windows: min ${Math.min(...stats.sims).toFixed(2)} median ${q(stats.sims, 0.5)}`);
const x0 = cat(...good[0]!);
const noBuffer = cat(good[0]![0]!, new Float32Array(rate * 0.1), good[0]![1]!, good[0]![2]!); const hb = holes(noBuffer, rate, LIMITS.gapMs, bounds([good[0]![0]!, good[0]![1]!, good[0]![2]!]).slice(0, 0));
const stranger = cat(good[0]![0]!, other, good[0]![2]!); const simS = windowSimilarities(stranger, rate, refE); const shifted = cat(good[0]![0]!, Float32Array.from({ length: Math.floor(good[0]![1]!.length / 1.8) }, (_, i) => good[0]![1]![Math.floor(i * 1.8)]!), good[0]![2]!); const swapJoin = joinJump(shifted, rate, good[0]![0]!.length / rate);
const burst = Float32Array.from({ length: rate * 0.8 }, (_, i) => 0.3 * Math.sin(i * 0.35) * (0.5 + 0.5 * Math.sin(i * 0.0015))); const laughFlat = cat(good[0]![0]!, burst, Float32Array.from(good[0]![1]!, (v) => v * 0.25), good[0]![2]!); const t0 = good[0]![0]!.length / rate; const lj = joinJump(laughFlat, rate, t0, t0 + 0.8);
const clickBad = Float32Array.from(x0); for (let i = 30000; i < 30012; i++) clickBad[i] = 0.9;
const results: Array<[string, boolean]> = [["no-buffer gap (100 ms of zeros) is found as a hole", hb.length > LIMITS.gapsPerReply], ["a different speaker in the middle gives a window below the similarity limit", Math.min(...simS.map((w) => w.sim)) < LIMITS.speakerSim], ["a phrase an octave-ish higher (pitch jump about +8 semitones) is a join failure", joinFails(swapJoin)], ["speech that comes back much quieter after a laugh is a join failure", joinFails(lj)], ["a dropped-piece click is found", clicks(clickBad, rate, []).length > LIMITS.clicksPerReply], ["clean audio has no holes", stats.holes.every((h) => h <= LIMITS.gapsPerReply)], ["clean audio has no clicks", stats.clicks.every((c) => c <= LIMITS.clicksPerReply)]];
console.log(`KNOWN BAD: stranger windows min ${Math.min(...simS.map((w) => w.sim)).toFixed(2)}; pitch-shifted join ${JSON.stringify(swapJoin)}; quiet-flat join ${JSON.stringify(lj)}`);
for (const [name, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
