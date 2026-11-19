import { config } from "./config";
import { FrameVad } from "./vad";
import { TurnManager } from "./turnManager";
import { History } from "./history";
import { buildPrompt, datedUser } from "./prompt";
import { encodeWav, StreamingWavReader } from "./wav";
import { chat, transcribe, turnCheck, speech } from "./stack";
import { Chunker } from "./chunker";
import { TagStream, forEngine } from "./tags";
import { appendMetrics, type TurnMetrics } from "./metrics";
import { rmsEnvelope, selfVoiceVerdict } from "./echo";
import { isBackchannel } from "./backchannel";
import { runTool, toolDefinitions } from "./tools";
import { fileURLToPath } from "node:url";
const supported = ["laugh", "chuckle", "cough", "sigh", "clear throat", "gasp"];
const metricsPath = fileURLToPath(new URL("../results/turns.jsonl", import.meta.url));
const cutinsPath = fileURLToPath(new URL("../results/cutins.jsonl", import.meta.url));
export class VoiceSession {
  private vad = new FrameVad(); private tm = new TurnManager(); private history = new History(buildPrompt());
  private samples: number[] = []; private preRoll: number[] = []; private cutInSamples: number[] = [];
  private micEnvelope: number[] = []; private refEnvelope: number[] = []; private chunkRefEnvelopes: number[][] = []; private chunkRefWindows: number[][] = [];
  private turn = 1; private abort: AbortController | null = null; private held = false; private heldFrames: Uint8Array[] = [];
  private heldChunkEvents: Array<{ t: string; turn: number; chunk: number; text: string }> = []; private heldFinalText = "";
  private chunks: string[] = []; private chunkDurations: number[] = []; private playedMs: number[] = []; private generatedText = ""; private generatedComplete = false;
  private metricsWritten = false; private metrics: TurnMetrics = {}; private heardAudio = false; private echoThreshold = config.echoThreshold;
  private lastVoiceAt = performance.now(); private speechOrigin = performance.now(); private earlyStart = config.earlyStart;
  private proto = 1; private seqExpected = 0; private netSim = { delayMs: 0, jitterMs: 0, burstEveryMs: 0, burstStallMs: 0 }; private outgoingAt = 0; private toolPendingAudio = false; private captureOffset = 0; private offsetInitialized = false; private toolDelayMs = 2500;
  constructor(private ws: ServerWebSocket<unknown>, private secret: string) { this.send({ t: "state", state: "idle", vad: this.vad.mode }); }
  private send(v: unknown) { if (this.ws.readyState === 1) { const data = JSON.stringify(v); this.delayOutgoing(() => { if (this.ws.readyState === 1) this.ws.send(data); }); } }
  private delayOutgoing(fn: () => void) { const now = performance.now(); const sim = this.netSim; const jitter = sim.jitterMs ? ((Math.floor(now) % 2001) / 2000 * 2 - 1) * sim.jitterMs : 0; const burst = sim.burstEveryMs && Math.floor(now / sim.burstEveryMs) !== Math.floor((now - 1) / sim.burstEveryMs) ? sim.burstStallMs : 0; const at = Math.max(now, this.outgoingAt) + Math.max(0, sim.delayMs + jitter) + burst; this.outgoingAt = at; setTimeout(fn, Math.max(0, at - now)); }
  private sendFrame(frame: Uint8Array) { if (this.held) this.heldFrames.push(frame); else { if (this.metrics.t_first_frame_sent === undefined) this.metrics.t_first_frame_sent = this.metricNow(); this.delayOutgoing(() => { if (this.ws.readyState === 1) this.ws.send(frame); }); } }
  private metricNow() { return Math.max(0, performance.now() - this.speechOrigin); }
  private updatePlayedReference() { const all: number[] = []; for (let i = 0; i < this.chunkRefEnvelopes.length; i++) all.push(...this.chunkRefEnvelopes[i].slice(0, Math.floor((this.playedMs[i] ?? 0) / 10))); this.refEnvelope = all.slice(-100); }
  private finishMetrics() { if (this.metricsWritten || !Object.keys(this.metrics).length) return; this.metricsWritten = true; this.metrics.chunks = this.chunks.length; appendMetrics(metricsPath, this.metrics); this.send({ t: "timing", ...this.metrics }); }
  private command(c: { type: string; [key: string]: unknown }) {
    switch (c.type) {
      case "state": this.send({ t: "state", state: c.state }); break;
      case "check_turn": void this.check(); break;
      case "transcript_ready": for (const next of this.tm.transcriptReady(String(c.text))) this.command(next); break;
      case "start_reply_held": this.held = true; this.metrics.early_start = "used"; void this.reply(String(c.transcript), false); break;
      case "transcribe_cut_in": if (c.forced) { this.writeCutin(false); this.samples = this.cutInSamples.slice(); this.cutInSamples = []; this.send({ t: "stop", turn: this.turn }); this.send({ t: "state", state: "user_speaking" }); } else void this.finishCutIn(); break;
      case "backchannel": this.send({ t: "resume" }); this.writeCutin(true); this.cutInSamples = []; this.samples = []; break;
      case "pause": this.send({ t: "pause" }); break;
      case "commit":
        this.metrics.t_commit = this.metricNow(); this.metrics.commit_reason = c.reason as "model" | "timeout";
        this.history.commitUser(datedUser(String(c.transcript))); this.samples = [];
        if (this.held) { this.send({ t: "final", text: String(c.transcript), turn: this.turn }); this.held = false; for (const event of this.heldChunkEvents) this.send(event); this.heldChunkEvents = []; for (const f of this.heldFrames) this.ws.send(f); this.heldFrames = []; if (this.generatedComplete && this.heldFinalText) { this.send({ t: "reply_final", text: this.heldFinalText, turn: this.turn }); this.heldFinalText = ""; } }
        else { void this.reply(String(c.transcript), true); this.send({ t: "final", text: String(c.transcript), turn: this.turn }); }
        this.send({ t: "state", state: "thinking" }); break;
      case "cancel_held": this.metrics.early_start = "discarded"; this.abort?.abort(); this.held = false; this.heldFrames = []; this.heldChunkEvents = []; this.heldFinalText = ""; this.generatedText = ""; this.finishMetrics(); this.send({ t: "stop", turn: this.turn }); this.send({ t: "state", state: "user_speaking" }); break;
      case "interrupt": this.abort?.abort(); if (!this.held && this.generatedText) { this.history.commitAssistant(this.generatedText); this.history.trimAssistantToHeard(this.chunks, this.playedMs, this.chunkDurations); this.generatedText = ""; this.metrics.t_stop_sent = this.metricNow(); } this.finishMetrics(); this.send({ t: "stop", turn: this.turn }); this.heldFrames = []; this.held = false; this.send({ t: "state", state: c.tap ? "idle" : "user_speaking" }); break;
      case "duck": this.send({ t: "duck" }); break;
      case "resume": this.send({ t: "resume" }); break;
      case "discard": this.samples = []; break;
    }
  }
  private writeCutin(backchannel: boolean) { appendMetrics(cutinsPath, { backchannel, duration_ms: this.tm.cutDuration } as TurnMetrics); }
  private async finishCutIn() {
    const audio = Float32Array.from(this.cutInSamples);
    let text = ""; try { text = await transcribe(encodeWav(audio), this.abort?.signal); } catch {}
    const backchannel = isBackchannel(text);
    if (Bun.env.LAB_DEBUG_TEXT) console.log(`cut-in heard: ${JSON.stringify(text)} backchannel=${backchannel} seconds=${(audio.length / 16000).toFixed(2)}`);
    for (const command of this.tm.cutTranscript(text, backchannel)) this.command(command);
    if (!backchannel) { this.cutInSamples = []; this.writeCutin(false); this.samples = [...audio]; this.speechOrigin = performance.now(); this.abort?.abort(); if (this.generatedText) { this.history.commitAssistant(this.generatedText); this.history.trimAssistantToHeard(this.chunks, this.playedMs, this.chunkDurations); this.generatedText = ""; } this.send({ t: "stop", turn: this.turn }); this.send({ t: "state", state: "user_speaking" }); }
  }
  private async check() { this.metrics = { early_start: this.earlyStart ? "used" : "off" }; this.metricsWritten = false; const wav = encodeWav(Float32Array.from(this.samples.slice(-config.sampleRate * 8))); this.metrics.t_check = this.metricNow(); const [text, model] = await Promise.allSettled([transcribe(wav), turnCheck(wav)]); if (text.status === "fulfilled") { this.send({ t: "partial", text: text.value }); this.metrics.t_transcript = this.metricNow(); this.command({ type: "transcript_ready", text: text.value }); } if (model.status === "fulfilled") { this.metrics.t_turn_model = this.metricNow(); for (const c of this.tm.turnModel(model.value.probability, model.value.complete)) this.command(c); } }
  private async reply(text: string, committed: boolean) {
    if (!text.trim()) return;
    this.abort = new AbortController(); const signal = this.abort.signal; this.chunks = []; this.chunkDurations = []; this.playedMs = []; this.generatedText = ""; this.generatedComplete = false; this.heldFrames = []; this.heldChunkEvents = []; this.heldFinalText = ""; this.micEnvelope = []; this.refEnvelope = []; this.chunkRefEnvelopes = []; this.chunkRefWindows = []; this.heardAudio = false; this.turn++;
    const requestMessages: any[] = committed ? [...this.history.messages] : [...this.history.messages, { role: "user", content: datedUser(text) }];
    const chunker = new Chunker(), tagger = new TagStream(); let full = "", rounds = 0, toolTextLength = 0, headerGate: Promise<void> = Promise.resolve(), sendQueue: Promise<void> = Promise.resolve();
    const schedule = (piece: string) => { const index = this.chunks.length; this.chunks.push(piece); this.chunkDurations[index] = 0; this.playedMs[index] = 0; this.chunkRefEnvelopes[index] = []; this.chunkRefWindows[index] = []; if (this.metrics.t_first_chunk_text === undefined) this.metrics.t_first_chunk_text = this.metricNow(); const event = { t: "chunk", turn: this.turn, chunk: index, text: piece }; if (this.held) this.heldChunkEvents.push(event); else this.send(event); const response = headerGate.then(() => speech(forEngine(piece, supported), signal)); response.catch(() => {}); headerGate = response.then(() => {}, () => {}); sendQueue = sendQueue.then(() => this.say(piece, index, signal, response)).catch(() => {}); };
    const speakText = async (delta: string) => { full += delta; this.generatedText = full; const clean = tagger.push(delta); for (const piece of chunker.push(clean)) schedule(piece); };
    try {
      while (rounds <= 2) {
        let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
        for await (const event of chat(requestMessages, signal, undefined, toolDefinitions)) {
          if (!this.metrics.t_llm_first_token) this.metrics.t_llm_first_token = this.metricNow();
          if (event.type === "text") await speakText(event.text); else toolCalls = event.calls;
        }
        if (!toolCalls.length || rounds >= 2) break;
        for (const piece of chunker.push(tagger.flush())) schedule(piece); for (const piece of chunker.flush()) schedule(piece); // say the line before the tool runs
        rounds++; this.metrics.tool_rounds = rounds;
        const assistantWords = full.slice(toolTextLength); toolTextLength = full.length;
        const call = toolCalls[0]; this.metrics.t_tool_start = this.metricNow(); this.send({ t: "tool_start", name: call.name });
        let result: string; try { result = await runTool({ name: call.name, arguments: call.arguments }, this.toolDelayMs); } catch { result = "The tool failed."; }
        this.metrics.t_tool_end = this.metricNow(); this.toolPendingAudio = true; this.send({ t: "tool_end", name: call.name, ms: this.metrics.t_tool_end - this.metrics.t_tool_start });
        const messagesForCall = toolCalls.map((x) => ({ id: x.id, type: "function", function: { name: x.name, arguments: JSON.stringify(x.arguments) } }));
        const toolResults = toolCalls.map((x) => ({ id: x.id, content: x.name === call.name ? result : "Tool not run." }));
        this.history.commitToolExchange(assistantWords, messagesForCall, toolResults);
        requestMessages.push({ role: "assistant", content: assistantWords || null, tool_calls: messagesForCall });
        for (const tool of toolResults) requestMessages.push({ role: "tool", tool_call_id: tool.id, content: tool.content });
      }
      for (const piece of chunker.push(tagger.flush())) schedule(piece); for (const piece of chunker.flush()) schedule(piece); await sendQueue;
      this.generatedText = full; this.generatedComplete = true;
      if (!this.held) this.send({ t: "reply_final", text: full, turn: this.turn }); else this.heldFinalText = full;
      if (full) this.history.commitAssistant(full);
    } catch (error) { if (!signal.aborted) { console.log(`reply error: ${(error as Error)?.name}: ${String((error as Error)?.message).slice(0, 200)}`); this.send({ t: "error", code: "reply_failed" }); this.finishMetrics(); } }
  }
  private async say(text: string, index: number, signal: AbortSignal, responsePromise: Promise<Response>) { const response = await responsePromise; const reader = response.body!.getReader(), wavReader = new StreamingWavReader(); let pending = false; while (true) { const x = await reader.read(); if (x.done) break; const pcm = wavReader.push(x.value); if (!pcm.length) continue; this.chunkDurations[index] += pcm.length * 1000 / config.replyRate; for (const value of pcm) { const win = this.chunkRefWindows[index]; win.push(value / 32768); if (win.length === 240) { this.chunkRefEnvelopes[index].push(Math.sqrt(win.reduce((sum, sample) => sum + sample * sample, 0) / 240)); win.length = 0; } } const frame = new Uint8Array(8 + pcm.length * 2), v = new DataView(frame.buffer); v.setUint32(0, this.turn, true); v.setUint16(4, index, true); for (let i = 0; i < pcm.length; i++) v.setInt16(8 + i * 2, pcm[i], true); this.sendFrame(frame); pending = true; } if (pending) { const tail = new Uint8Array(488), tv = new DataView(tail.buffer); tv.setUint32(0, this.turn, true); tv.setUint16(4, index, true); tv.setUint16(6, 1, true); this.sendFrame(tail); } }
  audio(bytes: Uint8Array) {
    let frame: Float32Array, capture = performance.now();
    if (this.proto === 2) { if (bytes.length < 12) return; const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const seq = dv.getUint32(0, true); capture = dv.getFloat64(4, true); const payload = bytes.subarray(12); frame = new Float32Array(payload.length / 2); const pv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength); for (let i = 0; i < frame.length; i++) frame[i] = pv.getInt16(i * 2, true) / 32768; if (seq < this.seqExpected) return; if (seq > this.seqExpected) { const missing = Math.min(20, seq - this.seqExpected); for (let i = 0; i < missing; i++) this.processAudio(new Float32Array(512), capture - (missing - i) * 32); } this.seqExpected = seq + 1; const arrival = performance.now(); const sampleOffset = arrival - capture; if (!this.offsetInitialized || sampleOffset < this.captureOffset) { this.captureOffset = sampleOffset; this.offsetInitialized = true; } const mapped = capture + this.captureOffset; if (arrival - mapped > 3000) { this.metrics.dropped_late_frames = Number(this.metrics.dropped_late_frames ?? 0) + 1; return; } this.processAudio(frame, mapped); return; }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); frame = new Float32Array(Math.floor(bytes.length / 4)); for (let i = 0; i < frame.length; i++) frame[i] = dv.getFloat32(i * 4, true); this.processAudio(frame, capture);
  }
  private processAudio(frame: Float32Array, now: number) { const prior = this.tm.state; let speech = false; if (prior === "idle") { this.preRoll.push(...frame); if (this.preRoll.length > config.sampleRate * config.prerollMs / 1000) this.preRoll.splice(0, this.preRoll.length - config.sampleRate * config.prerollMs / 1000); speech = this.vad.detect(frame); if (speech) this.lastVoiceAt = now; for (const c of this.tm.frame(speech, now)) this.command(c); if (this.tm.state === "user_speaking") { this.speechOrigin = this.lastVoiceAt; this.samples = this.preRoll.slice(); } } else if (prior === "user_speaking" || prior === "maybe_done") { this.samples.push(...frame); speech = this.vad.detect(frame); if (speech) this.lastVoiceAt = now; else if (prior === "user_speaking") this.speechOrigin = this.lastVoiceAt; for (const c of this.tm.frame(speech, now)) this.command(c); } else { this.micEnvelope.push(...rmsEnvelope(frame, config.sampleRate)); if (this.micEnvelope.length > 100) this.micEnvelope.splice(0, this.micEnvelope.length - 100); this.tm.setEcho(selfVoiceVerdict(this.micEnvelope, this.refEnvelope, this.echoThreshold) === "echo"); speech = this.vad.detect(frame); if (speech) this.lastVoiceAt = now; if (speech || this.tm.cutting) this.cutInSamples.push(...frame); for (const c of this.tm.frame(speech, now)) this.command(c); if (!this.tm.cutting && this.tm.state !== "user_speaking") this.cutInSamples = []; if (this.tm.state === "user_speaking") { this.speechOrigin = this.lastVoiceAt; this.samples = this.cutInSamples.slice(); this.cutInSamples = []; } } const max = config.sampleRate * 30; if (this.samples.length > max) this.samples.splice(0, this.samples.length - max); }
  message(data: string) { try { const j = JSON.parse(data); if (j.t === "hello") { this.proto = j.proto === 2 ? 2 : 1; this.seqExpected = 0; } if (j.t === "config") { this.tm.configure(j.values ?? {}); if (Number.isFinite(j.values?.echoThreshold)) this.echoThreshold = j.values.echoThreshold; if (typeof j.values?.earlyStart === "boolean") this.earlyStart = j.values.earlyStart; if (Number.isFinite(j.values?.toolDelayMs)) this.toolDelayMs = j.values.toolDelayMs; if (j.values?.netSim) this.netSim = j.values.netSim; } if (j.t === "ping") this.send({ t: "pong", at: j.at }); if (j.t === "stop") for (const c of this.tm.stop()) this.command(c); if (j.t === "played_end") { for (let i = 0; i < this.chunkDurations.length; i++) this.playedMs[i] = this.chunkDurations[i]; this.updatePlayedReference(); for (const c of this.tm.playbackEnded()) this.command(c); this.finishMetrics(); } if (j.t === "played" && Number.isInteger(j.chunk) && Number.isFinite(j.ms)) { this.playedMs[j.chunk] = Math.min(this.chunkDurations[j.chunk] ?? j.ms, j.ms); this.updatePlayedReference(); if (!this.heardAudio) { this.heardAudio = true; this.metrics.t_first_audio_played = this.metricNow(); if (this.toolPendingAudio) { this.metrics.t_first_audio_after_tool = this.metricNow(); this.toolPendingAudio = false; } for (const c of this.tm.firstAudioPlayed()) this.command(c); } } } catch {} }
}
