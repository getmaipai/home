// Cut-in under echo, with no person: the "microphone" is the assistant's own voice played through a virtual speaker
// (delay, gain, short room reflections, noise floor) plus, in some scenarios, a scripted person.
// Scenarios: silent (must not interrupt itself), mmhm (must keep talking), stop ("wait, stop": must stop, finishing the word),
// briefly (a short "yeah, right, okay" talk-over: must keep talking).
// Usage: bun rig/echotest.ts <secret-file> --scenario silent|mmhm|stop|briefly --runs 20 [--gain 0.35] [--delay 120] [--aec 1]
import { waitForNoLivePage } from "./guard";
import { LocalDuckDetector } from "../public/local-duck.js";
import { wordEnd } from "../public/word-end.js";
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1]! : d; };
const secret = (await Bun.file(args[0]!).text()).trim();
const SCEN = opt("scenario", "silent"), RUNS = Number(opt("runs", "20")), GAIN_FIXED = opt("gain", ""), DELAY_FIXED = opt("delay", ""), LAB = "127.0.0.1:9931", TTS = "http://127.0.0.1:9923";
async function say(text: string): Promise<Float32Array> {
  const f = new FormData(); f.set("text", text); f.set("voice", "lj");
  const b = new Uint8Array(await (await fetch(TTS + "/tts", { method: "POST", body: f })).arrayBuffer());
  const dv = new DataView(b.buffer, 44), n = Math.floor((b.length - 44) / 2), m = Math.floor(n * 2 / 3), out = new Float32Array(m);
  for (let i = 0; i < m; i++) { const x = i * 1.5, a = Math.floor(x), c = Math.min(n - 1, a + 1), fr = x - a; out[i] = (dv.getInt16(a * 2, true) * (1 - fr) + dv.getInt16(c * 2, true) * fr) / 32768; }
  let end = m; while (end > 0 && Math.abs(out[end - 1]!) < 0.01) end--; return out.subarray(0, Math.min(m, end + 320));
}
if (!(await waitForNoLivePage(secret, LAB))) { console.log("not running: a real page stayed connected (or the lab is down)"); process.exit(2); }
const Q = await say("Tell me a long story about a dragon who learns to bake bread.");
const INTERJECT: Record<string, Float32Array | null> = { silent: null, mmhm: await say("Mm-hm."), stop: await say("Wait, stop."), briefly: await say("Yeah, right, okay.") };
const user = INTERJECT[SCEN] ?? null;
// the person's level at the mic: the TTS clip is roughly -20 dBFS rms; scale so a near talker is about as loud as the echo
const rmsOf = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / Math.max(1, a.length));
let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const results: any[] = [];
for (let run = 0; run < RUNS; run++) {
  const gain = GAIN_FIXED ? Number(GAIN_FIXED) : [0.1, 0.2, 0.35, 0.5][run % 4]!, delayMs = DELAY_FIXED ? Number(DELAY_FIXED) : [60, 120, 200][Math.floor(run / 4) % 3]!;
  results.push(await one(run, gain, delayMs));
}
async function one(run: number, gain: number, delayMs: number) {
  const ws = new WebSocket(`ws://${LAB}/ws`); ws.binaryType = "arraybuffer"; await new Promise((r) => (ws.onopen = r)); ws.send(JSON.stringify({ t: "hello", secret, rig: true }));
  const ev: Array<{ t: string; at: number; extra?: any }> = []; const T0 = performance.now(); const rel = () => performance.now() - T0;
  // virtual speaker
  let queue: Float32Array[] = [], qLen = 0, playhead = 0, playing = false, stopAt = -1, stopped = false, paused = false, firstAudioAt = 0, turn = 0, replyFinished = false;
  const flat = () => { if (queue.length > 1) { const a = new Float32Array(qLen); let o = 0; for (const c of queue) { a.set(c, o); o += c.length; } queue = [a]; } return queue[0] ?? new Float32Array(0); };
  const chunkStarts = new Map<number, number>(); let stopWordAt = -1;
  ws.onmessage = (e) => {
    if (typeof e.data === "string") { const j = JSON.parse(e.data);
      if (["stop", "pause", "resume", "duck", "final", "reply_final", "error"].includes(j.t) || (j.t === "state")) ev.push({ t: j.t === "state" ? "state:" + j.state : j.t, at: rel() });
      if (j.t === "stop") { const a = flat(); const target = wordEnd(a, playhead, 24000); stopWordAt = rel() + Math.max(0, (target - playhead) / 24); stopAt = rel(); stopped = true; }
      if (j.t === "pause") paused = true; if (j.t === "resume") paused = false;
      if (j.t === "reply_final") replyFinished = true;
    } else { const buf = e.data as ArrayBuffer, dv = new DataView(buf); const tn = dv.getUint32(0, true), idx = dv.getUint16(4, true);
      if (stopped && tn === turn) return; if (tn !== turn) { turn = tn; queue = []; qLen = 0; playhead = 0; chunkStarts.clear(); stopped = false; replyFinished = false; }
      const pcm = new Int16Array(buf, 8), f = Float32Array.from(pcm, (x) => x / 32768); if (!chunkStarts.has(idx)) chunkStarts.set(idx, qLen); queue.push(f); qLen += f.length;
      if (!firstAudioAt) { firstAudioAt = rel(); playing = true; ev.push({ t: "first_audio", at: firstAudioAt }); } }
  };
  const out24: number[] = []; // everything the speaker has played, 24 kHz, one entry per sample
  let outAll = new Float32Array(24000 * 60), outLen = 0;
  const duck = new LocalDuckDetector(); let userPos = -1, userStartAt = -1, localDuckSent = false;
  const tick = 32, frame = 512; let k = 0; const start = performance.now();
  let phase: "ask" | "wait" | "settle" | "observe" = "ask"; let askPos = 0, settleStart = 0, endAt = 0; let lastPlayedReport = 0;
  const OBS = SCEN === "stop" ? 5000 : 8000;
  while (true) {
    const due = start + (k + 1) * tick; const w = due - performance.now(); if (w > 0) await Bun.sleep(w); k++;
    // speaker output for this tick (24 kHz)
    const n24 = 768; const a = flat(); const seg = new Float32Array(n24);
    const nowT = rel(); const speakerOn = playing && !paused && !(stopped && nowT >= stopWordAt + 25);
    if (speakerOn && queue.length) { const take = Math.min(n24, Math.max(0, a.length - playhead)); for (let i = 0; i < take; i++) seg[i] = a[playhead + i]!; if (!(stopped && nowT > stopWordAt)) playhead += take; if (stopped && nowT > stopWordAt) seg.fill(0); }
    if (outLen + n24 > outAll.length) { const bigger = new Float32Array(outAll.length * 2); bigger.set(outAll); outAll = bigger; }
    outAll.set(seg, outLen); outLen += n24;
    // microphone frame (16 kHz): the speaker's output d ms ago, gain, two reflections, noise, plus the person
    const mic = new Float32Array(frame);
    const dly = Math.round(delayMs * 24), echoGain = gain;
    for (let i = 0; i < frame; i++) {
      const pos24 = (outLen - n24) + i * 1.5 - dly; let e = 0;
      for (const [d, g] of [[0, 1], [168, 0.35], [456, 0.18]] as const) { const p = Math.floor(pos24 - d); if (p >= 0 && p < outLen) e += g * outAll[p]!; }
      mic[i] = e * echoGain + (rnd() - 0.5) * 0.0012;
    }
    if (userPos >= 0 && user) { for (let i = 0; i < frame; i++) { const p = userPos + i; if (p < user.length) mic[i]! += user[p]! * 0.9; } userPos += frame; if (userPos >= user.length) userPos = -1; }
    // the page's instant local lowering
    const playingNow = speakerOn && !replyFinished;
    if (phase !== "ask" && duck.frame(mic, { playing: playingNow, enabled: true }) && !localDuckSent) { localDuckSent = true; ws.send(JSON.stringify({ t: "local_duck", turn })); ev.push({ t: "local_duck", at: rel() }); setTimeout(() => (localDuckSent = false), 600); }
    // timeline
    if (phase === "ask") { const f = new Float32Array(frame); f.set(Q.subarray(askPos, askPos + frame)); mic.set(f.map((x, i) => x + mic[i]!)); askPos += frame; if (askPos >= Q.length) phase = "wait"; }
    else if (phase === "wait" && firstAudioAt) { phase = "settle"; settleStart = rel(); }
    else if (phase === "settle" && rel() - settleStart >= 3500) { phase = "observe"; endAt = rel() + OBS; if (user) { userPos = 0; userStartAt = rel(); ev.push({ t: "user_start", at: userStartAt }); } }
    else if (phase === "observe" && rel() >= endAt) break;
    if (rel() > 40000) break;
    ws.send(mic.buffer);
    // played reports like the page (every 100 ms)
    if (rel() - lastPlayedReport >= 100 && firstAudioAt && queue.length && !stopped) { lastPlayedReport = rel(); for (const [idx, s0] of chunkStarts) { const ms = Math.max(0, (playhead - s0) / 24); if (ms >= 0) ws.send(JSON.stringify({ t: "played", turn, chunk: idx, ms })); } }
  }
  ws.close(); await Bun.sleep(200);
  const stops = ev.filter((x) => x.t === "stop"), finals = ev.filter((x) => x.t === "final");
  const afterUser = (t: string) => ev.filter((x) => x.t === t && (userStartAt < 0 || x.at >= userStartAt));
  const preStops = ev.filter((x) => x.t === "stop" && (userStartAt < 0 || x.at < userStartAt));
  const r: any = { run: run + 1, gain, delayMs, selfStop: preStops.length > 0 || (userStartAt < 0 && stops.length > 0), duck: ev.filter((x) => x.t === "duck").length, pauses: ev.filter((x) => x.t === "pause").length };
  if (SCEN === "silent") r.pass = !r.selfStop && finals.length === 0 && ev.filter((x) => x.t === "pause").length === 0;
  if (SCEN === "mmhm" || SCEN === "briefly") { r.stopAfterUser = afterUser("stop").length; r.finalAfterUser = afterUser("final").length; r.pass = !r.selfStop && r.stopAfterUser === 0 && r.finalAfterUser === 0; }
  if (SCEN === "stop") { const s = afterUser("stop")[0]; r.stopLatencyMs = s ? Math.round(s.at - userStartAt) : null; r.silentAfterMs = s && stopWordAt >= 0 ? Math.round(stopWordAt + 25 - userStartAt) : null; r.pass = !!s && !r.selfStop && s.at - userStartAt < 2500; }
  console.log(JSON.stringify(r)); return r;
}
const pass = results.filter((x) => x.pass).length;
const lat = results.map((x) => x.silentAfterMs).filter((x) => x != null).sort((a, b) => a - b);
console.log(`SCENARIO ${SCEN}: ${pass}/${results.length} pass; self-interruptions ${results.filter((x) => x.selfStop).length}${lat.length ? `; voice silent after the person starts: median ${lat[Math.floor(lat.length / 2)]} ms, worst ${lat.at(-1)} ms` : ""}`);
process.exit(0);
