import { describe, expect, test, afterEach } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWakeWord } from "@/apps/chat/useWakeWord";

afterEach(cleanup);

// happy-dom has no real getUserMedia/AudioContext/AudioWorklet, so this
// can only test what's actually testable without a real browser: the
// idle default, and the specific "permission denied" path (which mic-
// capture.ts's startMicCapture() rejects on BEFORE ever touching
// AudioContext, so stubbing getUserMedia alone is enough to exercise it
// precisely, without needing a fake audio pipeline at all). The full
// "mic granted, model loaded, listening" success path needs a real
// browser - covered by this slice's own live browser check instead.
describe("useWakeWord", () => {
  test("idle by default, not already listening", () => {
    const { result } = renderHook(() => useWakeWord({ onWakeDetected: () => {} }));
    expect(result.current.status).toBe("idle");
    expect(result.current.enabled).toBe(false);
  });

  test("a denied microphone permission shows a specific, actionable message", async () => {
    const original = navigator.mediaDevices?.getUserMedia;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
      },
    });
    try {
      const { result } = renderHook(() => useWakeWord({ onWakeDetected: () => {} }));
      await act(async () => {
        await result.current.toggle();
      });
      await waitFor(() => expect(result.current.error).toBe("Microphone access was denied."));
      expect(result.current.enabled).toBe(false);
      expect(result.current.status).toBe("error");
    } finally {
      if (original) {
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: original } });
      }
    }
  });

  // A code review (2026-09-04) found the unmount cleanup effect never
  // bumped requestIdRef, unlike stop() - an in-flight start() (awaiting
  // startMicCapture(), a real await) that resolved AFTER the component
  // unmounted still installed a live mic stream nothing was left to stop.
  test("unmounting mid-start stops the mic once permission resolves late, not after", async () => {
    // Hermetic: the hook's models, loop and capture are injected, so no Stack, fetch, AudioContext or mic is touched.
    // The shared mic stream's own 10 s grace before its tracks stop is micStream.test.ts's subject, not this race's.
    let resolveCapture: ((handle: { stop: () => void; sampleRate: number }) => void) | null = null;
    let captureStarted = false;
    const stops: string[] = [];
    const loopEnabled: boolean[] = [];
    const { unmount, result } = renderHook(() => useWakeWord({
      onWakeDetected: () => {},
      loadModels: async () => [],
      createLoop: () => ({ setEnabled: (on: boolean) => { loopEnabled.push(on); }, pushFrame: () => {}, onError: null }) as never,
      startCapture: () => {
        captureStarted = true;
        return new Promise((resolve) => { resolveCapture = resolve; });
      },
    }));
    void result.current.toggle(); // start() begins and waits on permission, deliberately not awaited
    await waitFor(() => expect(captureStarted).toBe(true));
    unmount(); // gone before permission ever resolves

    // Permission resolves AFTER the hook is unmounted: without the fix this installs a live capture nothing can stop.
    resolveCapture!({ stop: () => { stops.push("mic-stopped"); }, sampleRate: 16_000 });
    await waitFor(() => expect(stops).toEqual(["mic-stopped"]));
    expect(loopEnabled.at(-1)).toBe(false);
  });
});
