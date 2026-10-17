// Minimal mic capture for the wake-word loop (2026-09-04, phase 1 of the
// wake-word plan in docs/dev.md). Ported near-verbatim from
// `home-legacy.git`'s own `frontend/src/lib/voice/mic-capture.ts` - hard-won
// logic (`.github/CLAUDE.md`'s "copy from legacy" allowance), not
// legacy-specific: this is the first thing anywhere in `home` that
// captures microphone audio at all.
//
// Opens a default AudioContext over getUserMedia, runs the stream through an
// AudioWorkletNode (public/mic-worklet.js, a real same-origin file: the page
// CSP blocks a blob: module in Safari) or, when the worklet cannot load, a
// ScriptProcessorNode, and resamples to 16 kHz on the main thread. Every
// step is named so a failure reports where it stopped (micDiagnostics.ts).
//
// AEC/NS/AGC constraints are explicit and load-bearing: without them,
// this hub's own spoken replies (streamingWavPlayer.ts's playback)
// leaking back into the mic could trip the wake detector on its own
// voice - the household's own hardware doing the echo cancellation the
// legacy pod's XVF3800 mic array did for real.

import { acquireMicStream, type MicLease } from "@/lib/media/micStream";
import { StreamResampler } from "@/lib/voice/resampler";
import { beginMicAttempt, errMessage, errName, noteMicDegraded, recordMicFailure, type MicStep } from "@/lib/voice/micDiagnostics";

const TARGET_RATE = 16_000;
export const WORKLET_NAME = "wake-word-mic-processor";

export type MicCaptureErrorKind = "insecure" | "denied" | "setup" | "not_found" | "in_use";

/** Why capture could not start. `kind` picks the message the person sees;
 * `step` and `cause` say where it stopped and why (logged and shown). */
export class MicCaptureError extends Error {
  constructor(readonly kind: MicCaptureErrorKind, readonly cause: unknown, readonly step: MicStep = "microphone request", audioContext?: string) {
    super(`mic capture ${kind} at ${step}: ${errName(cause)}: ${errMessage(cause)}`);
    this.name = "MicCaptureError";
    recordMicFailure(step, kind, cause, audioContext);
    console.warn(`[mic] capture failed (${kind}) at step "${step}": ${errName(cause)}: ${errMessage(cause)}`);
  }
}

/** The worklet file. Same origin, so script-src 'self' allows it. */
export function micWorkletUrl(): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return `${base.endsWith("/") ? base : `${base}/`}mic-worklet.js`;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

type AudioContextCtor = typeof AudioContext;
function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined;
}

/** A default AudioContext (no sampleRate or latencyHint options: WebKit and
 * Firefox reject some of them). */
export function createAudioContext(options?: AudioContextOptions): AudioContext {
  const Ctor = audioContextCtor();
  if (!Ctor) throw new DOMException("AudioContext is not available in this browser", "NotSupportedError");
  return options ? new Ctor(options) : new Ctor();
}

// Safari only lets a context start from a user gesture. The tap handler
// calls primeMicAudio() before its first await; startMicCapture() takes
// that context (already resumed) instead of creating one later, outside
// the gesture. An unused one closes itself after a short wait.
let primed: { context: AudioContext; timer: ReturnType<typeof setTimeout> } | null = null;
const PRIME_TTL_MS = 30_000;

export function primeMicAudio(): void {
  try {
    releasePrimedAudio();
    const context = createAudioContext();
    void context.resume().catch(() => {});
    primed = { context, timer: setTimeout(releasePrimedAudio, PRIME_TTL_MS) };
  } catch {
    /* no AudioContext: startMicCapture reports it at its own step */
  }
}

export function releasePrimedAudio(): void {
  if (!primed) return;
  clearTimeout(primed.timer);
  const { context } = primed;
  primed = null;
  void context.close().catch(() => {});
}

function takePrimedAudio(): AudioContext | undefined {
  if (!primed) return undefined;
  clearTimeout(primed.timer);
  const { context } = primed;
  primed = null;
  return context.state === "closed" ? undefined : context;
}

function isConstraintFailure(err: unknown): boolean {
  const name = errName(err);
  return name === "OverconstrainedError" || name === "TypeError" || name === "NotSupportedError" || name === "ConstraintNotSatisfiedError";
}

/** getUserMedia with processing flags as `ideal` only (they can never fail
 * the call), and a plain `{ audio: true }` retry when the browser rejects
 * the constraint set. A chosen device stays `exact` and fails loudly. */
export async function openMicStream(deviceId?: string): Promise<MediaStream> {
  const gum = (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints);
  const audio = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    // Chrome 115+ voice isolation; unknown constraint names are ignored.
    voiceIsolation: { ideal: true },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  } as MediaTrackConstraints;
  try {
    return await gum({ audio });
  } catch (err) {
    if (deviceId || !isConstraintFailure(err)) throw err;
    noteMicDegraded("microphone request", err, "retried with plain audio");
    return gum({ audio: true });
  }
}

/** The shared-stream key: one per chosen device. */
export const micStreamKey = (deviceId?: string) => `mic:${deviceId ?? ""}`;

function releaseStream(stream: MediaStream, lease: MicLease | null) {
  if (lease) { lease.release(); return; }
  stream.getTracks().forEach((track) => { try { track.stop(); } catch { /* ignore */ } });
}

export interface MicCaptureHandle {
  stop: () => void;
  sampleRate: number;
}

export interface MicCaptureOptions {
  onFrame: (samples: Float32Array) => void;
  getStream?: () => Promise<MediaStream>;
  /** VOICE-LIVE-03: the household member's remembered device (a per-
   * browser preference, `micDevicePreference.ts`), never required -
   * omitted, this stays the browser's own default input. `{ exact:
   * deviceId }` rather than `ideal`: a stale id (the device was unplugged
   * since the preference was written) should fail loudly as a real
   * getUserMedia error, never silently pick a different microphone than
   * the one the household member chose. */
  deviceId?: string;
  /** VOICE-LIVE-02: called once, synchronously, right after the mic's own
   * `MediaStreamAudioSourceNode` is created and wired - lets a caller tap
   * the identical stream for an AnalyserNode-based level meter
   * (`audioLevelMeter.ts`) without a second `getUserMedia` call or a
   * second `AudioContext`. */
  onSource?: (context: AudioContext, source: MediaStreamAudioSourceNode) => void;
}

/** Loads the worklet module into `context`. Throws the browser's own error. */
export async function loadMicWorklet(context: AudioContext): Promise<void> {
  if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
    throw new DOMException("AudioWorklet is not available in this browser", "NotSupportedError");
  }
  await context.audioWorklet.addModule(micWorkletUrl());
}

export async function startMicCapture(options: MicCaptureOptions): Promise<MicCaptureHandle> {
  beginMicAttempt();
  let step: MicStep = "secure check";
  if (!options.getStream && (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia)) {
    releasePrimedAudio();
    throw new MicCaptureError("insecure", new Error("not a secure context or mediaDevices missing"), step);
  }
  step = "microphone request";
  let stream: MediaStream;
  // Shared page-wide stream (micStream.ts): reopening within the grace period
  // reuses it, so Safari does not ask again. A caller-supplied getStream
  // (tests) bypasses the share and is stopped on stop().
  let lease: MicLease | null = null;
  try {
    if (options.getStream) stream = await options.getStream();
    else {
      lease = await acquireMicStream(micStreamKey(options.deviceId), () => openMicStream(options.deviceId));
      stream = lease.stream;
    }
  } catch (err) {
    releasePrimedAudio();
    const name = errName(err);
    const kind: MicCaptureErrorKind =
      name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError" ? "denied"
      : name === "NotFoundError" || name === "DevicesNotFoundError" || (name === "OverconstrainedError" && !options.deviceId) ? "not_found"
      : name === "NotReadableError" || name === "TrackStartError" ? "in_use"
      : "setup";
    throw new MicCaptureError(kind, err, step);
  }

  // Capture runs at the context's own rate and is resampled to 16 kHz here.
  let context: AudioContext | undefined = takePrimedAudio();
  let source: MediaStreamAudioSourceNode | undefined;
  let node: { disconnect: () => void } | undefined;
  try {
    step = "audio context";
    context ??= createAudioContext();
    step = "audio resume";
    // resume() can hang outside a gesture in Safari: never wait on it for long.
    if (context.state !== "running") await withTimeout(context.resume(), 1500).catch(() => {});
    step = "audio source";
    try {
      source = context.createMediaStreamSource(stream);
    } catch (err) {
      // A context whose rate differs from the microphone's can be refused: retry at the stream's own rate.
      const rate = stream.getAudioTracks?.()[0]?.getSettings?.().sampleRate;
      if (!rate || rate === context.sampleRate) throw err;
      noteMicDegraded("audio source", err, `recreated the context at ${rate} Hz`);
      void context.close().catch(() => {});
      context = createAudioContext({ sampleRate: rate });
      void context.resume().catch(() => {});
      source = context.createMediaStreamSource(stream);
    }
    const ctx = context;
    const src = source;
    const resampler = new StreamResampler(ctx.sampleRate, TARGET_RATE);
    const emit = (frame: Float32Array) => {
      const out = resampler.process(frame);
      if (out.length) options.onFrame(out);
    };
    let worklet: AudioWorkletNode | undefined;
    try {
      step = "worklet load";
      await loadMicWorklet(ctx);
      step = "worklet node";
      // One silent output into a zero-gain node: WebKit does not always run a
      // node that has no path to the destination.
      worklet = new AudioWorkletNode(ctx, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
    } catch (err) {
      noteMicDegraded(step, err, "using ScriptProcessor");
      worklet = undefined;
    }
    if (worklet) {
      const w = worklet;
      const silent = ctx.createGain();
      silent.gain.value = 0;
      w.port.onmessage = (event: MessageEvent<Float32Array>) => emit(event.data);
      src.connect(w);
      w.connect(silent);
      silent.connect(ctx.destination);
      node = { disconnect: () => { w.port.onmessage = null; w.disconnect(); silent.disconnect(); } };
    } else {
      step = "script processor";
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => emit(event.inputBuffer.getChannelData(0).slice(0));
      src.connect(processor);
      processor.connect(ctx.destination);
      node = { disconnect: () => { processor.onaudioprocess = null; processor.disconnect(); } };
    }
  } catch (err) {
    try { source?.disconnect(); } catch { /* ignore */ }
    releaseStream(stream, lease);
    const state = context ? `state ${context.state}, ${context.sampleRate} Hz` : undefined;
    void context?.close().catch(() => {});
    throw new MicCaptureError("setup", err, step, state);
  }
  const ctx = context;
  const src = source;
  const connected = node;

  options.onSource?.(ctx, src);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      connected.disconnect();
    } catch {
      /* ignore */
    }
    try {
      src.disconnect();
    } catch {
      /* ignore */
    }
    releaseStream(stream, lease);
    void ctx.close().catch(() => {});
  };

  return { stop, sampleRate: TARGET_RATE };
}
