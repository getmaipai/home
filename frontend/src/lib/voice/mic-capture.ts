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
        } as MediaTrackConstraints,
      }));
  const stream = await getStream();

  const AudioContextCtor = (window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  let context: AudioContext;
  try {
    context = new AudioContextCtor({ sampleRate: 16_000 });
  } catch {
    context = new AudioContextCtor();
  }

  const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  await context.audioWorklet.addModule(blobUrl);
  URL.revokeObjectURL(blobUrl);

  const source = context.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(context, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });

  const targetRate = 16_000;
  const ratio = context.sampleRate / targetRate;
  let resampleAccum = 0;

  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const incoming = event.data;
    if (Math.abs(ratio - 1) < 1e-6) {
      options.onFrame(incoming);
      return;
    }
    const outLen = Math.floor((incoming.length - resampleAccum) / ratio);
    if (outLen <= 0) return;
    const out = new Float32Array(outLen);
    let idx = resampleAccum;
    for (let i = 0; i < outLen; i++) {
      const base = Math.floor(idx);
      const frac = idx - base;
      const a = incoming[Math.min(base, incoming.length - 1)] ?? 0;
      const b = incoming[Math.min(base + 1, incoming.length - 1)] ?? a;
      out[i] = a + (b - a) * frac;
      idx += ratio;
    }
    resampleAccum = idx - incoming.length;
    options.onFrame(out);
  };

  source.connect(worklet);

  const stop = () => {
    try {
      worklet.port.onmessage = null;
      worklet.disconnect();
    } catch {
      /* ignore */
    }
    try {
      source.disconnect();
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
    void context.close().catch(() => {});
  };

  return { stop, sampleRate: targetRate };
}
