import { afterEach, describe, expect, test } from "bun:test";
import { MicCaptureError, openMicStream, primeMicAudio, startMicCapture } from "@/lib/voice/mic-capture";

const w = window as unknown as Record<string, unknown>;
const original = { ctx: w.AudioContext, node: w.AudioWorkletNode };
afterEach(() => { w.AudioContext = original.ctx; w.AudioWorkletNode = original.node; });

function fakeStream() {
  let stopped = 0;
  return { stream: { getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream, stopped: () => stopped };
}

function installContext(rate: number, opts: { throwOn16k?: boolean; failSource?: boolean; noWorklet?: boolean } = {}) {
  const requested: unknown[] = [];
  let processor: { onaudioprocess: ((e: unknown) => void) | null } | undefined;
  class FakeContext {
    sampleRate = rate; state = "suspended"; destination = {};
    audioWorklet = opts.noWorklet ? undefined : { addModule: async () => {} };
    constructor(o?: { sampleRate?: number }) {
      requested.push(o);
      if (opts.throwOn16k && o?.sampleRate === 16_000) throw new DOMException("not supported", "NotSupportedError");
    }
    resume = async () => { this.state = "running"; };
    createMediaStreamSource() { if (opts.failSource) throw new DOMException("different sample-rate", "NotSupportedError"); return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { processor = { onaudioprocess: null, connect() {}, disconnect() {} } as never; return processor; }
    close = async () => {};
  }
  w.AudioContext = FakeContext;
  w.AudioWorkletNode = undefined;
  return { requested, fire: (samples: Float32Array) => processor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } }) };
}

describe("startMicCapture", () => {
  test("never asks for a 16 kHz context and still delivers 16 kHz frames (ScriptProcessor path)", async () => {
    const env = installContext(48_000, { throwOn16k: true, noWorklet: true });
    const { stream } = fakeStream();
    const frames: Float32Array[] = [];
    const handle = await startMicCapture({ getStream: async () => stream, onFrame: (f) => frames.push(f) });
    env.fire(new Float32Array(4800));
    expect(env.requested.some((o) => (o as { sampleRate?: number } | undefined)?.sampleRate === 16_000)).toBe(false);
    expect(frames[0]?.length).toBe(1600);
    expect(handle.sampleRate).toBe(16_000);
  });

  test("a source that cannot be created is a setup error and releases the mic", async () => {
    installContext(48_000, { failSource: true });
    const { stream, stopped } = fakeStream();
    const err = await startMicCapture({ getStream: async () => stream, onFrame: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(MicCaptureError);
    expect(err.kind).toBe("setup");
    expect(stopped()).toBe(1);
  });

  test("getUserMedia NotAllowedError is denied; other rejections are setup", async () => {
    const denied = await startMicCapture({ getStream: async () => { throw new DOMException("no", "NotAllowedError"); }, onFrame: () => {} }).catch((e) => e);
    expect(denied.kind).toBe("denied");
    const other = await startMicCapture({ getStream: async () => { throw new DOMException("x", "AbortError"); }, onFrame: () => {} }).catch((e) => e);
    expect(other.kind).toBe("setup");
  });

  test("NotFoundError is not_found and NotReadableError is in_use", async () => {
    const missing = await startMicCapture({ getStream: async () => { throw new DOMException("x", "NotFoundError"); }, onFrame: () => {} }).catch((e) => e);
    expect(missing.kind).toBe("not_found");
    const busy = await startMicCapture({ getStream: async () => { throw new DOMException("x", "NotReadableError"); }, onFrame: () => {} }).catch((e) => e);
    expect(busy.kind).toBe("in_use");
  });

  test("an insecure page is reported as insecure", async () => {
    const secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    try {
      const err = await startMicCapture({ onFrame: () => {} }).catch((e) => e);
      expect(err.kind).toBe("insecure");
    } finally {
      if (secure) Object.defineProperty(window, "isSecureContext", secure); else delete (window as unknown as Record<string, unknown>).isSecureContext;
    }
  });
});

// Safari/WebKit defences (2026-10-17): the worklet is a same-origin file, a
// failing addModule falls back to ScriptProcessor, constraints are plain or
// ideal, the context is created with defaults, and a primed (in-tap) context
// is used.
describe("startMicCapture in WebKit-like conditions", () => {
  function webkitEnv(opts: { addModule?: (url: string) => Promise<void> } = {}) {
    const created: unknown[][] = [];
    const modules: string[] = [];
    let processor: { onaudioprocess: ((e: unknown) => void) | null } | undefined;
    let closed = 0;
    class Ctx {
      sampleRate = 48_000; state = "running"; destination = {};
      audioWorklet = { addModule: async (url: string) => { modules.push(url); await (opts.addModule?.(url)); } };
      constructor(...args: unknown[]) { created.push(args); }
      resume = async () => {};
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() { processor = { onaudioprocess: null, connect() {}, disconnect() {} } as never; return processor; }
      close = async () => { closed++; };
    }
    class Node { port = { onmessage: null as unknown }; constructor(public ctx: unknown, public name: string, public options: unknown) {} connect() {} disconnect() {} }
    w.AudioContext = Ctx;
    w.AudioWorkletNode = Node;
    return { created, modules, closed: () => closed, fire: (s: Float32Array) => processor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => s } }) };
  }

  test("loads the worklet from a same-origin file, never a blob: URL (CSP script-src 'self')", async () => {
    const env = webkitEnv();
    const { stream } = fakeStream();
    await startMicCapture({ getStream: async () => stream, onFrame: () => {} });
    expect(env.modules).toEqual(["/mic-worklet.js"]);
    expect(env.modules[0]?.startsWith("blob:")).toBe(false);
  });

  test("addModule rejecting falls back to ScriptProcessor and still delivers 16 kHz frames", async () => {
    const env = webkitEnv({ addModule: async () => { throw new DOMException("Unable to load a worklet's module", "AbortError"); } });
    const { stream } = fakeStream();
    const frames: Float32Array[] = [];
    await startMicCapture({ getStream: async () => stream, onFrame: (f) => frames.push(f) });
    env.fire(new Float32Array(4800));
    expect(frames[0]?.length).toBe(1600);
    const { micAttemptNotes } = await import("@/lib/voice/micDiagnostics");
    expect(micAttemptNotes().join(" ")).toContain("worklet load failed");
  });

  test("the AudioContext is created with defaults (no sampleRate or latencyHint options)", async () => {
    const env = webkitEnv();
    const { stream } = fakeStream();
    await startMicCapture({ getStream: async () => stream, onFrame: () => {} });
    expect(env.created).toEqual([[]]);
  });

  test("a context primed inside the tap is the one used (no second context)", async () => {
    const env = webkitEnv();
    primeMicAudio();
    expect(env.created.length).toBe(1);
    const { stream } = fakeStream();
    await startMicCapture({ getStream: async () => stream, onFrame: () => {} });
    expect(env.created.length).toBe(1);
  });

  test("a primed context is closed when capture fails before it is used", async () => {
    const env = webkitEnv();
    primeMicAudio();
    await startMicCapture({ getStream: async () => { throw new DOMException("no", "NotAllowedError"); }, onFrame: () => {} }).catch(() => {});
    expect(env.closed()).toBe(1);
  });

  test("when the worklet and the fallback both fail, the error names the step", async () => {
    webkitEnv({ addModule: async () => { throw new DOMException("bad", "NotSupportedError"); } });
    const proto = (w.AudioContext as { prototype: { createScriptProcessor: () => never } }).prototype;
    proto.createScriptProcessor = () => { throw new DOMException("nope", "NotSupportedError"); };
    const { stream, stopped } = fakeStream();
    const err = await startMicCapture({ getStream: async () => stream, onFrame: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(MicCaptureError);
    expect(err.step).toBe("script processor");
    expect(stopped()).toBe(1);
  });

  test("stop() is idempotent and releases the one stream exactly once", async () => {
    const env = webkitEnv();
    const { stream, stopped } = fakeStream();
    const handle = await startMicCapture({ getStream: async () => stream, onFrame: () => {} });
    handle.stop();
    handle.stop();
    expect(stopped()).toBe(1);
    expect(env.closed()).toBe(1);
  });
});

describe("openMicStream constraints", () => {
  const nav = navigator as unknown as { mediaDevices?: unknown };
  const saved = nav.mediaDevices;
  afterEach(() => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: saved }));
  function withGum(gum: (c: MediaStreamConstraints) => Promise<MediaStream>) {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: gum } });
  }

  test("processing flags are ideal only: no exact, channelCount, sampleRate or latency", async () => {
    const seen: MediaStreamConstraints[] = [];
    withGum(async (c) => { seen.push(c); return {} as MediaStream; });
    await openMicStream();
    const audio = seen[0]?.audio as Record<string, unknown>;
    expect(audio.echoCancellation).toEqual({ ideal: true });
    expect(audio.noiseSuppression).toEqual({ ideal: true });
    expect(audio.autoGainControl).toEqual({ ideal: true });
    for (const key of ["channelCount", "sampleRate", "latency", "deviceId"]) expect(key in audio).toBe(false);
    expect(JSON.stringify(audio)).not.toContain("exact");
  });

  test("an OverconstrainedError retries with plain { audio: true }", async () => {
    const seen: MediaStreamConstraints[] = [];
    withGum(async (c) => { seen.push(c); if (seen.length === 1) throw new DOMException("c", "OverconstrainedError"); return {} as MediaStream; });
    await openMicStream();
    expect(seen[1]).toEqual({ audio: true });
  });

  test("a chosen device stays exact and its failure is not papered over", async () => {
    const seen: MediaStreamConstraints[] = [];
    withGum(async (c) => { seen.push(c); throw new DOMException("c", "OverconstrainedError"); });
    await expect(openMicStream("abc")).rejects.toThrow();
    expect(seen.length).toBe(1);
    expect((seen[0]?.audio as { deviceId: unknown }).deviceId).toEqual({ exact: "abc" });
  });

  test("a permission error is never retried", async () => {
    let calls = 0;
    withGum(async () => { calls++; throw new DOMException("no", "NotAllowedError"); });
    await expect(openMicStream()).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
