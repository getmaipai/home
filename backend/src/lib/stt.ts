// The `stt` role (session-c-brain-and-voice.md step 5): sherpa-onnx with
// Moonshine tiny-en for English, "the robot's choice, one runtime for
// both" per the plan. Unlike `tts` (a separate Python process,
// ttsSupervisor.ts's own lazy-spawn-or-stub shape), sherpa-onnx-node is
// a real, in-process native addon - verified live this session under
// Bun (no segfault, a real transcription came back from a real model)
// before committing to this shape. There is no external process here to
// supervise through lib/sidecars.ts the way the plan's own words
// anticipated ("supervised through F's sidecars.ts once it lands"):
// that anticipation was written before anyone had confirmed sherpa-onnx
// ships real Node bindings, not a Python sidecar like Pocket TTS. This
// file is a lazy-init, in-process singleton instead - the same
// "resolve once, cache, clear on restart" shape as llmSupervisor.ts and
// ttsSupervisor.ts, just with nothing to spawn or health-poll.
import { existsSync } from "node:fs";
// sherpa-onnx-node ships no .d.ts (plain JS package) - minimal local
// types for exactly the surface this file uses, the same posture
// sileroVad.ts's onnxruntime-web import already takes.
// @ts-ignore - no resolvable .d.ts
import sherpaOnnx from "sherpa-onnx-node";
import { ensureSttAssets, isSttInstalled, sileroVadPath, moonshinePath } from "@/lib/sttAssets";

interface OfflineStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
}

interface OfflineRecognizer {
  createStream(): OfflineStream;
  decode(stream: OfflineStream): void;
  getResult(stream: OfflineStream): { text: string };
}

let recognizer: OfflineRecognizer | null = null;
let recognizerPromise: Promise<OfflineRecognizer> | null = null;

function buildRecognizer(): OfflineRecognizer {
  return new sherpaOnnx.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      moonshine: {
        preprocessor: moonshinePath("preprocess.onnx"),
        encoder: moonshinePath("encode.int8.onnx"),
        uncachedDecoder: moonshinePath("uncached_decode.int8.onnx"),
        cachedDecoder: moonshinePath("cached_decode.int8.onnx"),
      },
      tokens: moonshinePath("tokens.txt"),
      numThreads: 1,
      debug: false,
    },
  }) as OfflineRecognizer;
}

async function getRecognizer(): Promise<OfflineRecognizer> {
  if (recognizer) return recognizer;
  if (!recognizerPromise) {
    recognizerPromise = ensureSttAssets()
      .then(() => {
        recognizer = buildRecognizer();
        return recognizer;
      })
      .catch((err) => {
        recognizerPromise = null;
        throw err;
      });
  }
  return recognizerPromise;
}

/** True once assets are on disk (a real download may still be needed
 * for the FIRST call, but nothing has failed) - GET /api/voice/stt/status's
 * own "installed" field. */
export function sttAssetsInstalled(): boolean {
  return isSttInstalled();
}

/** True once a recognizer has actually been constructed in this
 * process - distinct from "assets installed" the same way
 * llmSupervisor.ts's getEngineStatus() distinguishes "none" from
 * "starting" from a real running kind. */
export function sttRecognizerLoaded(): boolean {
  return recognizer !== null;
}

/** Real Moonshine transcription of already-decoded 16kHz mono f32
 * samples - no WAV encode/decode round trip in-process, unlike the
 * legacy hub's HTTP call to a separate whisper.cpp sidecar, since
 * sherpa-onnx-node's acceptWaveform() takes raw samples directly. */
export async function transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
  const r = await getRecognizer();
  const stream = r.createStream();
  stream.acceptWaveform({ sampleRate, samples });
  r.decode(stream);
  return r.getResult(stream).text;
}

type SttBackend = (samples: Float32Array, sampleRate: number) => Promise<string>;
let testBackend: SttBackend | null = null;

/** Test-only: every STT-driven test in this repo runs on machines and
 * CI without the real ~110MB Moonshine weights installed (the same
 * "real dev machines and CI never have real weights by default" posture
 * llm.ts's stub backend already assumes for the chat role) - this seam
 * lets sttSession.test.ts and stt.test.ts script exactly what a
 * "transcription" returns without ever touching the real model. */
export function __setSttBackendForTests(fn: SttBackend): void {
  testBackend = fn;
}

export function __resetSttForTests(): void {
  testBackend = null;
  recognizer = null;
  recognizerPromise = null;
}

/** The real entry point every caller (sttSession.ts, routes/stt.ts)
 * uses - routes through the scripted test backend when one is set,
 * otherwise the real recognizer above. Exists so callers never have to
 * know or care which one is active, the same indirection llm.ts's own
 * complete()/startCompleteStream() give every caller over the stub vs.
 * real chat backend. */
export async function transcribeUtterance(samples: Float32Array, sampleRate: number): Promise<string> {
  if (testBackend) return testBackend(samples, sampleRate);
  return transcribe(samples, sampleRate);
}

/** The two installs checked separately, without triggering a download -
 * routes/stt.ts's status route reports both so "silero present,
 * Moonshine still downloading" (a real, reachable partial-install state:
 * ensureSttAssets() downloads Silero first, then Moonshine) is
 * distinguishable from "both present" or "neither." A code review
 * (2026-09-06) found an earlier cut of this exported the Moonshine half
 * (`moonshineFileExists()`) but never actually wired it into the status
 * route - dead code with a comment describing behavior nothing called. */
export function sttAssetInstallStatus(): { sileroInstalled: boolean; moonshineInstalled: boolean } {
  return {
    sileroInstalled: existsSync(sileroVadPath()),
    moonshineInstalled: existsSync(moonshinePath("encode.int8.onnx")),
  };
}
