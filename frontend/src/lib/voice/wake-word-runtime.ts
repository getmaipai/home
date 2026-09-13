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
// Also clears the cached default-factory load: passing `null` means "go
// back to computing the real default next time," and a stale cached
// promise from an earlier call would otherwise silently keep returning
// that earlier result forever, including in tests that mock the
// `onnxruntime-web` import differently across cases.
export function setSessionFactory(next: SessionFactory | null): void {
  factory = next;
  SESSIONS.clear();
  defaultLoading = null;
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

// Issue #59, the real cause (confirmed live against Vite's own dev
// server error text, not guessed): onnxruntime-web's WASM backend loads
// its own `ort-wasm-simd-threaded.jsep.mjs` with a runtime `import()`
// built from `wasmPaths`. Vite's dev server refuses to load ANY file
// under `public/` through `import()` by design ("This file is in
// /public and will be copied as-is during build without going through
// the plugin transforms, and therefore should not be imported from
// source code" - Vite's own error, reproduced live), regardless of
// worker/proxy mode; `ort.env.wasm.proxy` was already `false` by
// default in this onnxruntime-web version, so that was never the fix.
// In dev, leaving `wasmPaths` unset lets onnxruntime-web resolve the
// file relative to its own `import.meta.url` (inside node_modules,
// which Vite serves and imports from normally, confirmed live - the
// same dynamic import that 500s from `/ort/` succeeds from there).
// Production keeps the bundle-served `/ort/` path (frontend/scripts/
// copy-ort.mjs) so the built app never fetches the engine from a CDN -
// the hub's own privacy architecture promise ("nothing leaves your
// house") applies to loading the wake-word engine itself, not just to
// what it detects. A plain `import.meta.env.PROD` isn't the standard
// Vite constant it looks like: it is genuinely `undefined` under
// `bun:test` (no Vite build ran), which is why this is its own
// exported function taking an explicit override - a real unit test has
// no other way to exercise the production branch.
export function bundledWasmPaths(isProd: boolean = !!import.meta.env.PROD): string | undefined {
  return isProd ? "/ort/" : undefined;
}

let defaultLoading: Promise<SessionFactory> | null = null;

async function loadDefaultFactory(): Promise<SessionFactory> {
  if (defaultLoading) return defaultLoading;
  defaultLoading = (async () => {
    const ort = await import("onnxruntime-web");
    // See bundledWasmPaths() above for why this isn't just `import.meta.env.PROD`.
    ort.env.wasm.wasmPaths = bundledWasmPaths();
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
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
