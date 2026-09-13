import { describe, expect, test, mock, afterEach } from "bun:test";
import { bundledWasmPaths } from "@/lib/voice/wake-word-runtime";

// Issue #59: the dev-server crash traced to `wasmPaths` pointing at
// `public/ort/` - Vite's dev server refuses to load ANY public-dir file
// through a JS `import()` by design, and onnxruntime-web's WASM backend
// does exactly that internally when creating a session. Fixed by leaving
// `wasmPaths` unset in dev (onnxruntime-web then resolves its own loader
// file relative to its own module location, inside node_modules, which
// Vite serves and imports from normally - confirmed live) and setting it
// only in production, where `frontend/scripts/copy-ort.mjs` has copied
// the WASM/JS assets to that path for real. This test can't reach the
// real onnxruntime-web/WASM runtime (happy-dom has none), so it mocks the
// module import and asserts the runtime options `loadDefaultFactory`
// (wake-word-runtime.ts) actually sets on `ort.env.wasm`.
function makeFakeOrt() {
  const wasm: Record<string, unknown> = {};
  const created: string[] = [];
  return {
    env: { wasm },
    InferenceSession: {
      create: mock(async (modelPath: string) => {
        created.push(modelPath);
        return { run: mock(async () => ({})) };
      }),
    },
    Tensor: class {},
    __wasm: wasm,
    __created: created,
  };
}

afterEach(() => {
  mock.restore();
});

describe("wake-word-runtime's default session factory", () => {
  test("dev mode: numThreads=1, proxy=false, wasmPaths left unset", async () => {
    const fakeOrt = makeFakeOrt();
    mock.module("onnxruntime-web", () => fakeOrt);
    // import.meta.env.PROD is undefined under bun:test by default (no
    // Vite build ran), which is falsy - matching a real `bun run dev`
    // session, where Vite defines it as literal `false`.
    const { getOrLoadSession, evictAllSessions, setSessionFactory } = await import("@/lib/voice/wake-word-runtime");
    setSessionFactory(null); // clears any factory/cache a prior test in this file left behind
    evictAllSessions();
    await getOrLoadSession("/api/voice/wakeword/hey_jarvis_v0.1.onnx");
    expect(fakeOrt.__wasm.numThreads).toBe(1);
    expect(fakeOrt.__wasm.proxy).toBe(false);
    expect(fakeOrt.__wasm.wasmPaths).toBeUndefined();
    expect(fakeOrt.__created).toEqual(["/api/voice/wakeword/hey_jarvis_v0.1.onnx"]);
  });

  // A code review (2026-09-12) found the first pass only covered the dev
  // branch: nothing proved the production branch still sets `wasmPaths`,
  // so a future edit inverting or dropping that condition would pass the
  // whole suite silently - and since onnxruntime-web falls back to its own
  // default (CDN-capable) resolution when `wasmPaths` is unset, that
  // silent regression would reintroduce exactly the network fetch the
  // hub's "nothing leaves your house" promise forbids. `import.meta.env.
  // PROD` can't be flipped from a test (it's genuinely `undefined` under
  // `bun:test`, and each module gets its own `import.meta` - mutating the
  // test file's copy doesn't touch wake-word-runtime.ts's), which is
  // exactly why `bundledWasmPaths` takes the flag as a parameter: these
  // two calls exercise both branches directly.
  test("bundledWasmPaths(true) returns the bundle-served /ort/ path", () => {
    expect(bundledWasmPaths(true)).toBe("/ort/");
  });

  test("bundledWasmPaths(false) returns undefined", () => {
    expect(bundledWasmPaths(false)).toBeUndefined();
  });
});
