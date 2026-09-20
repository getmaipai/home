import { describe, expect, test, afterEach } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWakeWord } from "@/apps/chat/useWakeWord";

afterEach(cleanup);

// A minimal fake of the Web Audio surface mic-capture.ts's
// startMicCapture() actually touches (AudioContext, audioWorklet,
// AudioWorkletNode, MediaStreamSource) - happy-dom has none of it for
// real. Just enough to let startMicCapture() run to completion without
// throwing, so the unmount-race test below can reach the actual "mic
// granted" success path rather than always hitting the catch block.
class FakeAudioWorkletNode {
  port: { onmessage: ((e: MessageEvent) => void) | null } = { onmessage: null };
  disconnect() {}
}
class FakeAudioContext {
  sampleRate = 16_000;
  audioWorklet = { addModule: async () => {} };
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  close() {
    return Promise.resolve();
  }
}

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
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    const originalWorkletNode = (globalThis as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeAudioWorkletNode;

    let resolveGetUserMedia: ((stream: MediaStream) => void) | null = null;
    let getUserMediaCalled = false;
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          getUserMediaCalled = true;
          return new Promise<MediaStream>((resolve) => (resolveGetUserMedia = resolve));
        },
      },
    });

    const stopSpy: string[] = [];
    const trackStop = () => stopSpy.push("track-stopped");

    try {
      const { result, unmount } = renderHook(() => useWakeWord({ onWakeDetected: () => {} }));
      void result.current.toggle(); // start() begins: loadInstalledWakewords(), then getUserMedia() - deliberately not awaited, the same fire-and-forget shape fireEvent.click() had

      // loadInstalledWakewords() awaits a real fetch first - wait for
      // getUserMedia to actually be called (permission genuinely
      // pending) before unmounting, or resolveGetUserMedia below would
      // still be the stale no-op and never reach the real pending
      // promise at all.
      await waitFor(() => expect(getUserMediaCalled).toBe(true));
      unmount(); // gone before permission ever resolves

      // Permission resolves AFTER the hook is already unmounted -
      // without the fix, this installs a live, unstoppable mic stream.
      resolveGetUserMedia!({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream);
      await waitFor(() => expect(stopSpy).toEqual(["track-stopped"]));
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
      (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = originalWorkletNode;
    }
  });
});
