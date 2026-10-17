import { afterEach, describe, expect, test } from "bun:test";
import { MicCaptureError, startMicCapture } from "@/lib/voice/mic-capture";

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
