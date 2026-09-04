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
import { api } from "@/lib/api";

const MAX_PARALLEL_FETCHES = 2;

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
  private nextStartTime = 0;
  private scheduledCount = 0;
  private finishedCount = 0;
  private streamDone = false;
  private stopped = false;
  private activeFetches = 0;
  private readonly waiters: Array<() => void> = [];
  private dispatchTail: Promise<void> = Promise.resolve();

  /** Fires once, the moment the first sentence is actually scheduled to
   * play - the real "time to first audio" signal. */
  onFirstAudio?: () => void;
  /** Fires once every enqueued sentence has finished playing AND finish()
   * has been called (no more sentences are coming). */
  onEnded?: () => void;

  constructor() {
    // Created synchronously by the caller, in the same click/submit
    // handler that triggers the turn: an AudioContext only counts as
    // unlocked by a real user gesture if it exists before that call
    // stack returns (streamingWavPlayer.ts's own constructor comment;
    // a code review, 2026-09-04, flagged the risk of creating one after
    // an awaited fetch instead).
    this.audioContext = new AudioContext({ latencyHint: "interactive" });
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
  enqueueSentence(text: string): void {
    if (this.stopped) return;
    const predecessorDone = this.dispatchTail;
    let resolveThis!: () => void;
    this.dispatchTail = new Promise<void>((resolve) => {
      resolveThis = resolve;
    });
    void this.fetchAndSchedule(text, predecessorDone).finally(resolveThis);
  }

  private async fetchAndSchedule(text: string, predecessorDone: Promise<void>): Promise<void> {
    await this.acquireFetchSlot();
    let audioBuffer: AudioBuffer | null = null;
    try {
      const response = await api.streamSpeech(text);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (this.stopped) return;
      fixWavHeaderSize(bytes);
      audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer as ArrayBuffer);
    } catch {
      // A failed sentence just doesn't speak - the reply's TEXT already
      // rendered regardless of TTS (ChatPage.tsx treats them as
      // independent), so one bad sentence never blocks or breaks the rest
      // of the reply's speech.
      return;
    } finally {
      this.releaseFetchSlot();
    }
    await predecessorDone;
    if (this.stopped || !audioBuffer) return;
    this.scheduleBuffer(audioBuffer);
  }

  private scheduleBuffer(audioBuffer: AudioBuffer): void {
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    const startTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
    source.start(startTime);
    this.scheduledCount++;
    if (this.scheduledCount === 1) this.onFirstAudio?.();
    source.onended = () => {
      this.finishedCount++;
      if (this.streamDone && this.finishedCount === this.scheduledCount) this.onEnded?.();
    };
    this.nextStartTime = startTime + audioBuffer.duration;
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
      if (this.scheduledCount === 0) this.onEnded?.();
    });
  }

  /** Immediate stop: cuts every currently-scheduled sentence right away -
   * the real mechanism a future barge-in feature needs (Jesse,
   * 2026-09-04: "old project didn't allow for barge in... because of no
   * gaps"), and what a new turn uses to cut off whatever the previous
   * reply was still speaking. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.audioContext.close().catch(() => {});
  }
}
