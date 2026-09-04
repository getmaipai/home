// Lazy ONNX Runtime Web session loader for the wake-word pipeline
// (2026-09-04, phase 1 of the wake-word plan in docs/dev.md). Ported
// near-verbatim from `home-legacy.git`'s own
// `frontend/src/lib/voice/wake-word-runtime.ts`.
//
// Three ONNX sessions (mel, embedding, detector). mel + embedding are
// shared across detectors; only the detector handle swaps on model
// change. onnxruntime-web is imported lazily so a household member who
// never enables the wake-word chat mode never pulls the WASM artifacts.

export interface WakeWordInferenceSession {
  run(feeds: Record<string, WakeWordTensor>): Promise<Record<string, WakeWordTensor>>;
}

export interface WakeWordTensor {
  readonly data: Float32Array | Int32Array | BigInt64Array;
  readonly dims: readonly number[];
}

export interface SessionFactory {
  create(modelPath: string): Promise<WakeWordInferenceSession>;
  tensor(data: Float32Array, dims: readonly number[]): WakeWordTensor;
}

let factory: SessionFactory | null = null;
const SESSIONS: Map<string, Promise<WakeWordInferenceSession>> = new Map();

// Exported so tests (and the future diagnostic tester) can inject a fake
// session factory instead of a real onnxruntime-web/WASM runtime -
// happy-dom has no WebAssembly-backed ONNX runtime to exercise, and the
// pipeline's own math (the mel/embedding transform, the detector's
// scoring) is what actually needs testing, not onnxruntime-web itself.
export function setSessionFactory(next: SessionFactory | null): void {
  factory = next;
  SESSIONS.clear();
}

export async function getOrLoadSession(modelPath: string): Promise<WakeWordInferenceSession> {
  const existing = SESSIONS.get(modelPath);
  if (existing) return existing;
  const f = factory ?? (await loadDefaultFactory());
  const pending = f.create(modelPath);
  SESSIONS.set(modelPath, pending);
  return pending;
}

export async function tensorFor(data: Float32Array, dims: readonly number[]): Promise<WakeWordTensor> {
  const f = factory ?? (await loadDefaultFactory());
  return f.tensor(data, dims);
}

export function evictSession(modelPath: string): void {
  SESSIONS.delete(modelPath);
}

export function evictAllSessions(): void {
  SESSIONS.clear();
}

let defaultLoading: Promise<SessionFactory> | null = null;

async function loadDefaultFactory(): Promise<SessionFactory> {
  if (defaultLoading) return defaultLoading;
  defaultLoading = (async () => {
    const ort = await import("onnxruntime-web");
    // Bundle-served WASM: see frontend/scripts/copy-ort.mjs and
    // public/ort/. No CDN - the hub's own privacy architecture promise
    // ("nothing leaves your house") applies to loading the wake-word
    // engine itself, not just to what it detects.
    ort.env.wasm.wasmPaths = "/ort/";
    ort.env.wasm.numThreads = 1;
    const built: SessionFactory = {
      async create(modelPath: string): Promise<WakeWordInferenceSession> {
        const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
        return {
          async run(feeds: Record<string, WakeWordTensor>) {
            const ortFeeds: Record<string, InstanceType<typeof ort.Tensor>> = {};
            for (const [name, t] of Object.entries(feeds)) {
              ortFeeds[name] = new ort.Tensor("float32", t.data as Float32Array, t.dims as number[]);
            }
            const out = await session.run(ortFeeds);
            const result: Record<string, WakeWordTensor> = {};
            for (const [name, tensor] of Object.entries(out)) {
              result[name] = { data: tensor.data as Float32Array, dims: tensor.dims };
            }
            return result;
          },
        };
      },
      tensor(data: Float32Array, dims: readonly number[]): WakeWordTensor {
        return { data, dims };
      },
    };
    factory = built;
    return built;
  })();
  return defaultLoading;
}
