/**
 * TALK-OVER-01 (docs/design/talk-over-2026-11-12.md section 5): how early the acknowledgement would sound, how often it would be
 * wrong, and whether the words survive the overlap, measured through a Home hub's real listening path (real audio on
 * `WS /api/stt/stream`, the hub's own voice detector, transcription, edge marking and end-of-turn score). No browser: the clip's
 * own start is the edge partial's arrival plus about 30 ms (the client plays it from memory), so the number reported is the edge
 * partial's time against the end of the played speech. Counts only: utterance texts are the bench's own fixed list.
 *
 *   cd backend && bun run scripts/bench/talk-over.ts [--api http://127.0.0.1:8780] [--person person-xxx] [--secret ...]
 *       [--pauses 300,500,650] [--mix 0,-6] [--quiet]
 *
 * Three passes:
 *   1. Clean ends: each utterance is spoken whole (Home's own TTS as the voice), then silence. Reports the edge partial's time
 *      relative to the end of speech, the hub's end-of-turn level on it, and whether the final matched the edge text.
 *   2. Mid-sentence pauses: a two-part utterance with a gap of each --pauses length spliced in at the clause boundary. A clip
 *      released on the first part's edge partial is a WRONG start when the person goes on: reported per gap length and per level
 *      (gentle fires on gentle-level edges, natural on both), with the time from the edge partial to the hub's `resumed` event.
 *   3. Overlap: a rendered acknowledgement is mixed under the utterance's last 0.4 s at each --mix level in dB (0 dB means no echo
 *      cancellation at all, the browser's measured residual is below the room noise), and the final's words are compared with the
 *      script: word accuracy during the overlap.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../../", import.meta.url).pathname;
function option(name: string, fallback: string): string { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; }
const API = option("--api", "http://127.0.0.1:8780").replace(/\/$/, "");
const PERSON = option("--person", "person-xc0ea5rte3");
const SECRET = option("--secret", "correcthorsebattery");
const PAUSES = option("--pauses", "300,500,650").split(",").map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
const MIXES = option("--mix", "0,-6").split(",").map((v) => Number(v)).filter((v) => Number.isFinite(v));
const QUIET = process.argv.includes("--quiet");
const SAMPLE_RATE = 16_000;
const FRAME = 320; // 20 ms

const CLEAN: string[] = [
  "What is a good name for a small grey cat?",
  "Is it going to rain tomorrow?",
  "How long should I boil an egg?",
  "Tell me a fun fact about owls.",
  "What time is it?",
  "Can you play some quiet music?",
  "I had a long day at work.",
  "What is five times five?",
];
// Two parts: a clause that reads complete on its own, then the rest.
const PAUSED: Array<[string, string]> = [
  ["I want to go to the store", "tomorrow at five."],
  ["Remind me to call the dentist", "on Friday morning."],
  ["What is a good name", "for a small grey cat?"],
  ["Set a timer for ten minutes", "and then one for twenty."],
  ["I think we should go to the beach", "if the weather holds."],
  ["Tell me about the moon", "and how far away it is."],
];
const ACK = "Mm-hm.";

function log(line: string): void { if (!QUIET) console.log(line); }

async function signIn(): Promise<string> {
  const res = await fetch(`${API}/api/auth/verify-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: PERSON, secret: SECRET }) });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("sign-in gave no session cookie");
  return cookie;
}

async function setSetting(cookie: string, key: string, value: unknown): Promise<void> {
  const res = await fetch(`${API}/api/settings`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ scope: "household", key, value }) });
  if (!res.ok) throw new Error(`could not set ${key}: ${res.status} ${(await res.text()).slice(0, 120)}`);
}

async function speak(cookie: string, text: string): Promise<Float32Array> {
  const res = await fetch(`${API}/api/tts`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`Home tts ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12; let sampleRate = 0; let dataOff = -1;
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(off, off + 4)); const size = view.getUint32(off + 4, true);
    if (id === "fmt ") sampleRate = view.getUint32(off + 12, true);
    if (id === "data") { dataOff = off + 8; break; }
    off += 8 + size + (size % 2);
  }
  if (dataOff < 0 || !sampleRate) throw new Error("Home tts gave no WAV data chunk");
  const n = Math.floor((bytes.length - dataOff) / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) { const s = view.getInt16(dataOff + i * 2, true); samples[i] = s < 0 ? s / 0x8000 : s / 0x7fff; }
  if (sampleRate === SAMPLE_RATE) return trimTail(samples);
  const out = new Float32Array(Math.floor(samples.length * SAMPLE_RATE / sampleRate));
  for (let i = 0; i < out.length; i++) { const pos = i * sampleRate / SAMPLE_RATE; const lo = Math.floor(pos); const hi = Math.min(samples.length - 1, lo + 1); out[i] = samples[lo]! + (samples[hi]! - samples[lo]!) * (pos - lo); }
  return trimTail(out);
}

/** The voice engine pads its WAV with silence; the end of speech is the last audible sample. */
function trimTail(pcm: Float32Array): Float32Array {
  let end = pcm.length - 1; while (end > 0 && Math.abs(pcm[end]!) < 0.01) end--;
  return pcm.subarray(0, end + 1);
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function mixUnder(voice: Float32Array, clip: Float32Array, startSample: number, dB: number): Float32Array {
  const out = voice.slice(); const gain = Math.pow(10, dB / 20);
  for (let i = 0; i < clip.length && startSample + i < out.length; i++) out[startSample + i] = Math.max(-1, Math.min(1, out[startSample + i]! + clip[i]! * gain));
  return out;
}

type Edge = { at: number; text: string; level: string; score: number; unfinished: boolean };
type Listen = { final: string; finalAt: number; speechEndAt: number; sttMs: number; edges: Edge[]; resumedAt: number[]; ready: { level?: string; window_ms?: number } };

/** Streams the audio in real time, then silence until the hub finalizes. Times are performance.now() ms. */
function listen(cookie: string, pcm: Float32Array, lastVoicedSample: number): Promise<Listen> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${API.replace(/^http/, "ws")}/api/stt/stream`, { headers: { cookie } } as unknown as string[]);
    socket.binaryType = "arraybuffer";
    const out: Listen = { final: "", finalAt: 0, speechEndAt: 0, sttMs: 0, edges: [], resumedAt: [], ready: {} };
    let offset = 0; let timer: ReturnType<typeof setInterval> | null = null; let silentFrames = 0; let sttMs: number | null = null; let final: string | null = null;
    const finish = () => { if (timer) clearInterval(timer); timer = null; };
    const settle = () => { if (final !== null && sttMs !== null) { finish(); out.final = final; out.sttMs = sttMs; setTimeout(() => socket.close(), 50); resolve(out); } };
    const deadline = setTimeout(() => { finish(); socket.close(); reject(new Error("no final within 25 s")); }, 25_000);
    socket.onerror = () => { clearTimeout(deadline); finish(); reject(new Error("STT socket failed")); };
    socket.onmessage = (event) => {
      let m: { t?: string; v?: string; edge?: boolean; end?: { score: number; level: string; unfinished: boolean }; resumed?: boolean; talk_over?: { level: string; window_ms: number }; speech_end_to_final_ms?: number };
      try { m = JSON.parse(String(event.data)); } catch { return; }
      const now = performance.now();
      if (m.t === "ready") {
        out.ready = m.talk_over ?? {};
        timer = setInterval(() => {
          if (offset < pcm.length) { socket.send(pcm.slice(offset, offset + FRAME).buffer); if (offset <= lastVoicedSample && offset + FRAME > lastVoicedSample) out.speechEndAt = performance.now(); offset += FRAME; }
          else { socket.send(new Float32Array(FRAME).buffer); silentFrames++; if (silentFrames > 300) { finish(); clearTimeout(deadline); reject(new Error("the hub never finalized")); } }
        }, 20);
      } else if (m.t === "partial" && m.edge && typeof m.v === "string") out.edges.push({ at: now, text: m.v.trim(), level: m.end?.level ?? "?", score: m.end?.score ?? -1, unfinished: m.end?.unfinished ?? false });
      else if (m.t === "vad" && m.resumed) out.resumedAt.push(now);
      else if (m.t === "timing" && typeof m.speech_end_to_final_ms === "number") { sttMs = m.speech_end_to_final_ms; settle(); }
      else if (m.t === "final" && typeof m.v === "string") { final = m.v.trim(); out.finalAt = now; clearTimeout(deadline); settle(); }
      else if (m.t === "no_speech" || m.t === "error") { clearTimeout(deadline); finish(); reject(new Error(`hub: ${m.t}`)); }
    };
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
function wordAccuracy(script: string, heard: string): number {
  const a = norm(script).split(" ").filter(Boolean); const b = norm(heard).split(" ").filter(Boolean);
  // Levenshtein over words: accuracy is 1 minus the edit distance over the script's length.
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return a.length === 0 ? 1 : Math.max(0, 1 - d[a.length]![b.length]! / a.length);
}
const fires = (level: "gentle" | "natural", edgeLevel: string) => edgeLevel === "gentle" || (level === "natural" && edgeLevel === "natural");
function median(values: number[]): number | null { const s = [...values].sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); }

async function main(): Promise<void> {
  const cookie = await signIn();
  await setSetting(cookie, "voice.speculative_start", true);
  await setSetting(cookie, "voice.talk_over", "natural"); // the grant on `ready` proves the hub's gate; the levels are scored from each edge's own level
  const results: Record<string, unknown> = { api: API, pauses: PAUSES, mixes: MIXES };
  const gap = async () => new Promise((resolve) => setTimeout(resolve, 1500));

  // Pass 1: clean ends.
  const clean: Array<{ early_release_ms: number | null; level: string; matched: boolean; edges: number; stt_ms: number }> = [];
  let grant: { level?: string; window_ms?: number } = {};
  for (const text of CLEAN) {
    const pcm = await speak(cookie, text);
    const r = await listen(cookie, pcm, pcm.length - 1);
    grant = r.ready;
    const last = r.edges[r.edges.length - 1];
    const row = { early_release_ms: last ? Math.round(last.at + 30 - r.speechEndAt) : null, level: last?.level ?? "none", matched: last ? last.text === r.final : false, edges: r.edges.length, stt_ms: r.sttMs };
    clean.push(row);
    log(`clean  ${text.length.toString().padStart(2)} chars | edges ${row.edges} | last edge ${row.level.padEnd(7)} | clip would start ${row.early_release_ms} ms after the end of speech | final ${row.matched ? "matches" : "differs"} | stt ${row.stt_ms} ms`);
    await gap();
  }
  results.ready_grant = grant;
  results.clean = { turns: clean.length, released_gentle: clean.filter((r) => fires("gentle", r.level)).length, released_natural: clean.filter((r) => fires("natural", r.level)).length, early_release_median_ms: median(clean.flatMap((r) => r.early_release_ms === null ? [] : [r.early_release_ms])), matched: clean.filter((r) => r.matched).length, rows: clean };

  // Pass 2: mid-sentence pauses.
  const paused: Array<{ pause_ms: number; first_edge_level: string; wrong_gentle: boolean; wrong_natural: boolean; edge_to_resumed_ms: number | null; final_whole: boolean }> = [];
  for (const pauseMs of PAUSES) {
    for (const [first, rest] of PAUSED) {
      const a = await speak(cookie, first); const b = await speak(cookie, rest);
      const pcm = concat([a, new Float32Array(Math.round(pauseMs / 1000 * SAMPLE_RATE)), b]);
      const r = await listen(cookie, pcm, pcm.length - 1);
      // The first edge partial is the one inside the pause (the hub needs 0.2 s of silence to mark one); a pause under 0.2 s marks none.
      const firstEdge = r.edges.find((e) => e.at < r.speechEndAt);
      const resumed = r.resumedAt.find((t) => firstEdge !== undefined && t > firstEdge.at);
      const row = { pause_ms: pauseMs, first_edge_level: firstEdge?.level ?? "none", wrong_gentle: firstEdge !== undefined && fires("gentle", firstEdge.level), wrong_natural: firstEdge !== undefined && fires("natural", firstEdge.level), edge_to_resumed_ms: firstEdge && resumed ? Math.round(resumed - firstEdge.at) : null, final_whole: wordAccuracy(`${first} ${rest}`, r.final) >= 0.8 };
      paused.push(row);
      log(`pause ${pauseMs} ms | first edge ${row.first_edge_level.padEnd(7)} | wrong start at gentle ${row.wrong_gentle ? "YES" : "no "} natural ${row.wrong_natural ? "YES" : "no "} | resumed ${row.edge_to_resumed_ms ?? "-"} ms after the edge | final carries the whole utterance ${row.final_whole ? "yes" : "NO"}`);
      await gap();
    }
  }
  results.paused = { turns: paused.length, per_pause: Object.fromEntries(PAUSES.map((p) => [p, { turns: paused.filter((r) => r.pause_ms === p).length, wrong_gentle: paused.filter((r) => r.pause_ms === p && r.wrong_gentle).length, wrong_natural: paused.filter((r) => r.pause_ms === p && r.wrong_natural).length, edge_to_resumed_median_ms: median(paused.flatMap((r) => r.pause_ms === p && r.edge_to_resumed_ms !== null ? [r.edge_to_resumed_ms] : [])), final_whole: paused.filter((r) => r.pause_ms === p && r.final_whole).length }])), rows: paused };

  // Pass 3: the acknowledgement under the tail of the utterance.
  const ack = await speak(cookie, ACK);
  const overlap: Array<{ mix_db: number; accuracy: number }> = [];
  for (const dB of MIXES) {
    for (const text of CLEAN.slice(0, 6)) {
      const pcm = await speak(cookie, text);
      const start = Math.max(0, pcm.length - Math.round(0.4 * SAMPLE_RATE));
      const mixed = mixUnder(pcm, ack, start, dB);
      const r = await listen(cookie, mixed, pcm.length - 1);
      const accuracy = wordAccuracy(text, r.final);
      overlap.push({ mix_db: dB, accuracy });
      log(`overlap ${dB} dB | word accuracy ${(accuracy * 100).toFixed(0)}%`);
      await gap();
    }
  }
  results.overlap = Object.fromEntries(MIXES.map((dB) => [dB, { turns: overlap.filter((r) => r.mix_db === dB).length, word_accuracy_median: median(overlap.filter((r) => r.mix_db === dB).map((r) => Math.round(r.accuracy * 100))) }]));

  await setSetting(cookie, "voice.talk_over", "off");
  const wrongRate = (level: "wrong_gentle" | "wrong_natural") => paused.length ? Math.round(paused.filter((r) => r[level]).length / paused.length * 100) : null;
  results.summary = { clean_released_gentle: `${(results.clean as { released_gentle: number }).released_gentle} of ${clean.length}`, clean_released_natural: `${(results.clean as { released_natural: number }).released_natural} of ${clean.length}`, early_release_median_ms: (results.clean as { early_release_median_ms: number | null }).early_release_median_ms, wrong_start_rate_gentle_pct: wrongRate("wrong_gentle"), wrong_start_rate_natural_pct: wrongRate("wrong_natural") };
  console.log(JSON.stringify(results.summary, null, 2));
  const outputDir = join(ROOT, "data-scratch/bench/talk-over", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`written: ${outputDir}/results.json`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
