/**
 * VOICE-LATENCY-02: first sound after the person stops talking, measured end to end through a Home hub's real
 * voice path (the STT websocket with real audio, the spoken turn stream, the TTS route for the first sentence),
 * without a browser. Counts only: no utterance or reply text is written anywhere but the console (--quiet hides it).
 *
 *   cd backend && bun run scripts/bench/voice-first-sound.ts [--api http://127.0.0.1:8826] [--person person-xxx]
 *       [--secret ...] [--turns 6] [--gap 5] [--speculative on|off|keep]
 *
 * One turn: Home speaks a short question (POST /api/tts, the person's voice), the WAV is streamed to WS /api/stt/stream as
 * 20 ms frames in real time followed by silence (so the hub's own silence timer and endpointer decide the final,
 * exactly as with a microphone), the final starts POST /api/turn/stream with spoken: true, the first sentence
 * (the same first-chunk rule as the browser's sentenceChunker) goes to POST /api/tts, and the time to its first
 * audio bytes is the first sound. With --speculative on, the turn starts privately on the edge partial and is
 * confirmed on the final (STT-SMARTTURN-01), exactly as liveVoiceSession.tsx does. The client timing message is
 * sent on the socket, so `bun run voice:latency` on the hub's data directory reports these turns too.
 *
 * What a browser adds on top (not measured here): WAV decode and AudioContext start, about 0.1 to 0.2 s (measured
 * on the live hub 2026-11-11: first_playback_ms minus first_sentence_ms minus first_audio_ms, median 175 ms).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadavg, cpus } from "node:os";
import { nextSentenceBoundary } from "../../../frontend/src/lib/sentenceChunker";

const ROOT = new URL("../../../", import.meta.url).pathname;
const UTTERANCES = [
  "What is a good name for a small grey cat?",
  "Is it going to rain tomorrow?",
  "What is a quick dinner idea with eggs?",
  "How long should I boil an egg?",
  "Tell me a fun fact about owls.",
  "What rhymes with orange?",
];

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const API = option("--api", "http://127.0.0.1:8826").replace(/\/$/, "");
const PERSON = option("--person", "person-xc0ea5rte3");
const SECRET = option("--secret", "correcthorsebattery");
const TURNS = Math.max(1, Number(option("--turns", "6")) || 6);
const GAP_MS = Math.max(0, Number(option("--gap", "5")) || 5) * 1000;
const SPECULATIVE = option("--speculative", "keep") as "on" | "off" | "keep";
const QUIET = process.argv.includes("--quiet");
const DEBUG_STT = process.argv.includes("--debug-stt");
const SAMPLE_RATE = 16_000;
const FRAME = 320; // 20 ms

type Turn = {
  mode: "normal" | "speculative" | "speculative_fallback";
  stt_ms: number | null; request_to_first_delta_ms: number | null; request_to_first_sentence_ms: number | null;
  tts_ttfa_ms: number | null; cue_ms: number | null; cue_tts_ttfa_ms: number | null;
  first_sound_answer_ms: number | null; first_sound_any_ms: number | null;
  ttft_engine_ms: number | null; prompt_n: number | null; cache_n: number | null; load_pct: number;
  first_sentence_chars: number | null; error?: string;
};

function log(line: string): void { if (!QUIET) console.log(line); }

async function signIn(): Promise<string> {
  const res = await fetch(`${API}/api/auth/verify-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: PERSON, secret: SECRET }) });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${(await res.text()).slice(0, 120)}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("sign-in gave no session cookie");
  return cookie;
}

async function setSpeculative(cookie: string, value: boolean): Promise<void> {
  const res = await fetch(`${API}/api/settings`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ scope: "household", key: "voice.speculative_start", value }) });
  if (!res.ok) throw new Error(`could not set voice.speculative_start: ${res.status} ${(await res.text()).slice(0, 120)}`);
}

async function speak(cookie: string, text: string): Promise<Float32Array> {
  // Through Home's own TTS route (the Stack only answers Home), in the signed-in person's voice; the WAV header of a
  // streamed response may carry no length, so the data chunk is read to the end of the bytes.
  const res = await fetch(`${API}/api/tts`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`Home tts ${res.status}: ${(await res.text()).slice(0, 160)}`);
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
  if (sampleRate === SAMPLE_RATE) return samples;
  const out = new Float32Array(Math.floor(samples.length * SAMPLE_RATE / sampleRate));
  for (let i = 0; i < out.length; i++) { const pos = i * sampleRate / SAMPLE_RATE; const lo = Math.floor(pos); const hi = Math.min(samples.length - 1, lo + 1); out[i] = samples[lo]! + (samples[hi]! - samples[lo]!) * (pos - lo); }
  return out;
}

function firstChunk(text: string): string | null {
  const at = nextSentenceBoundary(text, true);
  return at > 0 ? text.slice(0, at).trim() : null;
}

async function ttsFirstBytes(cookie: string, text: string, turnId: string): Promise<number> {
  const started = performance.now();
  const res = await fetch(`${API}/api/tts`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ text, turn_id: turnId, generation: 0 }) });
  if (!res.ok || !res.body) throw new Error(`tts ${res.status}`);
  const reader = res.body.getReader();
  const first = await reader.read();
  const at = performance.now() - started;
  void reader.cancel().catch(() => undefined);
  if (first.done) throw new Error("tts gave no audio");
  return at;
}

type StreamOutcome = { requestAt: number; firstDeltaAt: number | null; firstSentenceAt: number | null; sentence: string | null; cueAt: number | null; cue: string | null; turnId: string | null; conversationId: string | null; ttft: number | null; promptN: number | null; cacheN: number | null; fullText: string };

async function readTurnStream(cookie: string, body: Record<string, unknown>, onSentence: (s: string, turnId: string) => void, onCue: (s: string, turnId: string) => void): Promise<StreamOutcome> {
  const out: StreamOutcome = { requestAt: performance.now(), firstDeltaAt: null, firstSentenceAt: null, sentence: null, cueAt: null, cue: null, turnId: null, conversationId: null, ttft: null, promptN: null, cacheN: null, fullText: "" };
  const res = await fetch(`${API}/api/turn/stream`, { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson", cookie }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`turn stream ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffered = ""; let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, nl); buffered = buffered.slice(nl + 1);
      if (!line.trim()) continue;
      let event: { type?: string; text?: string; turn_id?: string; conversation_id?: string; value?: { stats?: { time_to_first_token_ms?: number; prompt_tokens?: number; cache_reuse_tokens?: number } } };
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "turn_meta") { out.turnId = event.turn_id ?? null; out.conversationId = event.conversation_id ?? null; }
      else if (event.type === "spoken_cue" && typeof event.text === "string" && out.cueAt === null) { out.cueAt = performance.now(); out.cue = event.text; if (out.turnId) onCue(event.text, out.turnId); }
      else if (event.type === "delta" && typeof event.text === "string") {
        if (out.firstDeltaAt === null) out.firstDeltaAt = performance.now();
        text += event.text;
        if (out.firstSentenceAt === null) { const chunk = firstChunk(text); if (chunk && out.turnId) { out.firstSentenceAt = performance.now(); out.sentence = chunk; onSentence(chunk, out.turnId); } }
      } else if (event.type === "done") {
        if (out.firstSentenceAt === null && text.trim() && out.turnId) { out.firstSentenceAt = performance.now(); out.sentence = text.trim(); onSentence(text.trim(), out.turnId); }
        out.fullText = text;
        const stats = event.value?.stats; out.ttft = stats?.time_to_first_token_ms ?? null; out.promptN = stats?.prompt_tokens ?? null; out.cacheN = stats?.cache_reuse_tokens ?? null;
      }
    }
  }
  return out;
}

/** Streams one utterance to the STT socket in real time and resolves with the final, the server's stt_ms and the edge partial. */
function listen(cookie: string, pcm: Float32Array, onEdgePartial: (text: string) => void): Promise<{ final: string; sttMs: number; socket: WebSocket }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${API.replace(/^http/, "ws")}/api/stt/stream`, { headers: { cookie } } as unknown as string[]);
    socket.binaryType = "arraybuffer";
    // The edge partial is the one the hub transcribes at its first silent frame (sttSession.ts, DUPLEX-EDGE): here, the first partial
    // that arrives once the last voiced sample has been sent. (The hub's `vad speaking: false` comes later, at finalize.)
    let lastVoiced = pcm.length - 1; while (lastVoiced > 0 && Math.abs(pcm[lastVoiced]!) < 0.01) lastVoiced--;
    let offset = 0; let timer: ReturnType<typeof setInterval> | null = null; let sttMs: number | null = null; let final: string | null = null; let edgeSent = false; let silentFrames = 0;
    const finish = () => { if (timer) clearInterval(timer); timer = null; };
    const settle = () => { if (final !== null && sttMs !== null) { finish(); resolve({ final, sttMs, socket }); } };
    const deadline = setTimeout(() => { finish(); socket.close(); reject(new Error("no final transcript within 20 s")); }, 20_000);
    socket.onerror = () => { clearTimeout(deadline); finish(); reject(new Error("STT socket failed")); };
    socket.onmessage = (event) => {
      let message: { t?: string; v?: string; speaking?: boolean; speech_end_to_final_ms?: number };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (DEBUG_STT) console.log(`  stt ${message.t}${message.t === "vad" ? ` speaking=${message.speaking}` : ""}${typeof message.v === "string" ? ` ${JSON.stringify(message.v)}` : ""}${message.t === "timing" ? ` ${message.speech_end_to_final_ms} ms` : ""}`);
      if (message.t === "ready") {
        timer = setInterval(() => {
          if (offset < pcm.length) { socket.send(pcm.slice(offset, offset + FRAME).buffer); offset += FRAME; }
          else { socket.send(new Float32Array(FRAME).buffer); silentFrames++; if (silentFrames > 400) { finish(); clearTimeout(deadline); reject(new Error("the hub never finalized")); } }
        }, 20);
      } else if (message.t === "partial" && offset > lastVoiced && !edgeSent && typeof message.v === "string") { edgeSent = true; onEdgePartial(message.v.trim()); }
      else if (message.t === "timing" && typeof message.speech_end_to_final_ms === "number") { sttMs = message.speech_end_to_final_ms; settle(); }
      else if (message.t === "final" && typeof message.v === "string") { final = message.v.trim(); clearTimeout(deadline); settle(); }
      else if (message.t === "no_speech") { clearTimeout(deadline); finish(); reject(new Error("the hub heard no speech")); }
      else if (message.t === "error") { clearTimeout(deadline); finish(); reject(new Error(`STT error: ${message.v ?? ""}`)); }
    };
  });
}

async function oneTurn(cookie: string, utterance: string, speculative: boolean, conversationId: string | null): Promise<{ turn: Turn; conversationId: string | null }> {
  const loadPct = Math.round(((loadavg()[0] ?? 0) / Math.max(1, cpus().length)) * 100);
  const pcm = await speak(cookie, utterance);
  const turn: Turn = { mode: "normal", stt_ms: null, request_to_first_delta_ms: null, request_to_first_sentence_ms: null, tts_ttfa_ms: null, cue_ms: null, cue_tts_ttfa_ms: null, first_sound_answer_ms: null, first_sound_any_ms: null, ttft_engine_ms: null, prompt_n: null, cache_n: null, load_pct: loadPct, first_sentence_chars: null };
  let held: Promise<{ turn_id: string; resume_token: string; conversation_id: string; text: string } | null> | null = null;
  const { final, sttMs, socket } = await listen(cookie, pcm, (edge) => {
    if (!speculative || !edge) return;
    held = fetch(`${API}/api/turn/stream`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ surface: "chat", text: edge, spoken: true, speculative: true, ...(conversationId ? { conversation_id: conversationId } : {}) }) })
      .then(async (res) => { if (res.ok) return { ...(await res.json() as { turn_id: string; resume_token: string; conversation_id: string }), text: edge }; if (DEBUG_STT) console.log(`  speculative start refused: ${res.status} ${(await res.text()).slice(0, 160)}`); return null; }).catch((error) => { if (DEBUG_STT) console.log(`  speculative start failed: ${error instanceof Error ? error.message : String(error)}`); return null; });
  });
  turn.stt_ms = sttMs;
  const ttsJobs: Array<Promise<void>> = [];
  const onSentence = (sentence: string, turnId: string) => { turn.first_sentence_chars = sentence.length; ttsJobs.push(ttsFirstBytes(cookie, sentence, turnId).then((ms) => { turn.tts_ttfa_ms = Math.round(ms); }).catch((error) => { turn.error = `tts: ${error instanceof Error ? error.message : String(error)}`; })); };
  const onCue = (cue: string, turnId: string) => { ttsJobs.push(ttsFirstBytes(cookie, cue, turnId).then((ms) => { turn.cue_tts_ttfa_ms = Math.round(ms); }).catch(() => undefined)); };
  const base = { surface: "chat", text: final, spoken: true, stt_ms: sttMs, ...(conversationId ? { conversation_id: conversationId } : {}) };
  let outcome: StreamOutcome;
  const ids = held ? await (held as Promise<{ turn_id: string; resume_token: string; conversation_id: string; text: string } | null>) : null;
  if (DEBUG_STT && ids) console.log(`  edge partial ${JSON.stringify(ids.text)} vs final ${JSON.stringify(final)}: ${ids.text === final ? "match" : "no match"}`);
  if (ids && ids.text === final) {
    turn.mode = "speculative";
    outcome = await readTurnStream(cookie, { ...base, conversation_id: ids.conversation_id, resume_token: ids.resume_token, turn_id: ids.turn_id, resume_from: 0, confirm: true }, onSentence, onCue);
  } else {
    if (ids) { turn.mode = "speculative_fallback"; await fetch(`${API}/api/turn/${encodeURIComponent(ids.turn_id)}/cancel`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ discard: true }) }).catch(() => undefined); }
    else if (speculative) turn.mode = "speculative_fallback";
    outcome = await readTurnStream(cookie, base, onSentence, onCue);
  }
  await Promise.all(ttsJobs);
  // The browser speaks every sentence; the last one's audio hand-off is what starts CONVO-PREWARM-02 (the next turn's cache hit).
  if (outcome.turnId && outcome.fullText) { const parts = outcome.fullText.trim().split(/(?<=[.!?])\s+/).filter(Boolean); const last = parts[parts.length - 1]; if (last) await ttsFirstBytes(cookie, last, outcome.turnId).catch(() => undefined); }
  const rel = (at: number | null) => at === null ? null : Math.round(at - outcome.requestAt);
  turn.request_to_first_delta_ms = rel(outcome.firstDeltaAt);
  turn.request_to_first_sentence_ms = rel(outcome.firstSentenceAt);
  turn.cue_ms = rel(outcome.cueAt);
  turn.ttft_engine_ms = outcome.ttft; turn.prompt_n = outcome.promptN; turn.cache_n = outcome.cacheN;
  if (turn.request_to_first_sentence_ms !== null && turn.tts_ttfa_ms !== null) turn.first_sound_answer_ms = sttMs + turn.request_to_first_sentence_ms + turn.tts_ttfa_ms;
  const cueSound = turn.cue_ms !== null && turn.cue_tts_ttfa_ms !== null ? sttMs + turn.cue_ms + turn.cue_tts_ttfa_ms : null;
  turn.first_sound_any_ms = turn.first_sound_answer_ms === null ? cueSound : cueSound === null ? turn.first_sound_answer_ms : Math.min(cueSound, turn.first_sound_answer_ms);
  if (outcome.turnId) {
    const playback = turn.request_to_first_sentence_ms !== null && turn.tts_ttfa_ms !== null ? turn.request_to_first_sentence_ms + turn.tts_ttfa_ms : undefined;
    socket.send(JSON.stringify({ t: "timing", turn_id: outcome.turnId, stt_ms: sttMs, ...(playback === undefined ? {} : { first_playback_ms: playback }), ...(turn.request_to_first_sentence_ms === null ? {} : { first_sentence_ms: turn.request_to_first_sentence_ms }), ...(cueSound === null ? {} : { cue_playback_ms: cueSound - sttMs }) }));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  socket.close();
  log(`${turn.mode.padEnd(22)} stt ${sttMs} ms | first delta ${turn.request_to_first_delta_ms} | first sentence ${turn.request_to_first_sentence_ms} (${turn.first_sentence_chars} chars) | tts ${turn.tts_ttfa_ms} | cue ${turn.cue_ms ?? "-"}/${turn.cue_tts_ttfa_ms ?? "-"} | FIRST SOUND ${turn.first_sound_any_ms} ms (answer ${turn.first_sound_answer_ms}) | ttft ${turn.ttft_engine_ms} | new tokens ${turn.prompt_n !== null && turn.cache_n !== null ? turn.prompt_n - turn.cache_n : "?"} | load ${loadPct}%`);
  return { turn, conversationId: outcome.conversationId ?? conversationId };
}

function median(values: number[]): number | null { const s = [...values].sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); }
function p90(values: number[]): number | null { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.ceil(s.length * 0.9) - 1]! : null; }

async function main(): Promise<void> {
  const cookie = await signIn();
  if (SPECULATIVE !== "keep") await setSpeculative(cookie, SPECULATIVE === "on");
  const turns: Turn[] = [];
  let conversationId: string | null = null;
  for (let i = 0; i < TURNS; i++) {
    try { const result = await oneTurn(cookie, UTTERANCES[i % UTTERANCES.length]!, SPECULATIVE === "on", conversationId); turns.push(result.turn); conversationId = result.conversationId; }
    catch (error) { console.log(`turn ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`); }
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));
  }
  const pick = (key: keyof Turn) => turns.flatMap((t) => typeof t[key] === "number" ? [t[key] as number] : []);
  const summary = {
    api: API, speculative: SPECULATIVE, turns: turns.length, confirmed: turns.filter((t) => t.mode === "speculative").length, fallbacks: turns.filter((t) => t.mode === "speculative_fallback").length,
    first_sound_any_median_ms: median(pick("first_sound_any_ms")), first_sound_any_p90_ms: p90(pick("first_sound_any_ms")),
    first_sound_answer_median_ms: median(pick("first_sound_answer_ms")), first_sound_answer_p90_ms: p90(pick("first_sound_answer_ms")),
    stt_median_ms: median(pick("stt_ms")), first_delta_median_ms: median(pick("request_to_first_delta_ms")), first_sentence_median_ms: median(pick("request_to_first_sentence_ms")), tts_ttfa_median_ms: median(pick("tts_ttfa_ms")), ttft_engine_median_ms: median(pick("ttft_engine_ms")), load_pct_median: median(pick("load_pct")),
  };
  console.log(JSON.stringify(summary, null, 2));
  const outputDir = join(ROOT, "data-scratch/bench/voice-first-sound", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "results.json"), `${JSON.stringify({ summary, turns }, null, 2)}\n`);
  console.log(`written: ${outputDir}/results.json`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
