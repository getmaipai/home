// Speaks a reply sentence by sentence as it streams in from the LLM,
// instead of waiting for the whole reply to finish generating (2026-09-04:
// "what Jesse actually meant by streamed" - spec/voice/README.md). Ported
// in spirit from home-legacy.git's frontend/src/lib/voice/voice-playback.ts
// + tts-playback-scheduler.ts (the org's "hard-won logic" reuse
// precedent): one AudioContext, sentences fetched with bounded
// parallelism (MAX_PARALLEL_FETCHES, matching the legacy hub's own
// MAX_PARALLEL_SENTENCE_FETCHES) but scheduled to PLAY strictly in the
// order they were enqueued even if a later sentence's fetch happens to
// finish first, and gapless back-to-back playback via a running
// `nextStartTime`, the same shape streamingWavPlayer.ts already uses for
// one call's byte chunks.
//
// Each sentence is buffered whole (not byte-streamed within itself) and
// decoded via the browser's native decodeAudioData - simpler than
// streamingWavPlayer.ts's hand-rolled Int16 conversion, and handles any
// real WAV shape correctly rather than only 16-bit PCM mono. Correct for
// this case: sentences are short, so the real latency win
// here comes from PIPELINING sentences (speaking sentence 1 while
// sentence 2 is still being fetched/generated), not from streaming
// within one. This is the same tradeoff the legacy hub's own backend
// made (one JSON payload per sentence, not streamed either).
import { ApiError, api } from "@/lib/api";
import { createLevelMeter, type LevelMeter } from "@/lib/voice/audioLevelMeter";
import { audioSession, type AudioHandle } from "@/shell/audioSession";
import { sharedPlaybackContext } from "@/lib/voice/playbackContext";

const MAX_PARALLEL_FETCHES = 2;

export interface SpeechSentenceMeta { turnId?: string; generation?: number; visibleEnd?: number; voice?: string }
interface ScheduledSentence { visibleEnd?: number; startTime: number; endTime: number; complete: boolean }
/** About how fast the voice speaks, used to guess a sentence's length while its audio is still arriving. */
const CHARS_PER_SECOND = 14;

/** Pocket TTS's real /tts response ships a bogus placeholder WAV header
 * size (~2,000,000,000 bytes, spec/voice/README.md) regardless of the
 * real, much shorter body. streamingWavPlayer.ts never reads the header's
 * declared size at all (it only cares about format fields); this scheduler
 * hands a COMPLETE buffer to the browser's own decodeAudioData instead,
 * whose real-world tolerance for a lying header size varies - rewriting
 * both size fields to the real byte count first removes the ambiguity
 * rather than hoping the decoder is lenient. */
function fixWavHeaderSize(bytes: Uint8Array): void {
  if (bytes.length < 44) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isRiffWave = view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645;
  if (!isRiffWave) return;
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(40, bytes.length - 44, true);
}

export class SentenceSpeechScheduler {
  private readonly audioContext: AudioContext;
  // The page-wide context (playbackContext.ts) outlives a reply: stop() silences this reply's own sources instead of closing it.
  private readonly sharedContext: boolean;
  private readonly sources = new Set<AudioBufferSourceNode>();
  // VOICE-LIVE-02: every scheduled sentence routes through this one gain
  // node (never straight to `destination`) so `audioLevelMeter.ts`'s own
  // meter can tap ONE stable node across sentence boundaries - a plain
  // pass-through (gain 1), not a volume control; the same meter shape
  // mic-capture.ts's own stream already uses.
  private readonly playbackBus: GainNode;
  private readonly meter: LevelMeter;
  private nextStartTime = 0;
  private scheduledCount = 0;
  private finishedCount = 0;
  private streamDone = false;
  private stopped = false;
  private paused = false;
  private activeFetches = 0;
  private readonly waiters: Array<() => void> = [];
  private dispatchTail: Promise<void> = Promise.resolve();
  private readonly abortController = new AbortController();
  private readonly speechStream: typeof api.streamSpeech;
  /** One entry per sentence, however many small buffers its audio arrives in: `endTime` grows with each buffer and `complete` is set once the last one is scheduled. */
  private readonly scheduledSentences: ScheduledSentence[] = [];
  private heardEndAtStop?: number;
  /** The thread message this reply voices, set by whoever starts the turn, so a screen can tell which message the voice belongs to. */
  messageId?: string;
  private heardFineAtStop?: number;
  private endedNaturally = false;
  private cutOff = false;
  // AUDIO-SESSION-01: the reply's voice is one registration with the shell's audio session, taken at the first sentence.
  private sessionHandle: AudioHandle | null = null;

  /** Fires once, the moment the first sentence is actually scheduled to
   * play - the real "time to first audio" signal. */
  onFirstAudio?: () => void;
  /** Fires once every enqueued sentence has finished playing AND finish()
   * has been called (no more sentences are coming). */
  onEnded?: () => void;
  onError?: () => void;

  constructor(audioContext?: AudioContext, speechStream: typeof api.streamSpeech = api.streamSpeech) {
    // Created synchronously by the caller, in the same click/submit
    // handler that triggers the turn: an AudioContext only counts as
    // unlocked by a real user gesture if it exists before that call
    // stack returns (streamingWavPlayer.ts's own constructor comment;
    // a code review, 2026-09-04, flagged the risk of creating one after
    // an awaited fetch instead).
    this.sharedContext = audioContext === undefined;
    this.audioContext = audioContext ?? sharedPlaybackContext();
    if (this.sharedContext && this.audioContext.state !== "running") void this.audioContext.resume?.().catch(() => {});
    this.speechStream = speechStream;
    this.playbackBus = this.audioContext.createGain();
    this.playbackBus.connect(this.audioContext.destination);
    this.meter = createLevelMeter(this.audioContext, this.playbackBus);
  }

  /** The current playback level, 0 to 1 (audioLevelMeter.ts's own RMS
   * meter, tapping `playbackBus`) - 0 whenever nothing is currently
   * playing (silent audio centers on 128, the same as true silence). */
  readLevel(): number {
    return this.stopped ? 0 : this.meter.read();
  }

  /** Milliseconds of the reply that have actually played: the audio clock since the first sentence started, which freezes while
   * the context is suspended (a pause), so it is the position a resume continues from. */
  playedMs(): number {
    const first = this.scheduledSentences[0];
    if (!first) return 0;
    return Math.max(0, (this.audioContext.currentTime - first.startTime) * 1000);
  }

  heardVisibleEnd(): number {
    if (this.heardEndAtStop !== undefined) return this.heardEndAtStop;
    const currentTime = this.audioContext.currentTime;
    let heardEnd = 0;
    for (const sentence of this.scheduledSentences) {
      if (sentence.visibleEnd !== undefined && sentence.startTime <= currentTime) heardEnd = sentence.visibleEnd;
    }
    return heardEnd;
  }

  /** How much of the reply's visible text has been spoken so far, counted inside the sentence that is playing (by how far its audio has
   * played), so a cut-in mid-sentence keeps only the words said. Frozen at the value it had when stop() ran. */
  heardVisibleEndFine(): number {
    if (this.heardFineAtStop !== undefined) return this.heardFineAtStop;
    const currentTime = this.audioContext.currentTime;
    let previousEnd = 0;
    let heard = 0;
    for (const sentence of this.scheduledSentences) {
      if (sentence.visibleEnd === undefined) continue;
      if (sentence.startTime <= currentTime) {
        // A sentence still arriving in small buffers is longer than what is scheduled so far: estimate its length from its characters
        // so the first buffer's quarter second does not count the whole sentence as heard.
        const span = sentence.endTime - sentence.startTime;
        const expected = sentence.complete ? span : Math.max(span, (sentence.visibleEnd - previousEnd) / CHARS_PER_SECOND);
        const played = expected > 0 ? Math.min(1, (currentTime - sentence.startTime) / expected) : 1;
        heard = previousEnd + Math.floor((sentence.visibleEnd - previousEnd) * played);
      }
      previousEnd = sentence.visibleEnd;
    }
    return heard;
  }

  /** True while the voice is paused (the person started talking over it) and the reply has not been stopped. */
  isPaused(): boolean { return this.paused && !this.stopped; }

  /** True when stop() cut the reply off before every sentence had played; false when it played to its end or is still playing. */
  wasCutOff(): boolean { return this.cutOff; }

  /** True once every sentence has played and no more are coming (also when none ever played), so the whole reply was heard. */
  hasEndedNaturally(): boolean { return this.endedNaturally; }

  /** VOICE-QUICK-03: turn the voice down to `level` (0 to 1) without stopping it, so a soft sound from the person is not met with silence. */
  duck(level = 0.25): void {
    if (this.stopped) return;
    const gain = this.playbackBus?.gain;
    if (gain?.setTargetAtTime) gain.setTargetAtTime(level, this.audioContext.currentTime, 0.03);
    else if (gain) gain.value = level;
  }

  /** Back to full volume. */
  unduck(): void {
    const gain = this.playbackBus?.gain;
    if (gain?.setTargetAtTime) gain.setTargetAtTime(1, this.audioContext.currentTime, 0.05);
    else if (gain) gain.value = 1;
  }

  pause(): void {
    if (this.stopped || this.paused) return;
    this.paused = true;
    void this.audioContext.suspend?.().catch(() => {});
  }

  resume(): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    void this.audioContext.resume?.().catch(() => {});
  }

  private async acquireFetchSlot(): Promise<void> {
    if (this.activeFetches < MAX_PARALLEL_FETCHES) {
      this.activeFetches++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.activeFetches++;
  }

  private releaseFetchSlot(): void {
    this.activeFetches = Math.max(0, this.activeFetches - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  /** Enqueues one sentence: fetches and decodes its audio (bounded
   * parallel with any other in-flight sentence), then schedules it right
   * after whatever's already queued - strictly in enqueue order, even if
   * a later sentence's fetch finishes first, via `dispatchTail`. */
  enqueueSentence(text: string, meta?: SpeechSentenceMeta): void {
    if (this.stopped) return;
    const predecessorDone = this.dispatchTail;
    let resolveThis!: () => void;
    this.dispatchTail = new Promise<void>((resolve) => {
      resolveThis = resolve;
    });
    const track: { entry?: ScheduledSentence } = {};
    void this.fetchAndSchedule(text, predecessorDone, meta, track).finally(() => {
      if (track.entry) track.entry.complete = true;
      resolveThis();
    });
  }

  private async fetchAndSchedule(text: string, predecessorDone: Promise<void>, meta: SpeechSentenceMeta | undefined, track: { entry?: ScheduledSentence }): Promise<void> {
    await this.acquireFetchSlot();
    // Streamed playback (Jesse, 2026-09-04: "streaming responses as you get them instead of generating the entire wav and then
    // just playing that"): the sentence's PCM is cut into small buffers and scheduled as it arrives, so the first sound plays
    // after the first bytes, not after the whole sentence is synthesized (measured 2026-10-25: first byte 250 ms, a whole
    // 85-character sentence 1.3 s, 151 characters 2.8 s). A buffer waits only for the sentence before it to finish scheduling, so
    // order is kept.
    let predecessorFinished = false;
    void predecessorDone.then(() => { predecessorFinished = true; });
    const pending: AudioBuffer[] = [];
    let scheduledAny = false;
    const emit = (buffer: AudioBuffer) => {
      this.scheduleBuffer(buffer, scheduledAny ? undefined : meta, track);
      scheduledAny = true;
    };
    const offer = (buffer: AudioBuffer) => {
      if (predecessorFinished && pending.length === 0) emit(buffer);
      else pending.push(buffer);
    };
    let whole: AudioBuffer | null = null;
    try {
      if (this.stopped) return;
      const response = await this.speechStream(text, this.abortController.signal, meta?.turnId && meta.generation !== undefined ? { turnId: meta.turnId, generation: meta.generation, ...(meta.voice ? { voice: meta.voice } : {}) } : meta?.voice ? { turnId: "", generation: 0, voice: meta.voice } : undefined);
      const reader = typeof this.audioContext.createBuffer === "function" ? response.body?.getReader() : undefined;
      if (!reader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (this.stopped) return;
        fixWavHeaderSize(bytes);
        whole = await this.audioContext.decodeAudioData(bytes.buffer as ArrayBuffer);
      } else {
        whole = await this.readStreamed(reader, offer);
      }
    } catch (error) {
      if (!this.stopped && !(error instanceof DOMException && error.name === "AbortError") && !(error instanceof ApiError && error.code === "turn_cancelled")) this.onError?.();
      // A failed sentence just doesn't speak - the reply's TEXT already
      // rendered regardless of TTS (ChatPage.tsx treats them as
      // independent), so one bad sentence never blocks or breaks the rest
      // of the reply's speech.
      return;
    } finally {
      this.releaseFetchSlot();
    }
    await predecessorDone;
    if (this.stopped) return;
    for (const buffer of pending.splice(0)) emit(buffer);
    if (whole) emit(whole);
  }

  /** Reads a streamed 16-bit mono WAV, offering each ~60 to 250 ms of audio as a buffer. A format it cannot cut (stereo, another bit
   * depth) is collected whole and returned decoded, as before. Never trusts the header's data size (Pocket and Chatterbox ship a
   * placeholder there). */
  private async readStreamed(reader: ReadableStreamDefaultReader<Uint8Array>, offer: (buffer: AudioBuffer) => void): Promise<AudioBuffer | null> {
    const HEADER = 44;
    const FIRST_BYTES = 3_000;
    const NEXT_BYTES = 12_000;
    const head = new Uint8Array(HEADER);
    let headLen = 0;
    let rate = 0;
    let streamable = false;
    let carry = new Uint8Array(0);
    const rawParts: Uint8Array[] = [];
    let offered = 0;
    const cutBuffers = (final: boolean) => {
      for (;;) {
        const want = offered === 0 ? FIRST_BYTES : NEXT_BYTES;
        if (carry.length < want && !(final && carry.length >= 2)) return;
        const take = (carry.length >= want ? want : carry.length) & ~1;
        if (take < 2) return;
        const samples = take / 2;
        const buffer = this.audioContext.createBuffer(1, samples, rate);
        const channel = buffer.getChannelData(0);
        const view = new DataView(carry.buffer, carry.byteOffset, take);
        for (let k = 0; k < samples; k++) channel[k] = view.getInt16(k * 2, true) / 32768;
        offer(buffer);
        offered++;
        carry = carry.subarray(take);
        if (carry.length === 0) return;
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (this.stopped) {
        void reader.cancel().catch(() => {});
        return null;
      }
      if (done) break;
      let chunk = value;
      if (headLen < HEADER) {
        const take = Math.min(HEADER - headLen, chunk.length);
        head.set(chunk.subarray(0, take), headLen);
        headLen += take;
        chunk = chunk.subarray(take);
        if (headLen === HEADER) {
          const view = new DataView(head.buffer);
          const isRiffWave = view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645;
          rate = view.getUint32(24, true);
          streamable = isRiffWave && view.getUint16(22, true) === 1 && view.getUint16(34, true) === 16 && rate > 0;
          if (!streamable) rawParts.push(head.slice());
        }
      }
      if (headLen < HEADER || chunk.length === 0) continue;
      if (!streamable) {
        rawParts.push(chunk.slice());
        continue;
      }
      const merged = new Uint8Array(carry.length + chunk.length);
      merged.set(carry, 0);
      merged.set(chunk, carry.length);
      carry = merged;
      cutBuffers(false);
    }
    if (streamable) {
      cutBuffers(true);
      return null;
    }
    // The body ended inside the 44-byte header: whatever arrived goes to the decoder as it always did.
    if (headLen > 0 && headLen < HEADER) rawParts.push(head.slice(0, headLen));
    const total = rawParts.reduce((sum, part) => sum + part.length, 0);
    if (total === 0) return null;
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const part of rawParts) {
      bytes.set(part, at);
      at += part.length;
    }
    fixWavHeaderSize(bytes);
    return this.audioContext.decodeAudioData(bytes.buffer as ArrayBuffer);
  }

  private joinAudioSession(): void {
    if (this.sessionHandle) return;
    const context = this.audioContext;
    const bus = this.playbackBus;
    this.sessionHandle = audioSession.registerVoice({
      pause: () => { void context.suspend?.().catch(() => {}); },
      resume: () => { void context.resume?.().catch(() => {}); },
      setVolume: (volume) => { if (bus?.gain) bus.gain.value = volume; },
    });
    // Starting to speak pauses a podcast or video that plays; the voice is then the thing that plays.
    this.sessionHandle.requestFocus();
  }

  private scheduleBuffer(audioBuffer: AudioBuffer, meta: SpeechSentenceMeta | undefined, track: { entry?: ScheduledSentence }): void {
    this.joinAudioSession();
    const rate = audioSession.speedFor("spoken_reply");
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    if (rate !== 1 && source.playbackRate) source.playbackRate.value = rate;
    source.connect(this.playbackBus);
    const startTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
    source.start(startTime);
    this.sources.add(source);
    const endTime = startTime + audioBuffer.duration / (source.playbackRate && rate !== 1 ? rate : 1);
    if (track.entry) track.entry.endTime = endTime;
    else {
      track.entry = { ...(meta?.visibleEnd === undefined ? {} : { visibleEnd: meta.visibleEnd }), startTime, endTime, complete: false };
      this.scheduledSentences.push(track.entry);
    }
    this.scheduledCount++;
    if (this.scheduledCount === 1) this.onFirstAudio?.();
    source.onended = () => {
      this.sources.delete(source);
      this.finishedCount++;
      if (this.streamDone && this.finishedCount === this.scheduledCount) {
        this.sessionHandle?.release();
        this.sessionHandle = null;
        this.endedNaturally = true;
        this.onEnded?.();
      }
    };
    this.nextStartTime = endTime;
  }

  /** Call once no more sentences are coming (the reply finished
   * generating): lets onEnded fire once every already-enqueued sentence
   * finishes playing, or immediately if none ever scheduled (an empty
   * reply, or every sentence's synthesis failed). Waits for
   * `dispatchTail` first so a sentence enqueued just before finish() is
   * still counted. */
  finish(): void {
    if (this.stopped) return;
    void this.dispatchTail.then(() => {
      if (this.stopped) return;
      this.streamDone = true;
      if (this.scheduledCount === 0) { this.endedNaturally = true; this.onEnded?.(); }
    });
  }

  /** Immediate stop: cuts every currently-scheduled sentence right away -
   * the real mechanism a future barge-in feature needs (Jesse,
   * 2026-09-04: "old project didn't allow for barge in... because of no
   * gaps"), and what a new turn uses to cut off whatever the previous
   * reply was still speaking. */
  stop(): void {
    if (this.stopped) return;
    this.heardEndAtStop = this.heardVisibleEnd();
    this.heardFineAtStop = this.heardVisibleEndFine();
    this.cutOff = !this.endedNaturally;
    this.stopped = true;
    this.paused = false;
    this.abortController.abort();
    for (const wake of this.waiters.splice(0)) wake();
    this.meter.stop();
    this.sessionHandle?.release();
    this.sessionHandle = null;
    if (!this.sharedContext) {
      this.audioContext.close().catch(() => {});
      return;
    }
    for (const source of this.sources) {
      try { source.stop?.(); } catch { /* already ended */ }
      try { source.disconnect?.(); } catch { /* already disconnected */ }
    }
    this.sources.clear();
    try { this.playbackBus.disconnect?.(); } catch { /* already disconnected */ }
    // A pause left the shared context suspended: the next reply needs it running.
    if (this.audioContext.state === "suspended") void this.audioContext.resume?.().catch(() => {});
  }
}
