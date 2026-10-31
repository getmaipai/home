/**
 * Measure Stack Smart Turn with Home's generated preset voices only.
 * This script reads no Home state and writes no database or setting. It only
 * calls Stack /v1/audio/speech and /v1/audio/endpoint.
 *
 *   bun run scripts/bench/smart-turn.ts [--stack URL] [--voices all|a,b,c]
 *   bun run scripts/bench/smart-turn.ts --help
 */
import { VOICE_PRESET_NAMES } from "../../src/settings/voiceKeys";
import { parseVoiceSelection, scoreRows, type BenchRow } from "./smartTurnMetrics";

const USAGE = `Smart Turn generated-voice bench

Usage: bun run scripts/bench/smart-turn.ts [--stack URL] [--voices all|a,b,c]

Options:
  --stack URL       Stack base URL (default: http://127.0.0.1:8770)
  --voices SELECT   all presets, or comma-separated preset IDs
                    Default: alba,anna,eponine,mary,giovanni,estelle
  --help            Print this help without contacting the Stack`;

if (process.argv.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

const stack = option("--stack", "http://127.0.0.1:8770").replace(/\/$/, "");
const DEFAULT_VOICES = ["alba", "anna", "eponine", "mary", "giovanni", "estelle"];
const voices = parseVoiceSelection(option("--voices", DEFAULT_VOICES.join(",")), VOICE_PRESET_NAMES);

const COMPLETE = [
  "What is the weather going to be like tomorrow?",
  "Can you add milk and eggs to the shopping list?",
  "I think we should leave around five.",
  "Please turn off the lights in the kitchen.",
  "My favorite color is green.",
  "Tell me a story about a dragon who is afraid of fire.",
  "That sounds great, thank you.",
  "How long does it take to boil an egg?",
  "I finished my homework before dinner.",
  "The soccer game starts at four o'clock.",
  "Please remind me to call Grandma tonight.",
  "I put my blue backpack by the front door.",
  "We watched the movie and liked the ending.",
  "My science project is about volcanoes.",
  "I fed the dog and filled his water bowl.",
  "The library book is due next Tuesday.",
  "Yes.",
  "No thanks.",
  "Milk, eggs, and bread.",
  "I want the red one, please.",
];
const UNFINISHED = [
  "What is the weather going to be like",
  "Can you add milk and eggs to the",
  "I think we should leave around",
  "Please turn off the lights in the",
  "My favorite color is, um,",
  "Tell me a story about a dragon who is",
  "That sounds great, but I was wondering if",
  "How long does it take to",
  "I finished my homework before",
  "The soccer game starts at",
  "Please remind me to call Grandma",
  "I put my blue backpack by the",
  "We watched the movie and",
  "My science project is about",
  "I fed the dog and filled his",
  "The library book is due next",
  "Yes, because",
  "No thanks, I was going to",
  "Milk, eggs, and",
  "I want the red one, so, like,",
  "I was going to ask you, um",
  "Can we go outside after lunch,",
  "I tried to finish it, but",
  "So, like, I think we should",
];
const PADS_MS = [300, 600, 1000];

interface Pcm { rate: number; channels: number; samples: Int16Array }

function parseWav(buf: Uint8Array): Pcm {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("the speech reply is not a WAV file");
  let rate = 0, channels = 0, bits = 0, fmt = 0;
  for (let o = 12; o + 8 <= buf.length;) {
    const id = tag(o), size = v.getUint32(o + 4, true), body = o + 8;
    if (id === "fmt ") { fmt = v.getUint16(body, true); channels = v.getUint16(body + 2, true); rate = v.getUint32(body + 4, true); bits = v.getUint16(body + 14, true); }
    if (id === "data") {
      if (fmt !== 1 || bits !== 16) throw new Error(`speech WAV is format ${fmt} at ${bits} bits; this bench reads 16-bit PCM only`);
      const end = Math.min(buf.length, body + size), n = Math.floor((end - body) / 2), samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(body + i * 2, true);
      return { rate, channels, samples };
    }
    o = body + size + (size % 2);
  }
  throw new Error("the speech WAV has no data chunk");
}

function toWav(p: Pcm, padMs: number): Uint8Array {
  const pad = Math.round((p.rate * padMs) / 1000) * p.channels, n = p.samples.length + pad;
  const out = new Uint8Array(44 + n * 2), v = new DataView(out.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  put(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); put(8, "WAVE"); put(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, p.channels, true); v.setUint32(24, p.rate, true);
  v.setUint32(28, p.rate * p.channels * 2, true); v.setUint16(32, p.channels * 2, true); v.setUint16(34, 16, true);
  put(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < p.samples.length; i++) v.setInt16(44 + i * 2, p.samples[i]!, true);
  return out;
}

async function speak(text: string, voice: string): Promise<Pcm> {
  const form = new FormData();
  form.append("text", text); form.append("voice_url", voice); form.append("model", "tts");
  const res = await fetch(`${stack}/v1/audio/speech`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`speech (${voice}) ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseWav(new Uint8Array(await res.arrayBuffer()));
}

async function endpoint(wav: Uint8Array): Promise<{ complete: boolean; probability: number; ms: number }> {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "turn.wav");
  const t0 = performance.now(), res = await fetch(`${stack}/v1/audio/endpoint`, { method: "POST", body: form }), ms = performance.now() - t0;
  if (!res.ok) throw new Error(`endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { complete: boolean; probability: number };
  return { complete: j.complete, probability: j.probability, ms };
}

const rows: BenchRow[] = [];
await endpoint(toWav({ rate: 16000, channels: 1, samples: new Int16Array(16000) }, 0));
const cases = [...COMPLETE.map((text) => ({ text, finished: true })), ...UNFINISHED.map((text) => ({ text, finished: false }))];
for (const voice of voices) {
  console.log(`Speaking ${cases.length} lines in ${voice}...`);
  for (const item of cases) {
    const pcm = await speak(item.text, voice);
    for (const pad of PADS_MS) {
      const result = await endpoint(toWav(pcm, pad));
      rows.push({ ...item, voice, pad, complete: result.complete, probability: result.probability, ms: result.ms });
    }
  }
}

const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : "n/a";
const summary = (subset: BenchRow[]) => scoreRows(subset);
console.log("\nPer pad (all selected voices pooled):");
console.log("pad | finished accuracy | unfinished accuracy | unfinished false complete | endpoint median / p90");
for (const pad of PADS_MS) {
  const s = summary(rows.filter((r) => r.pad === pad));
  console.log(`${pad} ms | ${pct(s.finishedCorrect, s.finishedTotal)} (${s.finishedCorrect}/${s.finishedTotal}) | ${pct(s.unfinishedCorrect, s.unfinishedTotal)} (${s.unfinishedCorrect}/${s.unfinishedTotal}) | ${pct(s.falseComplete, s.unfinishedTotal)} (${s.falseComplete}/${s.unfinishedTotal}) | ${Math.round(s.medianMs)} / ${Math.round(s.p90Ms)} ms`);
}
console.log("\nPer voice at 600 ms:");
console.log("voice | finished accuracy | unfinished accuracy | unfinished false complete | median / p90");
for (const voice of voices) {
  const s = summary(rows.filter((r) => r.voice === voice && r.pad === 600));
  console.log(`${voice} | ${pct(s.finishedCorrect, s.finishedTotal)} | ${pct(s.unfinishedCorrect, s.unfinishedTotal)} | ${pct(s.falseComplete, s.unfinishedTotal)} | ${Math.round(s.medianMs)} / ${Math.round(s.p90Ms)} ms`);
}
const all = summary(rows);
console.log(`\nOverall (all voices and pads): finished ${pct(all.finishedCorrect, all.finishedTotal)}; unfinished ${pct(all.unfinishedCorrect, all.unfinishedTotal)}; unfinished false complete ${pct(all.falseComplete, all.unfinishedTotal)}; endpoint median ${Math.round(all.medianMs)} ms, p90 ${Math.round(all.p90Ms)} ms.`);
const at600 = summary(rows.filter((r) => r.pad === 600));
const keep = at600.falseComplete / at600.unfinishedTotal < 0.10 && at600.finishedCorrect / at600.finishedTotal >= 0.90;
console.log(`Verdict: ${keep ? "thresholds met" : "thresholds not met"}. Keep the existing silence timer unless unfinished-line false-complete is under 10% at the 600 ms pad AND finished-line accuracy is at least 90%.`);
