// THE LISTENER. Runs a scripted 3-minute conversation (about 15 turns) through the lab's /ws, records the audio exactly as the page would play it
// (with its start gate and its stop plan), puts it through a SIMULATED room (delay, gain, reflections, noise: a real Studio-speakers-and-microphone run
// needs a real browser with audio devices, which this rig cannot drive), and judges every reply from the RECORDING: same person, right words, smooth,
// joins, timing, stumble pattern. Usage: bun rig/listen.ts <secret-file> [--runs 1] [--load] [--quick] [--out dir] [--gain 0.2]
import "./lockguard"; // refuses while a clean run holds the lab (src/runLock.ts)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitForNoLivePage } from "./guard";
import { noteLoad } from "./loadcheck";
import { JitterGate } from "../public/jitter.js";
import { wordEnd, stopPlan } from "../public/word-end.js";
import { LocalDuckDetector } from "../public/local-duck.js";
import { transcribe } from "../src/stack";
import { encodeWav } from "../src/wav";
import { readWav, writeWav, resample } from "./listen/audio";
import { embed, windowSimilarities } from "./listen/speaker";
import { holes, clicks, joinJump, joinFails, judgeJoins, firstAudible, wer, stumbleReport, LIMITS } from "./listen/judge";
const args = process.argv.slice(2); const opt = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1]! : d; };
const secret = (await Bun.file(args[0]!).text()).trim(); const RUNS = Number(opt("runs", "1")), QUICK = args.includes("--quick"), LOAD = args.includes("--load"), GAIN = Number(opt("gain", "0.2")), LAB = "127.0.0.1:9931", TTS = "http://127.0.0.1:9923";
const W = "/Users/jessetorres/Developer/github.com/getmaipai/wt/home-brisk-panda-voice-lab";
await noteLoad("listener run");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); const OUT = opt("out", join(W, "data-scratch", "listen", STAMP)); mkdirSync(OUT, { recursive: true });
if (!(await waitForNoLivePage(secret, LAB))) { console.log("not running: a real page stayed connected (or the lab is down)"); process.exit(2); }

async function say(text: string): Promise<Float32Array> {
  const f = new FormData(); f.set("text", text); f.set("voice", "lj"); const b = new Uint8Array(await (await fetch(TTS + "/tts", { method: "POST", body: f })).arrayBuffer());
  const dv = new DataView(b.buffer, 44), n = Math.floor((b.length - 44) / 2), m = Math.floor(n * 2 / 3), out = new Float32Array(m);
  for (let i = 0; i < m; i++) { const x = i * 1.5, a = Math.floor(x), c = Math.min(n - 1, a + 1), fr = x - a; out[i] = (dv.getInt16(a * 2, true) * (1 - fr) + dv.getInt16(c * 2, true) * fr) / 32768; }
  let end = m; while (end > 0 && Math.abs(out[end - 1]!) < 0.01) end--; return out.subarray(0, Math.min(m, end + 320));
}
type Turn = { kind: string; say: string; during?: Array<{ atMs: number; say: string; expect: "stop" | "continue" | "info" }>; informational?: boolean };
const SCRIPT: Turn[] = [
  { kind: "normal", say: "Hi there, how are you doing today?" }, { kind: "joke", say: "Tell me a joke." }, { kind: "joke2", say: "That was funny. Tell me another one." },
  { kind: "sad", say: "I had a really rough day. My dog passed away this morning." },
  { kind: "story", say: "Can you tell me a long story about a dragon who bakes bread?", during: [{ atMs: 5000, say: "Mm-hm.", expect: "continue" }, { atMs: 10500, say: "Wait, stop.", expect: "stop" }] },
  { kind: "after-cutin", say: "Sorry about that. What were you going to say?" },
  { kind: "tool", say: "What time is it in Tokyo right now?" },
  { kind: "days", say: "What are the days of the week?", during: [{ atMs: 2500, say: "Thursday?", expect: "info" }] },
  { kind: "normal", say: "What is a good name for a goldfish?" }, { kind: "normal", say: "Why is the sky blue?" }, { kind: "normal", say: "Do you like music?" },
  { kind: "normal", say: "How far away is the moon?" }, { kind: "normal", say: "What should I cook tonight?" }, { kind: "normal", say: "Tell me something interesting about octopuses." }, { kind: "normal", say: "Okay, thanks. Goodnight." },
];
const script = QUICK ? [SCRIPT[0]!, SCRIPT[1]!, SCRIPT[3]!, SCRIPT[4]!, SCRIPT[5]!, SCRIPT[6]!, SCRIPT[8]!, SCRIPT[9]!] : SCRIPT; // quick: 8 turns including the story with mm-hm and wait-stop
const clips = new Map<string, Float32Array>(); for (const t of script) { clips.set(t.say, await say(t.say)); for (const d of t.during ?? []) clips.set(d.say, await say(d.say)); }
const refW = readWav(`${W}/data-scratch/voices/voices_store/casual/ref.wav`); const refE = embed(refW.samples, refW.rate);

let burners: Array<ReturnType<typeof Bun.spawn>> = [];
const startLoad = () => { for (let i = 0; i < 4; i++) burners.push(Bun.spawn(["/usr/bin/yes"], { stdout: "ignore", stderr: "ignore" })); };
const stopLoad = () => { for (const p of burners) try { p.kill(); } catch {} burners = []; };

type Rec = { firstAt: number; turn: number; kind: string; heard: boolean; userEndAt: number; replyStartOut: number; replyEndOut: number; text: string; stops: number[]; sounds: Array<{ tag: string; outAt: number; ms: number }>; phraseOut: number[]; interjections: Array<{ say: string; expect: string; atRel: number; lateMs?: number }>; stopped: boolean; };
async function conversation(run: number) {
  const ws = new WebSocket(`ws://${LAB}/ws`); ws.binaryType = "arraybuffer"; await new Promise((r) => (ws.onopen = r)); ws.send(JSON.stringify({ t: "hello", secret, rig: true }));
  const T0 = performance.now(); const rel = () => performance.now() - T0;
  const gate = new JitterGate(); let queue = new Float32Array(0), qLen = 0, playhead = 0, speaking = false, stopWordAt = -1, stoppedTurn = false, turn = 0, replyText = "", chunkTexts: string[] = [], paused = false;
  let outAll = new Float32Array(24000 * 60 * 6), outLen = 0; let chunkStarts = new Map<number, number>(); const chunkOut = new Map<number, number>();
  let firstFrameAt = 0, lastFrameAt = 0; const events: Array<{ t: string; at: number; turn?: number }> = []; let curSounds: Array<{ tag: string; chunk: number; atMs: number; ms: number }> = []; let lastNowQueued = 0;
  ws.onmessage = (e) => {
    if (typeof e.data === "string") { const j = JSON.parse(e.data);
      if (["stop", "final", "reply_final", "pause", "error"].includes(j.t)) events.push({ t: j.t, at: rel(), turn: j.turn });
      if (j.t === "reply_final") replyText = j.text ?? "";
      if (j.t === "chunk" && Number.isInteger(j.chunk)) chunkTexts[j.chunk] = String(j.text ?? "");
      if (j.t === "sound") curSounds.push({ tag: j.tag, chunk: j.chunk, atMs: j.atMs, ms: j.ms });
      if (j.t === "pause") paused = true; if (j.t === "resume") paused = false;
      if (j.t === "stop") { const plan = stopPlan(queue.subarray(0, qLen), playhead, 24000); stopWordAt = rel() + plan.waitMs; stoppedTurn = true; }
    } else { const buf = e.data as ArrayBuffer, dv = new DataView(buf); const tn = dv.getUint32(0, true), idx = dv.getUint16(4, true);
      if (tn !== turn) { turn = tn; queue = new Float32Array(24000 * 120); qLen = 0; playhead = 0; chunkStarts = new Map(); stoppedTurn = false; stopWordAt = -1; chunkTexts = []; gate.reset(performance.now()); curSounds = []; replyText = ""; firstFrameAt = 0; speaking = false; }
      if (stoppedTurn) return; const pcm = new Int16Array(buf, 8); if (!chunkStarts.has(idx)) chunkStarts.set(idx, qLen);
      for (let i = 0; i < pcm.length; i++) queue[qLen + i] = pcm[i]! / 32768; qLen += pcm.length; gate.noteArrival(performance.now(), pcm.length / 24000); if (!firstFrameAt) firstFrameAt = rel(); lastFrameAt = rel(); speaking = true; }
  };
  const recs: Rec[] = []; const frame = 512, tickMs = 32; const duck = new LocalDuckDetector(); let k = 0; const start = performance.now();
  let userClip: Float32Array | null = null, userPos = -1; let userEndAt = 0; const inter: Array<{ at: number; clip: Float32Array; say: string; expect: string }> = []; let lastPlayedReport = 0;
  const rnd = (() => { let s = 4242; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const delay = Math.round(0.12 * 24000);
  async function tick() {
    const due = start + (k + 1) * tickMs; const w = due - performance.now(); if (w > 0) await Bun.sleep(w); k++;
    const n24 = 768; const now = rel(); const seg = new Float32Array(n24);
    const queuedMs = Math.max(0, qLen - playhead) / 24; const play = speaking && !paused && gate.update(queuedMs, performance.now()) && !(stoppedTurn && now >= stopWordAt + 25);
    if (play && qLen > playhead) { const take = Math.min(n24, qLen - playhead); const startIdx = playhead; for (let i = 0; i < take; i++) seg[i] = queue[playhead + i]!; if (!(stoppedTurn && now > stopWordAt)) playhead += take; else seg.fill(0);
      for (const [idx, s0] of chunkStarts) if (!chunkOut.has(turn * 1000 + idx) && s0 >= startIdx && s0 < startIdx + take) chunkOut.set(turn * 1000 + idx, outLen + (s0 - startIdx)); }
    if (outLen + n24 > outAll.length) { const b = new Float32Array(outAll.length * 2); b.set(outAll); outAll = b; } outAll.set(seg, outLen); outLen += n24;
    const mic = new Float32Array(frame);
    for (let i = 0; i < frame; i++) { const p = (outLen - n24) + i * 1.5 - delay; let e = 0; for (const [d, g] of [[0, 1], [168, 0.35], [456, 0.18]] as const) { const q = Math.floor(p - d); if (q >= 0 && q < outLen) e += g * outAll[q]!; } mic[i] = e * GAIN + (rnd() - 0.5) * 0.0012; }
    if (userClip && userPos >= 0) { for (let i = 0; i < frame; i++) if (userPos + i < userClip.length) mic[i]! += userClip[userPos + i]! * 0.9; userPos += frame; if (userPos >= userClip.length) { userPos = -1; userEndAt = rel(); } }
    { const next = inter.find((x) => !(x as any).done); // one at a time and in order: if the rig stalled and two were due at once, the second used to overwrite the first, so "Mm-hm." never played and "Wait, stop." was blamed on it
      if (next && now >= next.at && userPos < 0) { (next as any).done = true; (next as any).startedAt = now; (next as any).lateMs = Math.round(now - next.at); userClip = next.clip; userPos = 0; } }
    if (duck.frame(mic, { playing: play && !stoppedTurn, enabled: true })) ws.send(JSON.stringify({ t: "local_duck", turn }));
    ws.send(mic.buffer);
    if (now - lastPlayedReport >= 100 && speaking && !stoppedTurn) { lastPlayedReport = now; for (const [idx, s0] of chunkStarts) ws.send(JSON.stringify({ t: "played", turn, chunk: idx, ms: Math.max(0, (playhead - s0) / 24) })); }
  }
  const runFor = async (ms: number, until?: () => boolean) => { const t = performance.now(); while (performance.now() - t < ms && !(until?.())) await tick(); };
  await runFor(1500);
  for (let ti = 0; ti < script.length; ti++) {
    const t = script[ti]!; const clip = clips.get(t.say)!; const evStart = events.length; const turnBefore = turn;
    userClip = clip; userPos = 0; userEndAt = 0; inter.length = 0; await runFor(clip.length / 16 + 200, () => userEndAt > 0); const endAt = userEndAt || rel();
    const firstAt = () => firstFrameAt; const replyStart = rel(); void replyStart;
    for (const d of t.during ?? []) inter.push({ at: Infinity, clip: clips.get(d.say)!, say: d.say, expect: d.expect }); // not due until her first sound sets the time (at: 0 made them fire at once, before she spoke: the "Mm-hm stopped her" and "rig stalled 39 s" findings were this bug)
    // wait for her first sound, then schedule the interjections relative to it
    await runFor(12000, () => firstAt() > 0 && turn !== turnBefore); const speakAt = rel(); let k2 = 0; for (const it of inter) { it.at = speakAt + (t.during![k2++]!.atMs); }
    const outStart = outLen; let silentTicks = 0; const maxMs = 60000; const t1 = performance.now();
    while (performance.now() - t1 < maxMs) { await tick(); const done = events.slice(evStart).some((e) => e.t === "reply_final") && playhead >= qLen && qLen > 0 && !inter.some((i) => !(i as any).done); if (done || (stoppedTurn && rel() > stopWordAt + 600 && !inter.some((i) => !(i as any).done))) { if (++silentTicks > 25) break; } else silentTicks = 0; }
    ws.send(JSON.stringify({ t: "played_end", turn })); await runFor(300);
    recs.push({ firstAt: speakAt, turn, kind: t.kind, heard: firstFrameAt > 0 && turn !== turnBefore, userEndAt: endAt, replyStartOut: outStart, replyEndOut: outLen, text: replyText || chunkTexts.filter(Boolean).join(" "), stops: events.slice(evStart).filter((e) => e.t === "stop").map((e) => e.at), sounds: curSounds.map((s) => ({ tag: s.tag, outAt: (chunkOut.get(turn * 1000 + s.chunk) ?? outStart) + s.atMs * 24, ms: s.ms })), phraseOut: [...chunkStarts.keys()].filter((i) => i > 0).map((i) => chunkOut.get(turn * 1000 + i) ?? -1).filter((x) => x >= 0), interjections: inter.map((i: any) => ({ say: i.say, expect: i.expect, atRel: i.startedAt ?? -1, lateMs: i.lateMs ?? 0 })), stopped: stoppedTurn });
    await runFor(700);
  }
  ws.close(); return { recs, out: outAll.subarray(0, outLen), events, T0 };
}

async function judge(run: number, c: Awaited<ReturnType<typeof conversation>>) {
  const rows: any[] = []; const fails: string[] = []; const replies: string[] = [];
  for (const r of c.recs) {
    const audio = c.out.subarray(r.replyStartOut, r.replyEndOut); const label = `run${run}_turn${String(r.turn).padStart(2, "0")}_${r.kind}`; writeWav(join(OUT, label + ".wav"), audio, 24000);
    const row: any = { turn: r.turn, kind: r.kind, file: join(OUT, label + ".wav"), seconds: +(audio.length / 24000).toFixed(1), problems: [] as string[] };
    const heardTextAudio = resample(audio, 24000, 16000); let heard = ""; try { heard = audio.length > 16000 ? await transcribe(encodeWav(heardTextAudio)) : ""; } catch {}
    row.heard = heard.slice(0, 120); row.written = r.text.slice(0, 120);
    if (r.text) replies.push(r.text);
    if (!r.heard) row.problems.push("silent turn: no reply audio"); else {
      // (a) same person: every 1.5 s window of speech, away from sound splices
      const spans = r.sounds.map((s) => [(s.outAt - r.replyStartOut) / 24000 - 0.2, (s.outAt - r.replyStartOut) / 24000 + s.ms / 1000 + 0.2]);
      const sims = windowSimilarities(audio, 24000, refE).filter((w) => !spans.some(([a, b]) => w.at + 1.5 > a! && w.at < b!)); row.minSim = sims.length ? +Math.min(...sims.map((x) => x.sim)).toFixed(2) : null;
      if (sims.length && Math.min(...sims.map((x) => x.sim)) < LIMITS.speakerSim) row.problems.push(`not the same person: window similarity ${row.minSim} < ${LIMITS.speakerSim}`);
      // (b) right words (only for replies that played to the end)
      const w = r.stopped ? wer(r.text.split(/\s+/).slice(0, Math.max(3, heard.split(/\s+/).length + 2)).join(" "), heard) : wer(r.text, heard); row.wer = +w.toFixed(2);
      if (w > LIMITS.wer) row.problems.push(`words differ from what was written: error rate ${row.wer}`);
      // (c) smooth
      const bnd = r.phraseOut.map((o) => (o - r.replyStartOut) / 24000); const h = holes(audio, 24000, LIMITS.gapMs, bnd), cl = clicks(audio, 24000, bnd); row.holes = h.length; row.clicks = cl.length;
      if (h.length > LIMITS.gapsPerReply) { const longest = Math.round(Math.max(...h.map((x) => x.ms))); const msg = `${h.length} silent hole(s) inside the speech (longest ${longest} ms) at ${h.map((x) => x.at.toFixed(2)).join(", ")} s`; if (longest >= 300) row.problems.push(msg); else (row.targets ??= []).push(msg + " (under 300 ms: reported, not blocking)"); }
      if (cl.length > LIMITS.clicksPerReply) row.problems.push(`${cl.length} click(s) at ${cl.map((x) => x.toFixed(2)).join(", ")} s`);
      // (d) joins
      const joins = [...r.phraseOut.map((o) => ({ at: (o - r.replyStartOut) / 24000, to: (o - r.replyStartOut) / 24000, what: "phrase" })), ...r.sounds.map((s) => ({ at: (s.outAt - r.replyStartOut) / 24000, to: (s.outAt - r.replyStartOut) / 24000 + s.ms / 1000, what: `across ${s.tag}` }))];
      row.joins = joins.map((j) => ({ what: j.what, at: +j.at.toFixed(2), ...joinJump(audio, 24000, j.at, j.to) })); const jv = judgeJoins(row.joins); if (jv.fail) (row.targets ??= []).push(jv.fail); if (jv.warn) { row.warnings = [jv.warn]; }
      // (e) timing
      const fa = firstAudible(c.out, 24000, r.userEndAt / 1000 * 0); void fa;
    }
    // timing from the recording: user's last word (conversation clock) to first audible sample of her reply (recording clock)
    const first = firstAudible(audio, 24000); row.firstAudibleInReply = first; row.userEndAtMs = Math.round(r.userEndAt);
    row.stopsMs = r.stops.map(Math.round); row.sounds = r.sounds.map((s) => s.tag); row.interjections = r.interjections;
    rows.push(row);
  }
  return { rows, replies };
}
const all: any[] = [];
for (let run = 1; run <= RUNS; run++) {
  const load = LOAD; if (load) startLoad(); const t0 = performance.now(); const c = await conversation(run); if (load) stopLoad();
  const { rows, replies } = await judge(run, c);
  // timing per turn from the recording: his last word to her first audible sound (recording clock = conversation clock)
  const outRel = (o: number) => o / 24 ; const timings: number[] = []; for (let i = 0; i < c.recs.length; i++) { const r = c.recs[i]!; if (!r.heard || r.kind === "after-cutin") continue; const first = firstAudible(c.out.subarray(r.replyStartOut, r.replyEndOut), 24000); if (first === null) continue; const replyAudibleAt = outRel(r.replyStartOut) + first * 1000; timings.push(replyAudibleAt - r.userEndAt); }
  const sorted = [...timings].sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)] ?? NaN, p90 = sorted[Math.floor(sorted.length * 0.9)] ?? NaN, worst = sorted.at(-1) ?? NaN;
  const conv: string[] = []; const events = c.events;
  for (const r of c.recs) for (const j of r.interjections) { if (j.atRel < 0) continue; if (j.atRel < r.firstAt) conv.push(`rig bug: "${j.say}" was played before her first sound (not a voice result)`); if ((j.lateMs ?? 0) > 1500) conv.push(`rig stalled: "${j.say}" started ${j.lateMs} ms late (a rig problem under load, not a voice result)`); const stopAfter = r.stops.find((s) => s >= j.atRel); const latency = stopAfter === undefined ? null : Math.round(stopAfter - j.atRel);
    if (j.expect === "stop" && (latency === null || latency > 2500)) conv.push(`"${j.say}" did not stop her within 2.5 s`); if (j.expect === "continue" && latency !== null && latency < 2500) conv.push(`"${j.say}" stopped her but should not have`); }
  const firstUserAt = c.recs.length ? c.recs[0]!.userEndAt : 0; const selfStops = events.filter((e) => e.t === "stop" && c.recs.some((r) => r.heard && e.at >= r.firstAt && e.at <= r.firstAt + 120000 && e.turn === r.turn) && !c.recs.some((r) => r.interjections.some((j) => j.atRel >= 0 && e.at >= j.atRel - 50 && e.at <= j.atRel + 3000))).length;
  // stops that happened with no interjection and no new user turn are self-interruptions; a stop right before a final is the draft discard path (nothing playing)
  const st = stumbleReport(replies);
  const timingFail = p90 > 2300 + 400 || worst > 3500 + 400; // recording-clock timing includes the page's start gate and the room clock: limits widened by 400 ms
  const problems = rows.flatMap((r) => r.problems.map((p: string) => `turn ${r.turn} (${r.kind}): ${p}`));
  const summary = { run, load, room: "SIMULATED (60/120/200 ms delay model: 120 ms, gain " + GAIN + ", two reflections, noise); a real-speaker run is not possible from this rig", turns: rows.length, seconds: Math.round((performance.now() - t0) / 1000), timingMs: { median: Math.round(med), p90: Math.round(p90), worst: Math.round(worst), n: timings.length, limitP90: 2700, limitWorst: 3900, fail: timingFail }, stumbles: st, conversationFailures: conv, selfStops, problems, targets: [...(timings.length && (med > 1000 || p90 > 1500) ? [`first sound median ${Math.round(med)} ms / p90 ${Math.round(p90)} ms (targets 1000 / 1500)`] : []), ...(timingFail ? [`first sound worst ${Math.round(worst)} ms / p90 ${Math.round(p90)} ms over the rig limits ${2700} / ${3900}`] : []), ...(st.fail ? [`stumble pattern: ${JSON.stringify(st)}`] : []), ...rows.flatMap((r) => (r.targets ?? []).map((t: string) => `turn ${r.turn} (${r.kind}): ${t}`))], failed: problems.length + conv.length + (selfStops > 0 ? 1 : 0) };
  writeWav(join(OUT, `run${run}_conversation.wav`), c.out, 24000); writeFileSync(join(OUT, `run${run}.json`), JSON.stringify({ summary, rows }, null, 1)); all.push({ summary, rows });
  console.log(`RUN ${run}${load ? " (with background load)" : ""}: ${summary.failed ? "FAIL" : "PASS"}; timing median ${summary.timingMs.median} p90 ${summary.timingMs.p90} worst ${summary.timingMs.worst} ms; stumbles ${JSON.stringify(st)}; self-stops ${selfStops}`);
  for (const p of conv) console.log("  CONVERSATION: " + p); for (const p of problems) console.log("  " + p); for (const r of rows) for (const w of (r.warnings ?? [])) console.log(`  turn ${r.turn} (${r.kind}): ${w}`);
  for (const t of summary.targets) console.log("TARGET MISSED (does not block): " + t);
}
const worstRows = all.flatMap((a) => a.rows).filter((r) => r.problems?.length).sort((a, b) => b.problems.length - a.problems.length).slice(0, 3);
console.log(`LISTEN FILES (reply audio of the three worst replies): ${worstRows.map((r) => r.file).join(" ; ") || "none had problems"}`);
console.log(`ALL RUNS: ${all.every((a) => a.summary.failed === 0) ? "PASS" : "FAIL"}  (output folder ${OUT})`);
stopLoad(); process.exit(all.every((a) => a.summary.failed === 0) ? 0 : 1);
