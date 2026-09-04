import { describe, expect, test, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { WakeWordToggle } from "@/apps/chat/WakeWordToggle";

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

// `@testing-library/dom`'s global `screen` singleton is computed once at
// module-load time, before Bun's test preload finishes registering
// happy-dom's globals - it permanently falls back to a stub that throws.
// Every query here comes from render()'s own returned queries instead
// (ChatPage.test.tsx's own header comment already documents this).

afterEach(cleanup);

// happy-dom has no real getUserMedia/AudioContext/AudioWorklet, so this
// can only test what's actually testable without a real browser: the
// idle label, and the specific "permission denied" path (which mic-
// capture.ts's startMicCapture() rejects on BEFORE ever touching
// AudioContext, so stubbing getUserMedia alone is enough to exercise it
// precisely, without needing a fake audio pipeline at all). The full
// "mic granted, model loaded, listening" success path needs a real
// browser - covered by this slice's own live browser check instead.
describe("WakeWordToggle", () => {
  test("renders idle by default, not already listening", async () => {
    const { findByRole } = render(<WakeWordToggle onWakeDetected={() => {}} />);
    const button = await findByRole("button");
    expect(button.textContent).toBe("Wake word (experimental)");
    expect(button.getAttribute("aria-pressed")).toBe("false");
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
      const { findByRole, findByText } = render(<WakeWordToggle onWakeDetected={() => {}} />);
      const button = await findByRole("button");
      fireEvent.click(button);
      await findByText("Microphone access was denied.");
      await waitFor(async () => expect((await findByRole("button")).getAttribute("aria-pressed")).toBe("false"));
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
      const { findByRole, unmount } = render(<WakeWordToggle onWakeDetected={() => {}} />);
      const button = await findByRole("button");
      fireEvent.click(button); // start() begins: loadInstalledWakewords(), then getUserMedia()

      // loadInstalledWakewords() awaits a real fetch first - wait for
      // getUserMedia to actually be called (permission genuinely
      // pending) before unmounting, or resolveGetUserMedia below would
      // still be the stale no-op and never reach the real pending
      // promise at all.
      await waitFor(() => expect(getUserMediaCalled).toBe(true));
      unmount(); // gone before permission ever resolves

      // Permission resolves AFTER the component is already unmounted -
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
