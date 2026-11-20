import { config } from "./config";
import { FrameVad } from "./vad";
import { TurnManager } from "./turnManager";
import { History } from "./history";
import { buildPrompt, datedUser } from "./prompt";
import { encodeWav, StreamingWavReader } from "./wav";
import { chat, transcribe, turnCheck, speech, prewarmChat, prewarmVoice, supportedStyles, voicePrepared, moodVoice } from "./stack";
import { Chunker } from "./chunker";
import { TagStream, forEngine, splitTags } from "./tags";
import { pickSound, availableTags } from "./sounds";
import { shouldNod } from "./listenerNod";
import { StreamingAsr, norm } from "./streamingAsr";
import { voiceSettings } from "./voiceSettings";
import { judgeCutIn } from "./selfEcho";
import { decideYield } from "./yieldDecision";
import { appendMetrics, type TurnMetrics } from "./metrics";
import { rmsEnvelope, selfVoiceVerdict } from "./echo";
import { decideBackchannel } from "./backchannel";
import { LinkModel } from "./netSim";
import { runTool, toolDefinitions } from "./tools";
import { fileURLToPath } from "node:url";
import { commitDelay } from "./commitDelay";
const supported = ["laugh", "chuckle", "cough", "sigh", "clear throat", "gasp"];
const metricsPath = fileURLToPath(new URL("../results/turns.jsonl", import.meta.url));
const cutinsPath = fileURLToPath(new URL("../results/cutins.jsonl", import.meta.url));
export class VoiceSession {
  private vad = new FrameVad(); private tm: TurnManager; private history = new History(buildPrompt());
  private samples: number[] = []; private preRoll: number[] = []; private cutInSamples: number[] = []; private transcriptSegments: string[] = [];
  private micEnvelope: number[] = []; private refEnvelope: number[] = []; private chunkRefEnvelopes: number[][] = []; private chunkRefWindows: number[][] = [];
  private turn = 1; private abort: AbortController | null = null; private held = false; private heldFrames: Uint8Array[] = [];
  private heldChunkEvents: Array<{ t: string; turn: number; chunk: number; text: string }> = []; private heldFinalText = "";
  private chunks: string[] = []; private chunkDurations: number[] = []; private playedMs: number[] = []; private generatedText = ""; private generatedComplete = false;
  private metricsWritten = false; private metrics: TurnMetrics = {}; private heardAudio = false; private echoThreshold = config.echoThreshold;
  private lastVoiceAt = performance.now(); private speechOrigin = performance.now(); private earlyStart = config.earlyStart;
  private closed = false;
  private checkControllers = new Map<number, AbortController>();
  private committedSamples: number[] = [];
  private committedSegments: string[] = [];
  private committedAt = -Infinity;
  private draftMessages: any[] = [];
  private toolInFlight = false;
  private draftInterrupted = false;
  private resumingCommitted = false;
  private draftStartedAt = -1;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private now: () => number;
  private transcribeFn: typeof transcribe;
  private turnCheckFn: typeof turnCheck;
  private chatFn: typeof chat;
  private speechFn: typeof speech;
  private streamAsr: StreamingAsr | null = null; private streamEnabled = Bun.env.LAB_STREAM_DRAFT === "1"; private streamDraft = ""; private streamDraftEarlyMs = 64;
  private echoRef = false; private overlapMs = 0; private lastOverlapAt = -1e9;
  private nodEnabled = false; private nodClip: Int16Array | null = null; private lastNodAt = -1e9; private nodsThisTurn = 0; private nodSuppressUntil = 0; private nodRoll: () => number = Math.random;
  private soundFn: typeof pickSound; private speechRms = 0.06;
  private runToolFn: typeof runTool;
  private metricsFn: typeof appendMetrics;
  private vadDetector: { detect(frame: Float32Array): boolean };
  private injected = false; private voice = Bun.env.LAB_DEFAULT_VOICE ?? "casual"; private useStyles = true; private replyStyle = "";
  private stylesFn: typeof supportedStyles;
  private voicePreparedFn: typeof voicePrepared;
  private voiceChecked = new Set<string>();
  private styleFor(piece: string): string { if (!this.useStyles) return ""; const m = /\[(whisper|shout|angry|excited|happy|sad|sarcastic)\]/i.exec(piece); if (m) this.replyStyle = m[1]!.toLowerCase(); return this.replyStyle; }
  private warming: AbortController | null = null; private lastWarmAt = 0;
  private prewarmChatFn: typeof prewarmChat;
  private prewarmVoiceFn: typeof prewarmVoice;
  /** Always prewarm: when a session opens, when the voice changes, after every reply, and again if the session has sat idle.
   * A real turn cancels a warm-up that is still running, so warming never delays an answer. */
  private prewarm(what: "all" | "chat" | "voice" = "all") {
    this.warming?.abort(); const controller = new AbortController(); this.warming = controller; this.lastWarmAt = this.now();
    const jobs: Promise<unknown>[] = [];
    if (what !== "voice") jobs.push(this.prewarmChatFn(this.history.messages.at(-1)?.role === "user" ? [...this.history.messages] : [...this.history.messages, { role: "user", content: "Hello." }], toolDefinitions, controller.signal).then((ms) => this.send({ t: "warm", part: "chat", ms: Math.round(ms) })));
    if (what !== "chat") jobs.push(this.prewarmVoiceFn(this.voice, controller.signal).then((ms) => this.send({ t: "warm", part: "voice", ms: Math.round(ms) })));
    void Promise.allSettled(jobs).then(() => { if (this.warming === controller) this.warming = null; });
  }
  /** The engine keeps the conversation it just wrote, so no warm-up is needed right after a reply. Warm again only after a long quiet spell. */
  private rewarmIfStale() { if (this.now() - this.lastWarmAt > 10 * 60_000 && !this.warming) this.prewarm("all"); }
  private proto = 1; private seqExpected = 0; private netSim = { delayMs: 0, jitterMs: 0, lossPercent: 0, burstEveryMs: 0, burstStallMs: 0 }; private inboundLink: LinkModel; private outboundLink: LinkModel; private toolPendingAudio = false; private captureOffset = 0; private offsetInitialized = false; private toolDelayMs = 2500;
  constructor(private ws: { readyState: number; send(data: string | Uint8Array): void }, private secret = "", deps: Partial<{ transcribe: typeof transcribe; turnCheck: typeof turnCheck; chat: typeof chat; speech: typeof speech; sound: typeof pickSound; streamAsr: StreamingAsr; runTool: typeof runTool; appendMetrics: typeof appendMetrics; prewarmChat: typeof prewarmChat; prewarmVoice: typeof prewarmVoice; supportedStyles: typeof supportedStyles; voicePrepared: typeof voicePrepared; now: () => number; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; vad: { detect(frame: Float32Array): boolean }; random: () => number }> = {}) {
    this.now = deps.now ?? (() => performance.now()); this.tm = new TurnManager(this.now); this.inboundLink = new LinkModel(deps.random); this.outboundLink = new LinkModel(deps.random); this.speechOrigin = this.now(); this.lastVoiceAt = this.now();
    this.transcribeFn = deps.transcribe ?? transcribe; this.turnCheckFn = deps.turnCheck ?? turnCheck; this.chatFn = deps.chat ?? chat; this.speechFn = deps.speech ?? speech; this.soundFn = deps.sound ?? pickSound; if (deps.streamAsr) this.streamAsr = deps.streamAsr; this.runToolFn = deps.runTool ?? runTool; this.vadDetector = deps.vad ?? this.vad;
    this.metricsFn = deps.appendMetrics ?? appendMetrics;
    this.prewarmChatFn = deps.prewarmChat ?? prewarmChat; this.prewarmVoiceFn = deps.prewarmVoice ?? prewarmVoice;
    this.injected = !!deps.speech; this.stylesFn = deps.supportedStyles ?? supportedStyles; this.voicePreparedFn = deps.voicePrepared ?? voicePrepared;
    this.timerSet = deps.setTimeout ?? setTimeout; this.timerClear = deps.clearTimeout ?? clearTimeout;
    this.send({ t: "state", state: "idle", vad: this.vad.mode });
  }
  private timerSet: typeof setTimeout = setTimeout;
  private timerClear: typeof clearTimeout = clearTimeout;
  private schedule(fn: () => void, ms: number) { let timer: ReturnType<typeof setTimeout>; timer = this.timerSet(() => { this.timers.delete(timer); if (!this.closed) fn(); }, ms); this.timers.add(timer); return timer; }
  private send(v: unknown) { if (!this.closed && this.ws.readyState === 1) { const value = v && typeof v === "object" ? { ...(v as Record<string, unknown>), turn: (v as Record<string, unknown>).turn ?? this.turn } : v; const data = JSON.stringify(value); this.delayOutgoing(() => { if (!this.closed && this.ws.readyState === 1) this.ws.send(data); }, true); } }
  private delayOutgoing(fn: () => void, control = false, value: unknown = undefined) { const generation = this.turn; const now = this.now(); const delivery = this.outboundLink.schedule(value, now, this.netSim, control); if (delivery.dropped) return; this.schedule(() => { if (generation === this.turn) fn(); }, Math.max(0, delivery.deliverAt - now)); }
  private sendFrame(frame: Uint8Array) { if (this.held) this.heldFrames.push(frame); else { if (this.metrics.t_first_frame_sent === undefined) this.metrics.t_first_frame_sent = this.metricNow(); const generation = this.turn; this.delayOutgoing(() => { if (generation === this.turn && this.ws.readyState === 1) this.ws.send(frame); }, false, frame); } }
  private metricNow() { return Math.max(0, this.now() - this.speechOrigin); }
  private updatePlayedReference() { const all: number[] = []; for (let i = 0; i < this.chunkRefEnvelopes.length; i++) all.push(...this.chunkRefEnvelopes[i].slice(0, Math.floor((this.playedMs[i] ?? 0) / 10))); this.refEnvelope = all.slice(-100); }
  /** The listener's "mm-hm", made by the voice engine in the cloned voice (never typed by a model), kept ready like the rest of the prewarm. */
  private async makeNod() {
    if (this.nodClip) return;
    try { const r = await this.speechFn("Mm-hm.", undefined, { voice: this.voice }); if (!r.body) return; const reader = r.body.getReader(), w = new StreamingWavReader(); const parts: Int16Array[] = [];
      while (true) { const x = await reader.read(); if (x.done) break; const pcm = w.push(x.value); if (pcm.length) parts.push(pcm); }
      const all = new Int16Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { all.set(p, at); at += p.length; }
      let sum = 0; for (const v of all) sum += (v / 32768) ** 2; const rms = Math.sqrt(sum / Math.max(1, all.length)) || 1; const gain = Math.min(4, 0.035 / rms); // quiet: about -29 dBFS rms
      for (let i = 0; i < all.length; i++) all[i] = Math.max(-32768, Math.min(32767, Math.round(all[i]! * gain)));
      if (all.length > 24000 * 0.15 && all.length < 24000 * 1.6) this.nodClip = all;
    } catch {}
  }
  /** The person has gone quiet for a moment: start the reply draft from what the streaming recognizer already has, before the whole-utterance pass finishes. */
  private maybeEarlyDraft(now: number) {
    if (!this.streamEnabled || !this.streamAsr || this.held || this.streamDraft || this.tm.state !== "user_speaking") return;
    if (this.tm.silenceMs(now) < this.streamDraftEarlyMs || this.streamAsr.fed !== this.samples.length) return;
    const text = this.streamAsr.text(); if (norm(text).split(" ").filter(Boolean).length < 2) return;
    this.metrics = { early_start: "used", draft: "used", failure: "none", ok: false, stream_draft: "started" }; this.metricsWritten = false; this.metrics.t_check = this.metricNow();
    this.streamDraft = norm(text); this.command({ type: "start_reply_held", transcript: text, at: now, stream: true });
  }
  private maybeNod(now: number) {
    if (!this.nodEnabled || !this.nodClip || this.tm.state !== "maybe_done") return;
    if (!shouldNod({ enabled: true, turnSpeechMs: now - this.speechOrigin, silenceMs: this.tm.silenceMs(now), turnProbability: this.tm.turnProbability, sinceLastNodMs: now - this.lastNodAt, nodsThisTurn: this.nodsThisTurn, roll: this.nodRoll() })) return;
    this.lastNodAt = now; this.nodsThisTurn++; this.nodSuppressUntil = now + this.nodClip.length / 24 + 350;
    this.send({ t: "nod", pcm: Buffer.from(this.nodClip.buffer, this.nodClip.byteOffset, this.nodClip.byteLength).toString("base64"), rate: 24000 });
  }
  private finishMetrics() { if (this.metricsWritten || !Object.keys(this.metrics).length) return; this.metricsWritten = true; this.metrics.chunks = this.chunks.length; this.metricsFn(metricsPath, this.metrics); this.send({ t: "timing", ...this.metrics }); }
  private command(c: { type: string; [key: string]: unknown }) {
    switch (c.type) {
      case "state": this.send({ t: "state", state: c.state }); break;
      case "check_turn": void this.check(Number(c.revision ?? this.tm.checkRevision)); break;
      case "transcript_ready": for (const next of this.tm.transcriptReady(String(c.text), this.now(), Number(c.revision ?? this.tm.checkRevision))) this.command(next); break;
      case "start_reply_held":
        if (this.held && this.streamDraft) {
          // A draft was started from the streaming text. The whole-utterance text decides: same words keep it, different words discard it.
          if (norm(String(c.transcript)) === this.streamDraft) { this.metrics.stream_draft = "kept"; this.streamDraft = "kept"; break; }
          const had = this.streamDraft; this.command({ type: "cancel_held" }); this.metrics.stream_draft = "replaced"; void had;
        }
        this.held = true; this.draftStartedAt = this.now(); this.metrics.early_start = "used"; this.metrics.draft = "used"; void this.reply(String(c.transcript), false); break;
      case "transcribe_cut_in": if (c.forced) { this.writeCutin(false); this.samples = this.cutInSamples.slice(); this.cutInSamples = []; this.send({ t: "stop", turn: this.turn }); this.send({ t: "state", state: "user_speaking" }); } else void this.finishCutIn(); break;
      case "backchannel": this.send({ t: "resume" }); this.writeCutin(true); this.cutInSamples = []; this.samples = []; break;
      case "pause": this.send({ t: "pause" }); break;
      case "commit":
        if (this.streamDraft === "kept") this.metrics.stream_draft = "kept";
        this.streamDraft = "";
        this.metrics.t_commit = this.metricNow(); this.metrics.commit_reason = c.reason as "model" | "timeout";
        if (this.draftStartedAt >= 0) this.metrics.draft_head_start_ms = Math.max(0, this.now() - this.draftStartedAt);
        if (this.resumingCommitted) {
          const last = this.history.messages.at(-1);
          if (last?.role === "user") last.content = datedUser(String(c.transcript));
          this.resumingCommitted = false;
        } else this.history.commitUser(datedUser(String(c.transcript)));
        this.committedSamples = this.samples.slice(); this.committedSegments = this.transcriptSegments.slice(); this.committedAt = this.now(); this.samples = [];
        if (this.held) { this.history.messages.push(...this.draftMessages); this.draftMessages = []; this.draftInterrupted = false; this.send({ t: "final", text: String(c.transcript), turn: this.turn }); this.held = false; for (const event of this.heldChunkEvents) this.send(event); this.heldChunkEvents = []; for (const f of this.heldFrames) this.ws.send(f); this.heldFrames = []; if (this.generatedComplete && this.heldFinalText) { this.history.commitAssistant(this.heldFinalText); this.send({ t: "reply_final", text: this.heldFinalText, turn: this.turn }); this.heldFinalText = ""; } }
        else { void this.reply(String(c.transcript), true); this.send({ t: "final", text: String(c.transcript), turn: this.turn }); }
        this.send({ t: "state", state: "thinking" }); break;
      case "cancel_held": { const wasHeld = this.held; this.streamDraft = ""; this.metrics.early_start = "discarded"; this.metrics.draft = "discarded"; this.metrics.ok = false; this.metrics.failure = "cancelled"; for (const check of this.checkControllers.values()) check.abort(); this.checkControllers.clear(); this.abort?.abort(); this.held = false; this.heldFrames = []; this.heldChunkEvents = []; this.heldFinalText = ""; this.generatedText = ""; this.finishMetrics(); if (!wasHeld) this.send({ t: "stop", turn: this.turn }); this.send({ t: "state", state: "user_speaking" }); }
        break;
      case "resume_committed":
        for (const check of this.checkControllers.values()) check.abort(); this.checkControllers.clear();
        this.abort?.abort(); this.held = false; this.heldFrames = []; this.heldChunkEvents = []; this.heldFinalText = ""; this.generatedText = "";
        this.samples = this.committedSamples.slice(); this.transcriptSegments = this.committedSegments.slice(); this.resumingCommitted = true;
        this.send({ t: "stop", turn: this.turn }); this.send({ t: "state", state: "user_speaking" }); break;
      case "interrupt": this.abort?.abort(); this.metrics.ok = false; this.metrics.failure = "cancelled"; if (this.held) { if (this.toolInFlight) this.draftInterrupted = true; else { this.history.messages.push(...this.draftMessages); this.draftMessages = []; if (this.generatedText) this.history.commitAssistant(`${this.generatedText} [answer was not spoken]`); } } else if (this.generatedText) { this.history.commitAssistant(this.generatedText); this.history.trimAssistantToHeard(this.chunks, this.playedMs, this.chunkDurations); this.generatedText = ""; this.metrics.t_stop_sent = this.metricNow(); } this.finishMetrics(); this.send({ t: "stop", turn: this.turn }); this.heldFrames = []; this.held = false; this.send({ t: "state", state: c.tap ? "idle" : "user_speaking" }); break;
      case "duck": this.metrics.t_duck = this.metricNow(); this.send({ t: "duck" }); break;
      case "resume": this.send({ t: "resume" }); break;
      case "discard": this.samples = []; break;
    }
  }
  private writeCutin(backchannel: boolean) { this.metricsFn(cutinsPath, { backchannel, duration_ms: this.tm.cutDuration, t_local_duck: this.metrics.t_local_duck } as TurnMetrics); }
  /** Everything she has said in this reply: her own voice coming back through the microphone is recognised as these words. */
  /** The phrase being played right now and its neighbours: the only words her own voice can be bringing back through the microphone at this moment. */
  /** How loud the microphone has been, on average, while she speaks: her echo's level. A person talking over her is clearly louder than that. */
  private echoRms = 0;
  private trackEcho(frame: Float32Array) { let sum = 0; for (const v of frame) sum += v * v; const r = Math.sqrt(sum / Math.max(1, frame.length)); this.echoRms = this.echoRms === 0 ? r : this.echoRms * 0.994 + r * 0.006; }
  private cutInLouder(audio: Float32Array) { let sum = 0; for (const v of audio) sum += v * v; const r = Math.sqrt(sum / Math.max(1, audio.length)); return this.echoRms > 0.0005 && r > this.echoRms * 1.6; }
  private playingNowText() { let last = -1; for (let i = 0; i < this.chunks.length; i++) if ((this.playedMs[i] ?? 0) > 0) last = i; if (last < 0) last = 0; return this.chunks.slice(Math.max(0, last - 1), last + 2).join(" "); }
  private recentSpoken() { return this.chunks.join(" "); }
  private async finishCutIn() {
    const audio = Float32Array.from(this.cutInSamples);
    let text = ""; try { text = await this.transcribeFn(encodeWav(audio), this.abort?.signal); } catch {}
    // Reference-based mode: the device says whether a person overlaps her; words only help. Otherwise the text-only judgement against her own words.
    const decision = this.echoRef ? (decideYield({ overlapMs: this.now() - this.lastOverlapAt < 500 ? this.overlapMs : 0, words: text, heardAnything: text.length > 0 }) === "yield" ? "interrupt" : "echo") : judgeCutIn(text, this.recentSpoken(), this.tm.echoLikely, this.playingNowText(), this.cutInLouder(audio));
    if (Bun.env.LAB_DEBUG_TEXT) console.log(`cut-in heard: ${JSON.stringify(text)} decision=${decision} seconds=${(audio.length / 16000).toFixed(2)} louder=${this.cutInLouder(audio)} echoRms=${this.echoRms.toFixed(4)}`);
    for (const command of this.tm.cutTranscript(text, decision)) this.command(command);
    if (decision === "interrupt") { this.cutInSamples = []; this.writeCutin(false); this.samples = [...audio]; this.speechOrigin = this.now(); this.abort?.abort(); if (this.generatedText) { this.history.commitAssistant(this.generatedText); this.history.trimAssistantToHeard(this.chunks, this.playedMs, this.chunkDurations); this.generatedText = ""; } this.send({ t: "stop", turn: this.turn }); this.send({ t: "state", state: "user_speaking" }); }
  }
  private async check(revision: number) {
    if (revision !== this.tm.checkRevision) return;
    const controller = new AbortController(); this.checkControllers.set(revision, controller);
    this.metrics = { early_start: this.earlyStart ? "used" : "off", draft: "off", failure: "none", ok: false };
    this.metricsWritten = false;
    this.draftStartedAt = -1;
    this.metrics.t_check = this.metricNow();
    const segmentLimit = config.sampleRate * 20;
    if (this.samples.length > segmentLimit) {
      const segment = this.samples.splice(0, config.sampleRate * 18);
      try { const partial = await this.transcribeFn(encodeWav(Float32Array.from(segment)), controller.signal); if (revision === this.tm.checkRevision && !controller.signal.aborted && partial) this.transcriptSegments.push(partial); } catch {}
    }
    const all = Float32Array.from(this.samples);
    const turnAudio = Float32Array.from(all.slice(-config.sampleRate * 8));
    const valid = () => revision === this.tm.checkRevision && !controller.signal.aborted && !this.closed;
    const textTask = this.transcribeFn(encodeWav(all), controller.signal).then((text) => {
      if (!valid()) return;
      const combined = [...this.transcriptSegments, text].filter(Boolean).join(" ").trim();
      this.send({ t: "partial", text: combined }); this.metrics.t_transcript = this.metricNow();
      this.command({ type: "transcript_ready", text: combined, revision });
    }).catch(() => {});
    const modelTask = this.turnCheckFn(encodeWav(turnAudio), controller.signal).then((model) => {
      if (!valid()) return;
      this.metrics.t_turn_model = this.metricNow();
      for (const c of this.tm.turnModel(model.probability, model.complete, revision)) this.command(c);
    }).catch(() => {});
    await Promise.allSettled([textTask, modelTask]);
    if (this.checkControllers.get(revision) === controller) this.checkControllers.delete(revision);
  }
  private async reply(text: string, committed: boolean) {
    if (!text.trim()) return;
    if (!Object.keys(this.metrics).length || this.metricsWritten) { this.metrics = { failure: "none", draft: "off", ok: false }; this.metricsWritten = false; }
    this.abort = new AbortController(); const signal = this.abort.signal; this.chunks = []; this.chunkDurations = []; this.playedMs = []; this.generatedText = ""; this.generatedComplete = false; this.heldFrames = []; this.heldChunkEvents = []; this.heldFinalText = ""; this.micEnvelope = []; this.refEnvelope = []; this.chunkRefEnvelopes = []; this.chunkRefWindows = []; this.heardAudio = false; this.turn++;
    const requestMessages: any[] = committed ? [...this.history.messages] : [...this.history.messages, { role: "user", content: datedUser(text) }];
    this.draftMessages = []; this.draftInterrupted = false;
    this.replyStyle = ""; this.warming?.abort(); this.warming = null;
    const chunker = new Chunker(), tagger = new TagStream(); let full = "", rounds = 0, toolTextLength = 0, headerGate: Promise<void> = Promise.resolve(), sendQueue: Promise<void> = Promise.resolve();
    const schedule = (piece: string) => { const index = this.chunks.length; this.chunks.push(piece); this.chunkDurations[index] = 0; this.playedMs[index] = 0; this.chunkRefEnvelopes[index] = []; this.chunkRefWindows[index] = []; if (this.metrics.t_first_phrase_ready === undefined) this.metrics.t_first_phrase_ready = this.metricNow(); const event = { t: "chunk", turn: this.turn, chunk: index, text: piece }; if (this.held) this.heldChunkEvents.push(event); else this.send(event); const ready = headerGate.then(async () => { if (!this.voiceChecked.has(this.voice)) { this.voiceChecked.add(this.voice); if (!await this.voicePreparedFn(this.voice)) { this.voice = "builtin"; this.send({ t: "notice", code: "voice_not_ready" }); } } const requestedStyle = this.styleFor(piece); const allowed = requestedStyle ? await this.stylesFn(this.voice) : new Set<string>(); const mood = requestedStyle && !this.injected ? await moodVoice(this.voice, requestedStyle, voiceSettings(this.voice).moodStrength) : this.voice; if (mood !== this.voice) return { voice: mood, style: "" }; return { voice: this.voice, style: allowed.has(requestedStyle) ? requestedStyle : "" }; }); headerGate = ready.then(() => {}, () => {}); sendQueue = sendQueue.then(() => this.say(piece, index, signal, ready)).catch(() => {}); };
    const speakText = async (delta: string) => { full += delta; this.generatedText = full; const clean = tagger.push(delta); for (const piece of chunker.push(clean)) schedule(piece); };
    try {
      while (rounds <= 2) {
        let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
        for await (const event of this.chatFn(requestMessages, signal, undefined, toolDefinitions, rounds === 0 ? "auto" : "none")) {
          if (signal.aborted || this.closed) break;
          if (!this.metrics.t_llm_first_token) this.metrics.t_llm_first_token = this.metricNow();
          if (event.type === "text") await speakText(event.text); else toolCalls = event.calls;
        }
        if (signal.aborted || this.closed) return;
        if (!toolCalls.length || rounds >= 2) break;
        for (const piece of chunker.push(tagger.flush())) schedule(piece); for (const piece of chunker.flush()) schedule(piece); // say the line before the tool runs
        rounds++; this.metrics.tool_rounds = rounds;
        const assistantWords = full.slice(toolTextLength); toolTextLength = full.length;
        const requested = toolCalls.slice(0, 3);
        const messagesForCall = requested.map((x) => ({ id: x.id, type: "function", function: { name: x.name, arguments: JSON.stringify(x.arguments) } }));
        this.metrics.t_tool_start = this.metricNow();
        const toolResults: Array<{ id: string; content: string }> = [];
        for (const call of requested) {
          this.send({ t: "tool_start", name: call.name });
          let result: string;
          this.toolInFlight = true;
          try { result = await this.runToolFn({ name: call.name, arguments: call.arguments }, this.toolDelayMs); }
          catch { result = "The tool failed."; }
          this.toolInFlight = false;
          toolResults.push({ id: call.id, content: result });
        }
        this.metrics.t_tool_end = this.metricNow(); this.toolPendingAudio = true;
        for (const call of requested) this.send({ t: "tool_end", name: call.name, ms: this.metrics.t_tool_end - this.metrics.t_tool_start });
        const exchange = [{ role: "assistant", content: assistantWords || null, tool_calls: messagesForCall }, ...toolResults.map((tool) => ({ role: "tool", tool_call_id: tool.id, content: tool.content }))];
        if (this.held || this.draftInterrupted) this.draftMessages.push(...exchange); else this.history.messages.push(...exchange);
        requestMessages.push(...exchange);
        if (this.draftInterrupted) { this.history.messages.push(...this.draftMessages); this.draftMessages = []; this.history.commitAssistant("[answer was not spoken]"); this.draftInterrupted = false; return; }
        if (signal.aborted || this.closed) return;
      }
      for (const piece of chunker.push(tagger.flush())) schedule(piece); for (const piece of chunker.flush()) schedule(piece); await sendQueue;
      if (signal.aborted || this.closed) return;
      this.generatedText = full; this.generatedComplete = true;
      if (!this.chunkDurations.some((duration) => duration > 0)) { this.metrics.ok = false; if (this.metrics.failure === "none") this.metrics.failure = "no_audio"; }
      else { this.metrics.ok = true; this.metrics.failure = "none"; }
      if (!this.held) this.send({ t: "reply_final", text: full, turn: this.turn }); else this.heldFinalText = full;
      if (full && !this.held) this.history.commitAssistant(full);
      if (this.metrics.failure === "no_audio") this.finishMetrics();
    } catch (error) { if (!signal.aborted) { this.metrics.ok = false; this.metrics.failure = "reply_failed"; this.send({ t: "error", code: "reply_failed" }); this.finishMetrics(); } }
  }
  private async say(text: string, index: number, signal: AbortSignal, voiceAndStyle: Promise<{ voice: string; style: string }>) {
    const choice = await voiceAndStyle;
    // Audio is forwarded the moment each piece arrives. Holding a whole phrase to check it first cost about half a second of first sound.
    const emit = (pcm: Int16Array) => {
      this.chunkDurations[index] += pcm.length * 1000 / config.replyRate;
      for (const value of pcm) { const win = this.chunkRefWindows[index]; win.push(value / 32768); if (win.length === 240) { this.chunkRefEnvelopes[index].push(Math.sqrt(win.reduce((sum, sample) => sum + sample * sample, 0) / 240)); win.length = 0; } }
      const frame = new Uint8Array(8 + pcm.length * 2), v = new DataView(frame.buffer); v.setUint32(0, this.turn, true); v.setUint16(4, index, true); for (let i = 0; i < pcm.length; i++) v.setInt16(8 + i * 2, pcm[i], true); this.sendFrame(frame);
    };
    let sent = 0;
    const synth = async (style: string, part: string) => {
      const response = await this.speechFn(forEngine(part, supported), signal, { voice: choice.voice, style });
      if (!response.body) throw new Error("empty voice response");
      const reader = response.body.getReader(), wavReader = new StreamingWavReader();
      while (true) {
        const piece = await reader.read(); if (piece.done) break;
        const pcm = wavReader.push(piece.value); if (!pcm.length) continue;
        if (signal.aborted || this.closed) return;
        if (this.metrics.t_voice_first_audio === undefined) this.metrics.t_voice_first_audio = this.metricNow();
        let sum = 0; for (const v of pcm) sum += (v / 32768) ** 2; this.speechRms = this.speechRms * 0.7 + Math.sqrt(sum / pcm.length) * 0.3;
        sent += pcm.length; emit(pcm);
      }
      if (!sent) throw new Error("voice response contained no audio");
    };
    const fail = () => { this.metrics.ok = false; this.metrics.failure = "voice_failed"; this.send({ t: "error", code: "voice_failed" }); this.abort?.abort(); this.finishMetrics(); };
    // The phrase is cut at its sound tags: words go to the voice, each tag becomes a real recorded sound from the same speaker (or nothing).
    for (const seg of splitTags(text)) {
      if (signal.aborted || this.closed) return;
      if (seg.type === "tag") {
        const sound = this.soundFn(choice.voice, seg.value, this.speechRms);
        if (sound) { if (this.metrics.t_voice_first_audio === undefined) this.metrics.t_voice_first_audio = this.metricNow(); this.metrics.sounds = (this.metrics.sounds ?? 0) + 1; for (let i = 0; i < sound.length; i += 15360) emit(sound.subarray(i, i + 15360)); }
        continue;
      }
      // A piece with no words has nothing for this voice to say; the engine refuses it, which used to fail the whole reply.
      if (!/[\p{L}\p{N}]/u.test(seg.value)) continue;
      const before = sent;
      try { await synth(choice.style, seg.value); }
      catch {
        if (signal.aborted || this.closed) return;
        // A retry is only safe when nothing of this piece has been heard yet.
        if (sent !== before) { fail(); return; }
        try { await synth("", seg.value); } catch { if (signal.aborted || this.closed) return; fail(); return; }
      }
    }
    if (signal.aborted || this.closed) return;
    const tail = new Uint8Array(488), tv = new DataView(tail.buffer); tv.setUint32(0, this.turn, true); tv.setUint16(4, index, true); tv.setUint16(6, 1, true); this.sendFrame(tail);
  }
  audio(bytes: Uint8Array) {
    if (this.netSim.delayMs || this.netSim.jitterMs || this.netSim.lossPercent || this.netSim.burstEveryMs) {
      const now = this.now(); const delivery = this.inboundLink.schedule(bytes, now, this.netSim, false);
      if (delivery.dropped) return;
      this.schedule(() => this.processAudioBytes(bytes, delivery.deliverAt), Math.max(0, delivery.deliverAt - now));
      return;
    }
    this.processAudioBytes(bytes, this.now());
  }
  private processAudioBytes(bytes: Uint8Array, deliveredAt: number) {
    let frame: Float32Array, capture = deliveredAt;
    if (this.proto === 2) { if (bytes.length < 12) return; const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const seq = dv.getUint32(0, true); capture = dv.getFloat64(4, true); const payload = bytes.subarray(12); frame = new Float32Array(payload.length / 2); const pv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength); for (let i = 0; i < frame.length; i++) frame[i] = pv.getInt16(i * 2, true) / 32768; if (seq < this.seqExpected) return; if (seq > this.seqExpected) { const missing = Math.min(20, seq - this.seqExpected); for (let i = 0; i < missing; i++) this.processAudio(new Float32Array(512), capture - (missing - i) * 32); } this.seqExpected = seq + 1; const arrival = this.now(); const sampleOffset = arrival - capture; if (!this.offsetInitialized || sampleOffset < this.captureOffset) { this.captureOffset = sampleOffset; this.offsetInitialized = true; } const mapped = capture + this.captureOffset; if (arrival - mapped > 3000) { this.metrics.dropped_late_frames = Number(this.metrics.dropped_late_frames ?? 0) + 1; return; } this.processAudio(frame, mapped); return; }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); frame = new Float32Array(Math.floor(bytes.length / 4)); for (let i = 0; i < frame.length; i++) frame[i] = dv.getFloat32(i * 4, true); this.processAudio(frame, capture);
  }
  private processAudio(frame: Float32Array, now: number) {
    const prior = this.tm.state;
    const priorPreRoll = this.preRoll.slice();
    const speech = this.vadDetector.detect(frame) && now >= this.nodSuppressUntil;
    if (speech) this.lastVoiceAt = now;
    if (prior === "idle") {
      for (const c of this.tm.frame(speech, now)) this.command(c);
      if (this.tm.state === "user_speaking") { if (this.streamEnabled) { this.streamAsr ??= new StreamingAsr(); this.streamAsr.reset(); this.streamAsr.accept(Float32Array.from([...priorPreRoll, ...frame])); } this.speechOrigin = this.lastVoiceAt; this.nodsThisTurn = 0; this.samples = [...priorPreRoll, ...frame]; this.transcriptSegments = []; }
    } else if (prior === "user_speaking" || prior === "maybe_done") {
      this.samples.push(...frame);
      if (this.streamEnabled && this.streamAsr) this.streamAsr.accept(frame);
      if (speech && this.streamDraft && this.tm.state === "user_speaking") this.command({ type: "cancel_held" });
      for (const c of this.tm.frame(speech, now)) this.command(c);
      this.maybeEarlyDraft(now);
      this.maybeNod(now);
    } else {
      this.trackEcho(frame);
      this.micEnvelope.push(...rmsEnvelope(frame, config.sampleRate));
      if (this.micEnvelope.length > 100) this.micEnvelope.splice(0, this.micEnvelope.length - 100);
      this.tm.setEcho(selfVoiceVerdict(this.micEnvelope, this.refEnvelope, this.echoThreshold) === "echo");
      const canResume = speech && !this.heardAudio && this.now() - this.committedAt <= 1500 && this.committedSamples.length > 0;
      if (canResume) {
        for (const c of this.tm.resumeCommittedSpeech()) this.command(c);
        this.samples.push(...frame);
      } else {
        const wasCutting = this.tm.cutting;
        if (speech && !wasCutting) this.cutInSamples = priorPreRoll.slice();
        if (speech || wasCutting) this.cutInSamples.push(...frame);
        for (const c of this.tm.frame(speech, now)) this.command(c);
        if (!this.tm.cutting && this.tm.state !== "user_speaking") this.cutInSamples = [];
        if (this.tm.state === "user_speaking" && this.cutInSamples.length) {
          this.speechOrigin = this.lastVoiceAt;
          this.samples = this.cutInSamples.slice();
          this.cutInSamples = [];
        }
      }
    }
    this.preRoll.push(...frame);
    const maxPreRoll = config.sampleRate * config.prerollMs / 1000;
    if (this.preRoll.length > maxPreRoll) this.preRoll.splice(0, this.preRoll.length - maxPreRoll);
  }
  close() { if (this.closed) return; this.closed = true; for (const timer of this.timers) this.timerClear(timer); this.timers.clear(); this.abort?.abort(); this.warming?.abort(); for (const check of this.checkControllers.values()) check.abort(); this.checkControllers.clear(); this.abort = null; this.warming = null; this.samples = []; this.preRoll = []; this.cutInSamples = []; this.transcriptSegments = []; this.committedSamples = []; this.committedSegments = []; this.heldFrames = []; this.heldChunkEvents = []; this.heldFinalText = ""; this.chunks = []; this.playedMs = []; this.chunkDurations = []; }
  message(data: string) {
    try {
      const j = JSON.parse(data);
      if (j.t === "hello") {
        this.proto = j.proto === 2 ? 2 : 1; this.seqExpected = 0;
        if (typeof j.voice === "string") this.voice = j.voice.slice(0, 64) || "builtin";
        this.prewarm("all");
      }
      if (j.t === "config") {
        this.tm.configure(j.values ?? {});
        if (Number.isFinite(j.values?.echoThreshold)) this.echoThreshold = j.values.echoThreshold;
        if (typeof j.values?.earlyStart === "boolean") this.earlyStart = j.values.earlyStart;
        if (typeof j.values?.voice === "string" && j.values.voice.slice(0, 64) !== this.voice) { this.voice = j.values.voice.slice(0, 64); this.voiceChecked.delete(this.voice); this.nodClip = null; if (this.nodEnabled) void this.makeNod(); this.history.messages[0]!.content = buildPrompt(availableTags(this.voice), voiceSettings(this.voice).stumble); this.prewarm("voice"); }
        if (typeof j.values?.echoReference === "boolean") this.echoRef = j.values.echoReference;
        if (typeof j.values?.streamingDraft === "boolean") this.streamEnabled = j.values.streamingDraft;
        if (typeof j.values?.backchannel === "boolean") { this.nodEnabled = j.values.backchannel; if (this.nodEnabled) void this.makeNod(); }
        if (typeof j.values?.useStyles === "boolean") this.useStyles = j.values.useStyles;
        if (Number.isFinite(j.values?.toolDelayMs)) this.toolDelayMs = j.values.toolDelayMs;
        if (j.values?.netSim) this.netSim = j.values.netSim;
      }
      if (j.t === "overlap" && Number.isFinite(j.ms)) { this.overlapMs = Math.max(0, Math.min(60000, j.ms)); this.lastOverlapAt = this.now(); }
      if (j.t === "local_stop" && this.echoRef && j.turn === this.turn) { this.metrics.t_local_stop = this.metricNow(); for (const c of this.tm.forceInterrupt()) this.command(c); }
      if (j.t === "ping") this.send({ t: "pong", at: j.at });
      if (["stop", "local_duck", "audio_scheduled", "played_end", "played"].includes(j.t) && j.turn !== this.turn) return;
      if (j.t === "stop") for (const c of this.tm.stop()) this.command(c);
      if (j.t === "local_duck") { this.metrics.t_local_duck = this.metricNow(); this.send({ t: "duck", turn: this.turn }); }
      if (j.t === "audio_scheduled" && Number.isFinite(j.contextTime) && Number.isFinite(j.contextNow)) {
        if (this.metrics.t_first_audio_scheduled === undefined) this.metrics.t_first_audio_scheduled = this.metricNow() + (j.contextTime - j.contextNow) * 1000;
        if (Number.isFinite(j.output_latency_ms)) this.metrics.output_latency_ms = j.output_latency_ms;
      }
      if (j.t === "played_end") { for (const c of this.tm.playbackEnded()) this.command(c); this.finishMetrics(); }
      if (j.t === "played" && Number.isInteger(j.chunk) && Number.isFinite(j.ms)) {
        this.playedMs[j.chunk] = Math.min(this.chunkDurations[j.chunk] ?? j.ms, Math.max(this.playedMs[j.chunk] ?? 0, j.ms));
        this.updatePlayedReference();
        if (!this.heardAudio) { this.heardAudio = true; this.metrics.t_first_audio_played = this.metricNow(); if (this.toolPendingAudio) { this.metrics.t_first_audio_after_tool = this.metricNow(); this.toolPendingAudio = false; } for (const c of this.tm.firstAudioPlayed()) this.command(c); }
      }
    } catch {}
  }
}
