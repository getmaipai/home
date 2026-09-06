// Server-side STT endpointing (session-c-brain-and-voice.md step 5),
// ported from the archived legacy hub's lib/voice/sttSession.ts - the
// exact tuned numbers the plan names verbatim ("the numbers legacy
// tuned") - repointed at lib/stt.ts's Moonshine transcription instead of
// legacy's HTTP call to a separate whisper.cpp sidecar.
//
// VAD is Silero (neural, via sileroVad.ts) gated by a cheap RMS
// pre-check, so typing/music/fan noise never opens an utterance and
// steady noise can't grow the buffer to the 30s force-flush. Falls back
// to pure-RMS thresholds when the model isn't installed yet (boot
// before background download) or inference fails.
//
// Moonshine has no native streaming partials any more than whisper.cpp
// did, so partials re-transcribe the growing buffer at a fixed interval.
// Moonshine's own "silent-head" quirk (real, observed against the
// pinned tiny-en model, not theoretical): an utterance whose sent audio
// starts with a long dead-silence pre-roll occasionally decodes to an
// EMPTY string even though real speech follows - finalize() retries once
// from the real voiced onset (dropping the pre-roll) before giving up,
// the plan's own "a short pre-roll and a retry from onset when the
// model returns empty" rule.
import { transcribeUtterance } from "@/lib/stt";
import { getSileroStream, type SileroVadStream } from "@/lib/sileroVad";
import type { SttWireEvent } from "@maipai/spec/voice/ts/sttTypes.js";

export interface SttSessionConfig {
  sampleRate: number;
  silenceTimeoutS: number;
  partialIntervalS: number;
}

// Fallback energy thresholds (Silero unavailable).
const VAD_ONSET_RMS = 0.02;
const VAD_OFFSET_RMS = 0.012; // hysteresis: lower bar to KEEP speaking
// Silero decision thresholds (session-c-brain-and-voice.md step 5's own
// numbers), applied per completed 512-sample (32ms) chunk.
const SILERO_ONSET_PROB = 0.5; // chunk prob >= this while not speaking -> voiced
const SILERO_OFFSET_PROB = 0.35; // < this while speaking -> unvoiced (hold in between)
// Below this RMS while not speaking the room is silent: skip inference
// entirely (a stale RNN state across the gap is fine - probs
// re-converge within a chunk).
const PRE_GATE_RMS = 0.006;
// Pre-onset rolling window prepended to the utterance at onset. Silero
// decides per 32ms chunk and its onset probability ramps over a chunk
// or two, so without this the first phoneme would be clipped from what
// gets sent to Moonshine.
const PREROLL_S = 0.32;
const MIN_SPEECH_SAMPLES_FRAC = 0.2; // ignore bursts shorter than 0.2s
// Hard cap on buffered audio (~30s). Steady noise that never dips below
// the VAD offset threshold would otherwise grow the f32 buffer without
// bound; force a finalize once this is hit so memory stays flat.
const MAX_SPEECH_SECONDS = 30;

// Moonshine (like whisper.cpp before it) sometimes transcribes non-speech
// sounds as bracketed/parenthetical annotations - "[BLANK_AUDIO]",
// "(keyboard clicking)", "(typing)", "♪♪♪", "*sighs*". The energy VAD
// can't tell these from speech, so without this filter a few keystrokes
// become a "turn". Strip those annotations; if no actual letters
// survive, it wasn't speech.
function speechContent(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\*[^*]*\*/g, " ")
    .replace(/♪[^♪]*♪|♪+/g, " ")
    .replace(/[^\p{L}\p{N}\s'’]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLikelySpeech(text: string): boolean {
  return /\p{L}/u.test(speechContent(text));
}

export class SttSession {
  private cfg: SttSessionConfig;
  private send: (msg: SttWireEvent) => void;
  private speech: Float32Array[] = [];
  private speechLen = 0;
  // How many of the leading samples in `speech` are pre-roll (not real
  // voiced audio) - the Moonshine silent-head retry drops exactly this
  // many samples and re-decodes from the real onset.
  private prerollIncludedLen = 0;
  private speaking = false;
  private silenceSamples = 0;
  private samplesSincePartial = 0;
  private partialInFlight = false;
  private partialPromise: Promise<void> | null = null;
  private finalizing = false;
  private closed = false;
  private silero: SileroVadStream | null = null;
  private sileroVoiced = false;
  private preroll: Float32Array[] = [];
  private prerollLen = 0;
  private lastVoicedLen = 0;
  private reusablePartial: { text: string; voicedLen: number } | null = null;
  private redecodeAtEdge = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(cfg: SttSessionConfig, send: (msg: SttWireEvent) => void) {
    this.cfg = cfg;
    this.send = send;
    if (cfg.sampleRate === 16_000) {
      void getSileroStream().then((s) => {
        if (!this.closed) this.silero = s;
      });
    }
  }

  pushPcm(samples: Float32Array): void {
    if (this.closed || this.finalizing) return;
    this.chain = this.chain.then(() => this.processFrame(samples)).catch(() => {});
  }

  private async processFrame(samples: Float32Array): Promise<void> {
    if (this.closed || this.finalizing) return;
    const rms = computeRms(samples);
    let voiced: boolean;
    const silero = this.silero && !this.silero.failed ? this.silero : null;

    if (silero) {
      if (!this.speaking && rms < PRE_GATE_RMS) {
        this.sileroVoiced = false;
      } else {
        for (const prob of await silero.push(samples)) {
          if (prob >= SILERO_ONSET_PROB) this.sileroVoiced = true;
          else if (prob < SILERO_OFFSET_PROB) this.sileroVoiced = false;
        }
      }
      voiced = this.sileroVoiced;
    } else {
      const threshold = this.speaking ? VAD_OFFSET_RMS : VAD_ONSET_RMS;
      voiced = rms >= threshold;
    }

    if (voiced) {
      if (!this.speaking) {
        this.speaking = true;
        for (const p of this.preroll) {
          this.speech.push(p);
          this.speechLen += p.length;
        }
        this.prerollIncludedLen = this.prerollLen;
        this.preroll = [];
        this.prerollLen = 0;
        this.send({ t: "vad", speaking: true, rms });
      }
      this.silenceSamples = 0;
      this.speech.push(samples.slice());
      this.speechLen += samples.length;
      this.lastVoicedLen = this.speechLen;
      this.samplesSincePartial += samples.length;
      if (this.samplesSincePartial >= this.cfg.partialIntervalS * this.cfg.sampleRate) {
        this.samplesSincePartial = 0;
        void this.emitPartial();
      }
    } else if (this.speaking) {
      const firstSilenceFrame = this.silenceSamples === 0;
      this.speech.push(samples.slice());
      this.speechLen += samples.length;
      this.silenceSamples += samples.length;
      if (firstSilenceFrame) {
        if (this.partialInFlight) this.redecodeAtEdge = true;
        else void this.emitPartial();
      }
      if (this.silenceSamples >= this.cfg.silenceTimeoutS * this.cfg.sampleRate) {
        void this.finalize();
      }
    } else if (silero) {
      this.preroll.push(samples.slice());
      this.prerollLen += samples.length;
      const cap = PREROLL_S * this.cfg.sampleRate;
      while (this.prerollLen > cap && this.preroll.length > 1) {
        this.prerollLen -= this.preroll.shift()!.length;
      }
    }

    if (this.speaking && this.speechLen >= MAX_SPEECH_SECONDS * this.cfg.sampleRate) {
      void this.finalize();
    }
  }

  /** Client asked to flush (e.g. end of turn) - finalize whatever we
   * have. Routed through the chain so a queued frame can't race it. */
  end(): void {
    this.chain = this.chain
      .then(() => {
        if (!this.closed && this.speaking) void this.finalize();
      })
      .catch(() => {});
  }

  close(): void {
    this.closed = true;
    this.speech = [];
  }

  private emitPartial(): Promise<void> {
    if (this.partialInFlight || this.speechLen === 0) return Promise.resolve();
    this.partialInFlight = true;
    const run = async () => {
      const capturedVoicedLen = this.lastVoicedLen;
      try {
        const text = await transcribeUtterance(this.flatten(), this.cfg.sampleRate);
        if (text && isLikelySpeech(text)) {
          this.reusablePartial = { text, voicedLen: capturedVoicedLen };
          if (!this.closed && !this.finalizing) this.send({ t: "partial", v: text });
        }
      } catch {
        // model down: let finalize surface it; partials stay silent
      } finally {
        this.partialInFlight = false;
        this.partialPromise = null;
        if (this.redecodeAtEdge && !this.finalizing && !this.closed && this.speaking && this.silenceSamples > 0) {
          this.redecodeAtEdge = false;
          void this.emitPartial();
        } else {
          this.redecodeAtEdge = false;
        }
      }
    };
    this.partialPromise = run();
    return this.partialPromise;
  }

  private async finalize(): Promise<void> {
    if (this.finalizing) return;
    this.finalizing = true;
    this.send({ t: "vad", speaking: false, rms: 0 });

    if (this.partialPromise) {
      try {
        await this.partialPromise;
      } catch {
        /* ignored */
      }
    }
    if (this.closed) {
      this.reset();
      return;
    }

    const minSamples = MIN_SPEECH_SAMPLES_FRAC * this.cfg.sampleRate;
    if (this.speechLen < minSamples) {
      this.reset();
      this.send({ t: "no_speech" });
      return;
    }

    let text = "";
    const rp = this.reusablePartial;
    if (rp && rp.voicedLen > 0 && rp.voicedLen === this.lastVoicedLen) {
      // No voiced audio arrived after this partial's snapshot: everything
      // since was trailing silence, which the model ignores. The partial
      // already transcribes the whole utterance, so skip a redundant
      // full re-decode.
      text = rp.text;
    } else {
      // Flattened once here and reused (a code review, 2026-09-06, found
      // the retry path below calling flatten() a SECOND time - up to a
      // 30-second, ~1.9MB buffer, redundantly copied twice): the retry's
      // own subarray() is a view into this same array, not a second copy.
      const full = this.flatten();
      try {
        text = await transcribeUtterance(full, this.cfg.sampleRate);
      } catch (err) {
        this.reset();
        if (!this.closed) this.send({ t: "error", v: (err as Error).message });
        return;
      }
      if (!text && this.prerollIncludedLen > 0) {
        // Moonshine's own silent-head quirk: retry once from the real
        // voiced onset, dropping the pre-roll that may have read as
        // dead air with nothing to transcribe.
        try {
          text = await transcribeUtterance(full.subarray(this.prerollIncludedLen), this.cfg.sampleRate);
        } catch {
          // the retry failing is not itself a new error worth surfacing -
          // the first attempt's empty result already stands.
        }
      }
    }

    this.reset();
    if (this.closed) return;
    if (text && isLikelySpeech(text)) this.send({ t: "final", v: text });
    else this.send({ t: "no_speech" });
  }

  private flatten(): Float32Array {
    const out = new Float32Array(this.speechLen);
    let off = 0;
    for (const chunk of this.speech) {
      out.set(chunk, off);
      off += chunk.length;
    }
    return out;
  }

  private reset(): void {
    this.speech = [];
    this.speechLen = 0;
    this.prerollIncludedLen = 0;
    this.speaking = false;
    this.silenceSamples = 0;
    this.samplesSincePartial = 0;
    this.finalizing = false;
    this.sileroVoiced = false;
    this.preroll = [];
    this.prerollLen = 0;
    this.lastVoicedLen = 0;
    this.reusablePartial = null;
    this.redecodeAtEdge = false;
    this.silero?.reset();
  }
}

function computeRms(pcm: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) sumSq += pcm[i]! * pcm[i]!;
  return Math.sqrt(sumSq / Math.max(1, pcm.length));
}

/** Encode mono Float32 PCM as a 16-bit WAV container - used by
 * routes/stt.ts's own transcribe route (a household's uploaded WAV
 * still needs decoding TO this shape, not from it, but the route's own
 * fixture tests build synthetic WAV bytes with this), never by the
 * session's own internal transcribe calls above (which pass raw
 * Float32Array straight to lib/stt.ts). */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Uint8Array(buf);
}

/** Decodes a 16-bit mono PCM WAV back to Float32 samples in [-1, 1] -
 * the inverse of encodeWav(), used by routes/stt.ts's transcribe route
 * to turn an uploaded WAV file into what lib/stt.ts's transcribe()
 * actually wants. Only the one format this repo ever produces or
 * accepts (16-bit PCM, mono) - a real, named gap for a WAV in a
 * different bit depth or channel count, not silently mishandled: it
 * throws rather than guessing. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readStr = (off: number, len: number) => String.fromCharCode(...bytes.subarray(off, off + len));
  if (readStr(0, 4) !== "RIFF" || readStr(8, 4) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let off = 12;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let channels = 0;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= bytes.length) {
    const id = readStr(off, 4);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataOff = body;
      dataLen = size;
    }
    off = body + size + (size % 2);
  }
  if (dataOff < 0) throw new Error("no data chunk found");
  if (bitsPerSample !== 16 || channels !== 1) {
    throw new Error(`only 16-bit mono WAV is supported (got ${bitsPerSample}-bit, ${channels}ch)`);
  }
  const n = dataLen / 2;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(dataOff + i * 2, true);
    samples[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return { samples, sampleRate };
}
