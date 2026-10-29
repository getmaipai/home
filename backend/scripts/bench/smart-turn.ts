/**
 * DUPLEX-02 Smart Turn bench: does the Stack's end-of-turn check (POST /v1/audio/endpoint) tell a finished
 * sentence from one the speaker has stopped in the middle of? Run on the Mac Studio, where the Stack answers on 8770.
 *
 * It speaks each line through the Stack's own TTS, pads the clip with trailing silence, and asks the endpoint.
 * Finished lines should come back complete, unfinished ones should not. TTS is not a person talking (no ums,
 * no breath, even pace), so read the numbers as "does it work at all", not as the final word on real speech.
 *
 *   bun run scripts/bench/smart-turn.ts [--stack http://127.0.0.1:8770]
 */
const stack = process.argv.includes("--stack") ? process.argv[process.argv.indexOf("--stack") + 1]! : "http://127.0.0.1:8770";

const COMPLETE = [
  "What is the weather going to be like tomorrow?",
  "Can you add milk and eggs to the shopping list?",
  "I think we should leave around five.",
  "Please turn off the lights in the kitchen.",
  "My favorite color is green.",
  "Tell me a story about a dragon who is afraid of fire.",
  "That sounds great, thank you.",
  "How long does it take to boil an egg?",
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
];
const PADS_MS = [300, 600, 1000];

export {};

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
      const end = Math.min(buf.length, body + size);
      const n = Math.floor((end - body) / 2);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(body + i * 2, true);
      return { rate, channels, samples };
    }
    o = body + size + (size % 2);
  }
  throw new Error("the speech WAV has no data chunk");
}

function toWav(p: Pcm, padMs: number): Uint8Array {
  const pad = Math.round((p.rate * padMs) / 1000) * p.channels;
  const n = p.samples.length + pad;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  put(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); put(8, "WAVE"); put(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, p.channels, true); v.setUint32(24, p.rate, true);
  v.setUint32(28, p.rate * p.channels * 2, true); v.setUint16(32, p.channels * 2, true); v.setUint16(34, 16, true);
  put(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < p.samples.length; i++) v.setInt16(44 + i * 2, p.samples[i]!, true);
  return out;
}

async function speak(text: string): Promise<Pcm> {
  const form = new FormData();
  form.append("text", text);
  form.append("model", "tts");
  const res = await fetch(`${stack}/v1/audio/speech`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`speech ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseWav(new Uint8Array(await res.arrayBuffer()));
}

async function endpoint(wav: Uint8Array): Promise<{ complete: boolean; probability: number; ms: number }> {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "turn.wav");
  const t0 = performance.now();
  const res = await fetch(`${stack}/v1/audio/endpoint`, { method: "POST", body: form });
  const ms = performance.now() - t0;
  if (!res.ok) throw new Error(`endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { complete: boolean; probability: number };
  return { complete: j.complete, probability: j.probability, ms };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; };
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

const rows: Array<{ text: string; finished: boolean; pad: number; complete: boolean; p: number; ms: number }> = [];
await endpoint(toWav({ rate: 16000, channels: 1, samples: new Int16Array(16000) }, 0)); // warm the model
for (const [list, finished] of [[COMPLETE, true], [UNFINISHED, false]] as const) {
  for (const text of list) {
    const pcm = await speak(text);
    for (const pad of PADS_MS) {
      const r = await endpoint(toWav(pcm, pad));
      rows.push({ text, finished, pad, complete: r.complete, p: r.probability, ms: r.ms });
    }
  }
}

console.log("\nline | trailing silence | said complete? | probability | call ms");
for (const r of rows) console.log(`${r.finished ? "FINISHED  " : "UNFINISHED"} | ${String(r.pad).padStart(4)} ms | ${r.complete ? "yes" : "no "} | ${r.p.toFixed(2)} | ${Math.round(r.ms)} | ${r.text}`);
console.log("\nBy trailing silence (what the hub would do if it asked after that much quiet):");
for (const pad of PADS_MS) {
  const f = rows.filter((r) => r.finished && r.pad === pad), u = rows.filter((r) => !r.finished && r.pad === pad);
  const hit = f.filter((r) => r.complete).length, rej = u.filter((r) => !r.complete).length;
  console.log(`  ${pad} ms: finished lines called complete ${hit}/${f.length} (${pct(hit, f.length)}), unfinished lines held open ${rej}/${u.length} (${pct(rej, u.length)})`);
}
console.log(`\nMedian endpoint call: ${Math.round(median(rows.map((r) => r.ms)))} ms (max ${Math.round(Math.max(...rows.map((r) => r.ms)))} ms)`);
const wrongCuts = rows.filter((r) => !r.finished && r.complete).length;
console.log(`Cut-offs (unfinished line called complete): ${wrongCuts}/${rows.filter((r) => !r.finished).length}`);
