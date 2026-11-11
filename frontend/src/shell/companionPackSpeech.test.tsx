import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { __resetPronouncingForTests } from "@/lib/packSpeech";
import { publishSpeechTap, type SpeechSource } from "@/lib/speechTap";

const speechDictionary = mock(async () => new Response(JSON.stringify({ hello: "HH AH L OW" }), { headers: { "content-type": "application/json" } }));
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/api/speech/cmu") ? speechDictionary() : realFetch(input, init)) as typeof fetch;
const { usePackSpeech } = await import("@/shell/companionPack");

const RATE = 24_000;
function voice(seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < out.length; i++) { const t = i / RATE; out[i] = Math.sin(t * 2 * Math.PI * 180) * (Math.sin(t * 2 * Math.PI * 3) > -0.2 ? 0.4 : 0.02); }
  return out;
}
function source(): SpeechSource & { now: number } {
  const s = { now: 0, speechClock() { return s.now; } };
  return s;
}

afterEach(() => { cleanup(); __resetPronouncingForTests(); speechDictionary.mockClear(); });

describe("usePackSpeech", () => {
  test("gives the player cues and a monotone audio clock while a reply speaks, and clears at once on stop", async () => {
    const { result } = renderHook(() => usePackSpeech(true));
    expect(result.current).toBeUndefined();
    const voiceSource = source();
    act(() => {
      publishSpeechTap({ type: "sentence", source: voiceSource, sentence: 0, text: "Hello there." });
      publishSpeechTap({ type: "audio", source: voiceSource, sentence: 0, samples: voice(1), rate: RATE, at: 0 });
    });
    expect(result.current?.cues.length).toBeGreaterThan(2);
    const reads: number[] = [];
    for (const t of [0, 0.1, 0.5]) { voiceSource.now = t; reads.push(result.current!.clock()); }
    expect(reads).toEqual([0, 0.1, 0.5]);
    await act(async () => { await Promise.resolve(); });
    expect(speechDictionary).toHaveBeenCalledTimes(1);
    act(() => { publishSpeechTap({ type: "sentenceEnd", source: voiceSource, sentence: 0 }); });
    expect(result.current?.joinAt).toBeDefined();
    act(() => { publishSpeechTap({ type: "stop", source: voiceSource }); });
    expect(result.current).toBeUndefined();
  });

  test("a stop from an older reply does not clear the reply that replaced it", () => {
    const { result } = renderHook(() => usePackSpeech(true));
    const first = source(); const second = source();
    act(() => { publishSpeechTap({ type: "sentence", source: first, sentence: 0, text: "One." }); publishSpeechTap({ type: "audio", source: first, sentence: 0, samples: voice(0.6), rate: RATE, at: 0 }); });
    act(() => { publishSpeechTap({ type: "sentence", source: second, sentence: 0, text: "Two." }); publishSpeechTap({ type: "audio", source: second, sentence: 0, samples: voice(0.6), rate: RATE, at: 0 }); });
    act(() => { publishSpeechTap({ type: "stop", source: first }); });
    expect(result.current).toBeDefined();
  });

  test("does nothing and fetches nothing for a companion without a pack", () => {
    const { result } = renderHook(() => usePackSpeech(false));
    const s = source();
    act(() => { publishSpeechTap({ type: "sentence", source: s, sentence: 0, text: "Hi." }); publishSpeechTap({ type: "audio", source: s, sentence: 0, samples: voice(0.5), rate: RATE, at: 0 }); });
    expect(result.current).toBeUndefined();
    expect(speechDictionary).not.toHaveBeenCalled();
  });
});
