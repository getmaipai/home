// Minimal mic capture for the wake-word loop (2026-09-04, phase 1 of the
// wake-word plan in docs/dev.md). Ported near-verbatim from
// `home-legacy.git`'s own `frontend/src/lib/voice/mic-capture.ts` - hard-won
// logic (`.github/CLAUDE.md`'s "copy from legacy" allowance), not
// legacy-specific: this is the first thing anywhere in `home` that
// captures microphone audio at all.
//
// Opens a 16 kHz mono AudioContext over getUserMedia, runs the stream
// through an AudioWorkletNode that downsamples (if the browser refused
// 16 kHz) and posts Float32 frames to the main thread. The worklet is
// inlined as a Blob URL so no separate static asset is needed.
//
// AEC/NS/AGC constraints are explicit and load-bearing: without them,
// this hub's own spoken replies (streamingWavPlayer.ts's playback)
// leaking back into the mic could trip the wake detector on its own
// voice - the household's own hardware doing the echo cancellation the
// legacy pod's XVF3800 mic array did for real.

import { StreamResampler } from "@/lib/voice/resampler";

const TARGET_RATE = 16_000;

export type MicCaptureErrorKind = "insecure" | "denied" | "setup";

/** Why capture could not start. `kind` picks the message the person sees;
 * `cause` is the underlying error, logged for diagnosis. */
export class MicCaptureError extends Error {
  constructor(readonly kind: MicCaptureErrorKind, readonly cause: unknown) {
    super(`mic capture ${kind}: ${errName(cause)}: ${errMessage(cause)}`);
    this.name = "MicCaptureError";
    console.warn(`[mic] capture failed (${kind}): ${errName(cause)}: ${errMessage(cause)}`);
  }
}

function errName(err: unknown): string {
  return typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "Error";
}
function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : String(err);
}

const WORKLET_NAME = "wake-word-mic-processor";

const WORKLET_SOURCE = `
class WakeWordMicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor(${JSON.stringify(WORKLET_NAME)}, WakeWordMicProcessor);
`;

export interface MicCaptureHandle {
  stop: () => void;
  sampleRate: number;
}

export interface MicCaptureOptions {
  onFrame: (samples: Float32Array) => void;
  getStream?: () => Promise<MediaStream>;
  /** VOICE-LIVE-03: the household member's remembered device (a per-
   * browser preference, `micDevicePreference.ts`), never required -
   * omitted, this stays the browser's own default input, same as
   * before this option existed. `{ exact: deviceId }` rather than an
   * `ideal` constraint: a stale id (the device was unplugged since the
   * preference was written) should fail loudly as a real getUserMedia
   * error, never silently fall back to a different microphone than the
   * one the household member actually chose. */
  deviceId?: string;
  /** VOICE-LIVE-02: called once, synchronously, right after the mic's own
   * `MediaStreamAudioSourceNode` connects to the capture worklet - lets a
   * caller tap the identical stream for its own purposes (an
   * AnalyserNode-based level meter, `audioLevelMeter.ts`) without a
   * second `getUserMedia` call or a second `AudioContext`: a Web Audio
   * node only ever connects within the context that created it, and this
   * function creates its own. */
  onSource?: (context: AudioContext, source: MediaStreamAudioSourceNode) => void;
}

export async function startMicCapture(options: MicCaptureOptions): Promise<MicCaptureHandle> {
  const getStream =
    options.getStream ??
    (() =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Chrome 115+'s own voice-isolation constraint (distinct from
          // noiseSuppression: it specifically isolates the primary
          // speaker from background voices/talk, not just steady-state
          // noise) - not in the legacy hub this file was ported from
          // (checked: absent from its full git history, and from
          // bot-legacy's and loki-doki's too), added here because it
          // helps exactly this use case. An unrecognized constraint name
          // is ignored per spec, not a hard failure, so this degrades
          // safely on browsers that don't support it - same posture the
          // three constraints above it already have.
          voiceIsolation: true,
          ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
        } as MediaTrackConstraints,
      }));
  if (!options.getStream && (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia)) {
    throw new MicCaptureError("insecure", new Error("not a secure context or mediaDevices missing"));
  }
  let stream: MediaStream;
  try {
    stream = await getStream();
  } catch (err) {
    const name = errName(err);
    const kind: MicCaptureErrorKind = name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError" ? "denied" : "setup";
    throw new MicCaptureError(kind, err);
  }

  // Capture runs at the device's own rate and is resampled to 16 kHz here.
  // Asking for a 16 kHz context over a 44.1/48 kHz microphone throws in
  // Firefox ("different sample-rate") and is unreliable in Safari.
  const AudioContextCtor = (window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: { disconnect: () => void } | undefined;
  try {
    context = new AudioContextCtor();
    // Safari starts a context suspended unless resumed; harmless elsewhere.
    if (context.state === "suspended") await context.resume().catch(() => {});
    source = context.createMediaStreamSource(stream);
    const resampler = new StreamResampler(context.sampleRate, TARGET_RATE);
    const emit = (frame: Float32Array) => {
      const out = resampler.process(frame);
      if (out.length) options.onFrame(out);
    };
    if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
      try {
        await context.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      const worklet = new AudioWorkletNode(context, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => emit(event.data);
      source.connect(worklet);
      node = { disconnect: () => { worklet.port.onmessage = null; worklet.disconnect(); } };
    } else {
      // Old Safari without AudioWorklet.
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => emit(event.inputBuffer.getChannelData(0).slice(0));
      source.connect(processor);
      processor.connect(context.destination);
      node = { disconnect: () => { processor.onaudioprocess = null; processor.disconnect(); } };
    }
  } catch (err) {
    try { source?.disconnect(); } catch { /* ignore */ }
    stream.getTracks().forEach((track) => { try { track.stop(); } catch { /* ignore */ } });
    void context?.close().catch(() => {});
    throw new MicCaptureError("setup", err);
  }
  const ctx = context;
  const src = source;
  const worklet = node;

  options.onSource?.(ctx, src);

  const stop = () => {
    try {
      worklet.disconnect();
    } catch {
      /* ignore */
    }
    try {
      src.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    });
    void ctx.close().catch(() => {});
  };

  return { stop, sampleRate: TARGET_RATE };
}
