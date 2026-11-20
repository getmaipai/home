// Measuring rig: speaks ~30 scripted turns into the lab's /ws in real time and reports, per turn:
// time to first sound, voice speed vs real time while the reply is being written, audio underruns
// (simulated page player: starts after JITTER ms buffered, gaps when the buffer runs dry), plus median/worst.
// Usage: bun rig/measure.ts <secret-file> [--n 30] [--jitter 120] [--voice id] [--json out.json]
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1]! : d; };
const secretFile = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true) ?? "";
const N = Number(opt("n", "30")), JITTER = Number(opt("jitter", "120")), VOICE = opt("voice", ""), OUT = opt("json", "");
const LAB = opt("lab", "127.0.0.1:9931"), TTS = "http://127.0.0.1:9923";
const secret = (await Bun.file(secretFile).text()).trim();
const QUESTIONS = [
  "What is a good name for a goldfish?", "Can you tell me a short story about a lighthouse keeper?", "How far away is the moon?",
  "What should I make for dinner tonight, I have chicken and rice?", "Explain how a rainbow forms.", "Tell me a joke about cats.",
  "What is the capital of Australia?", "How do I get a red wine stain out of a carpet?", "Why is the sky blue?",
  "Give me three ideas for a birthday party for a seven year old.", "What is the difference between a crocodile and an alligator?",
  "How long should I boil an egg?", "Can you help me pick a book to read this weekend?", "What do penguins eat?",
  "Tell me something interesting about octopuses.", "How does a refrigerator keep things cold?", "What is a good bedtime routine for a toddler?",
  "Describe a rainy day in a few sentences.", "How many days are there in a leap year?", "What is the tallest mountain in the world?",
  "I feel a little tired today, any advice?", "What is the best way to learn guitar?", "Why do cats purr?",
  "Can you spell necessary for me?", "What is two hundred times fifteen?", "Tell me about the history of pizza.",
  "What can I do on a sunny afternoon with the kids?", "How do airplanes stay in the air?", "Do you like music?", "What is a good name for a puppy?",
].slice(0, N);
const TAGS = ["lj"];
async function say(text: string): Promise<Float32Array> {
  const f = new FormData(); f.set("text", text); f.set("voice", TAGS[0]!);
  const b = new Uint8Array(await (await fetch(TTS + "/tts", { method: "POST", body: f })).arrayBuffer());
  const dv = new DataView(b.buffer, 44), n = Math.floor((b.length - 44) / 2), m = Math.floor(n * 2 / 3), out = new Float32Array(m);
  for (let i = 0; i < m; i++) { const x = i * 1.5, a = Math.floor(x), c = Math.min(n - 1, a + 1), fr = x - a; out[i] = (dv.getInt16(a * 2, true) * (1 - fr) + dv.getInt16(c * 2, true) * fr) / 32768; }
  let end = m; while (end > 0 && Math.abs(out[end - 1]!) < 0.01) end--;
  return out.subarray(0, Math.min(m, end + 320));
}
const clips: Float32Array[] = []; for (const q of QUESTIONS) clips.push(await say(q));
const ws = new WebSocket(`ws://${LAB}/ws`); ws.binaryType = "arraybuffer";
await new Promise((r) => (ws.onopen = r)); ws.send(JSON.stringify({ t: "hello", secret }));
if (VOICE) setTimeout(() => ws.send(JSON.stringify({ t: "config", values: { voice: VOICE } })), 200);
type Frame = { at: number; sec: number; chunk: number; turn: number };
let speechEnd = 0, frames: Frame[] = [], replyFinalAt = 0, finalText = "", replyDone: (() => void) | null = null, lastFrameAt = 0, curTurn = 0;
ws.onmessage = (e) => {
  const now = performance.now();
  if (typeof e.data === "string") { const j = JSON.parse(e.data);
    if (j.t === "reply_final") { replyFinalAt = now; finalText = j.text ?? ""; }
    if (j.t === "error") console.log("  ERROR", JSON.stringify(j));
  } else { const buf = e.data as ArrayBuffer, dv = new DataView(buf);
    const turn = dv.getUint32(0, true); if (turn < curTurn) return;
    frames.push({ at: now, sec: (buf.byteLength - 8) / 2 / 24000, chunk: dv.getUint16(4, true), turn }); lastFrameAt = now;
    if (frames.length === 1) ws.send(JSON.stringify({ t: "played", turn, chunk: frames[0]!.chunk, ms: 20 })); }
};
const frame = 512, tick = 32; const silence = new Float32Array(frame);
async function stream(samples: Float32Array | null, ms: number) { const n = samples ? Math.ceil(samples.length / frame) : Math.ceil(ms / tick); const t0 = performance.now();
  for (let i = 0; i < n; i++) { const f = samples ? (() => { const s = new Float32Array(frame); s.set(samples.subarray(i * frame, (i + 1) * frame)); return s; })() : silence;
    if (ws.readyState === 1) ws.send(f.buffer); const w = t0 + (i + 1) * tick - performance.now(); if (w > 0) await Bun.sleep(w); } }
let pump = true; (async () => { while (pump) await stream(null, 32); })();
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const rows: any[] = [];
for (let i = 0; i < clips.length; i++) {
  pump = false; await Bun.sleep(40); await stream(null, 900);
  frames = []; replyFinalAt = 0; finalText = ""; lastFrameAt = 0; curTurn = 0;
  await stream(clips[i]!, 0); speechEnd = performance.now(); pump = true; (async () => { while (pump) await stream(null, 32); })();
  const t0 = performance.now();
  // done when reply_final arrived and no audio frame for 1.2 s (or 30 s limit)
  while (performance.now() - t0 < 30000) { await Bun.sleep(100); if (replyFinalAt && performance.now() - Math.max(lastFrameAt, replyFinalAt) > 1200) break; }
  const f = frames;
  if (!f.length) { rows.push({ i: i + 1, q: QUESTIONS[i], ttfs: null }); console.log(`${String(i + 1).padStart(2)} NO AUDIO`); ws.send(JSON.stringify({ t: "played_end", turn: curTurn })); await Bun.sleep(300); continue; }
  const ttfs = f[0]!.at - speechEnd;
  // simulate the player: starts after JITTER ms of audio is queued; counts a gap whenever its queue runs dry
  let queued = 0, playhead = 0, playing = false, startAt = 0, gaps = 0, gapMs = 0, avail = 0, dryAt = 0; let playEnd = 0;
  for (const fr of f) {
    if (!playing) { avail += fr.sec; if (avail * 1000 >= JITTER) { playing = true; startAt = fr.at; playEnd = fr.at + avail * 1000; } continue; }
    if (fr.at > playEnd + 1) { gaps++; gapMs += fr.at - playEnd; playEnd = fr.at + fr.sec * 1000; } else playEnd += fr.sec * 1000;
  }
  // voice speed vs real time while the reply was still being written (frames before reply_final)
  const during = f.filter((x) => x.at <= replyFinalAt); const dSec = during.reduce((s, x) => s + x.sec, 0);
  const dWall = during.length > 1 ? (during.at(-1)!.at - during[0]!.at) / 1000 : 0;
  const speed = dWall > 0.3 ? dSec / dWall : NaN;
  const total = f.reduce((s, x) => s + x.sec, 0);
  const row = { i: i + 1, q: QUESTIONS[i], ttfs: Math.round(ttfs), audioSec: +total.toFixed(2), speedWhileWriting: Number.isNaN(speed) ? null : +speed.toFixed(2), gaps, gapMs: Math.round(gapMs), words: finalText.split(/\s+/).length };
  rows.push(row); console.log(`${String(i + 1).padStart(2)} first=${row.ttfs}ms audio=${row.audioSec}s speed=${row.speedWhileWriting ?? "-"}x gaps=${gaps} (${row.gapMs}ms) words=${row.words}`);
  ws.send(JSON.stringify({ t: "played_end", turn: f[0]!.turn })); await Bun.sleep(300);
}
pump = false; ws.close();
const ok = rows.filter((r) => r.ttfs != null);
const sp = ok.map((r) => r.speedWhileWriting).filter((x) => x != null) as number[];
const summary = { turns: ok.length, jitterMs: JITTER, firstSoundMedianMs: med(ok.map((r) => r.ttfs)), firstSoundWorstMs: Math.max(...ok.map((r) => r.ttfs)), firstSoundP90Ms: [...ok.map((r) => r.ttfs)].sort((a, b) => a - b)[Math.floor(ok.length * 0.9)],
  speedMedian: med(sp), speedWorst: sp.length ? Math.min(...sp) : null, turnsWithGaps: ok.filter((r) => r.gaps > 0).length, totalGaps: ok.reduce((s, r) => s + r.gaps, 0), totalGapMs: ok.reduce((s, r) => s + r.gapMs, 0) };
console.log("SUMMARY", JSON.stringify(summary));
if (OUT) await Bun.write(OUT, JSON.stringify({ summary, rows }, null, 1));
process.exit(0);
