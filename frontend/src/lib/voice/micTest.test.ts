import { afterEach, describe, expect, test } from "bun:test";
import { micTestText, runMicTest, type MicTestResult } from "@/lib/voice/micTest";

const w = window as unknown as Record<string, unknown>;
const saved = { ctx: w.AudioContext, node: w.AudioWorkletNode, fetch: globalThis.fetch };
const savedDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
afterEach(() => {
  if (savedDevices) Object.defineProperty(navigator, "mediaDevices", savedDevices); else delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  w.AudioContext = saved.ctx; w.AudioWorkletNode = saved.node; globalThis.fetch = saved.fetch; });

describe("runMicTest", () => {
  test("reports FAIL for the worklet step with the browser's error name, and keeps going", async () => {
    const order: string[] = [];
    class Ctx {
      sampleRate = 48_000; state = "running"; destination = {};
      audioWorklet = { addModule: async () => { throw new DOMException("Unable to load a worklet's module", "AbortError"); } };
      constructor() { order.push("context"); }
      resume = async () => {};
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
      createAnalyser() { return { fftSize: 0, connect() {}, disconnect() {}, getByteTimeDomainData: (d: Uint8Array) => d.fill(160) }; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() {
        const p = { onaudioprocess: null as null | (() => void), connect() {}, disconnect() {} };
        setTimeout(() => p.onaudioprocess?.(), 10);
        return p;
      }
      close = async () => {};
    }
    w.AudioContext = Ctx;
    w.AudioWorkletNode = class {};
    globalThis.fetch = (async () => new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const track = { label: "Mic", readyState: "live", muted: false, getSettings: () => ({ sampleRate: 48_000 }), stop() {} };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => { order.push("getUserMedia"); return Promise.resolve(stream); } } });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const results: MicTestResult[] = [];
    await runMicTest((r) => results.push(r));
    expect(order.slice(0, 2)).toEqual(["getUserMedia", "context"]); // both begin inside the click
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId["gum-plain"]?.status).toBe("pass");
    expect(byId["worklet-file"]?.status).toBe("fail");
    expect(byId["worklet-file"]?.detail).toContain("web page");
    expect(byId["worklet"]?.status).toBe("fail");
    expect(byId["worklet"]?.detail).toContain("AbortError");
    expect(byId["script-processor"]?.status).toBe("pass");
    expect(byId["resampler"]?.status).toBe("pass");
    expect(byId["meter"]?.status).toBe("pass");
    expect(micTestText(results)).toContain("FAIL  AudioWorklet addModule and node: AbortError");
  });
});
