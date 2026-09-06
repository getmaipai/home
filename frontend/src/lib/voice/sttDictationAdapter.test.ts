import { describe, expect, test, mock } from "bun:test";
import type { DictationAdapter } from "@assistant-ui/react";
import { createSttDictationAdapter } from "@/lib/voice/sttDictationAdapter";
import type { SttSocket, SttSocketHandlers } from "@/lib/voice/sttSocket";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

// The same minimal Web Audio fake WakeWordToggle.test.tsx already uses
// (mic-capture.ts's real startMicCapture() is exercised here too, since
// it isn't injectable the way the socket is - only the message-handling
// logic below is this file's own concern, not real audio capture,
// covered instead by a live browser check per that file's own note).
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

function withFakeAudioEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  const originalWorkletNode = (globalThis as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  const originalMediaDevices = navigator.mediaDevices;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeAudioWorkletNode;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] } as unknown as MediaStream) },
  });
  return run().finally(() => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = originalWorkletNode;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
  });
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A controllable fake `SttSocket`: the test drives `emit()` directly
 * (bypassing WebSocket/the mock fixture replay entirely), so every
 * assertion below is about how the adapter reacts to a given server
 * message, not about timing or transport. */
function fakeSocketFactory(): { createSocket: (handlers: SttSocketHandlers) => SttSocket; emit: (m: Parameters<SttSocketHandlers["onMessage"]>[0]) => void; closed: boolean } {
  let capturedHandlers: SttSocketHandlers | null = null;
  const state = {
    createSocket: (handlers: SttSocketHandlers) => {
      capturedHandlers = handlers;
      return { sendAudio: () => {}, close: () => (state.closed = true) };
    },
    emit: (m: Parameters<SttSocketHandlers["onMessage"]>[0]) => capturedHandlers?.onMessage(m),
    closed: false,
  };
  return state;
}

describe("createSttDictationAdapter", () => {
  test("a denied microphone ends the session with reason error, no crash", async () => {
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")) },
    });
    try {
      const fake = fakeSocketFactory();
      const adapter = createSttDictationAdapter({
        createSocket: fake.createSocket,
        turnSchedulerRef: { current: null },
        onFinalReady: () => {},
      });
      const session = adapter.listen();
      // Mic capture only starts once the server says `ready` (a code
      // review, 2026-09-06: not in parallel with the socket connecting) -
      // this test's own "denied permission" outcome needs that signal
      // first, the same as a real session would get it.
      fake.emit({ type: "ready" });
      await waitFor(10);
      expect(session.status).toEqual({ type: "ended", reason: "error" });
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
    }
  });

  test("ready moves the session to running and fires onSpeechStart", async () => {
    await withFakeAudioEnv(async () => {
      const fake = fakeSocketFactory();
      const adapter = createSttDictationAdapter({
        createSocket: fake.createSocket,
        turnSchedulerRef: { current: null },
        onFinalReady: () => {},
      });
      const session = adapter.listen();
      const started = mock(() => {});
      session.onSpeechStart(started);
      fake.emit({ type: "ready" });
      expect(session.status).toEqual({ type: "running" });
      expect(started).toHaveBeenCalledTimes(1);
    });
  });

  test("partial results forward as non-final, final results forward as final and trigger onFinalReady", async () => {
    await withFakeAudioEnv(async () => {
      const fake = fakeSocketFactory();
      const onFinalReady = mock(() => {});
      const adapter = createSttDictationAdapter({ createSocket: fake.createSocket, turnSchedulerRef: { current: null }, onFinalReady });
      const session = adapter.listen();
      const results: Array<{ transcript: string; isFinal?: boolean }> = [];
      session.onSpeech((r) => results.push(r));

      fake.emit({ type: "partial", text: "turn the" });
      expect(results).toEqual([{ transcript: "turn the", isFinal: false }]);

      fake.emit({ type: "final", text: "turn the lights on" });
      expect(results).toEqual([
        { transcript: "turn the", isFinal: false },
        { transcript: "turn the lights on", isFinal: true },
      ]);
      expect(onFinalReady).toHaveBeenCalledTimes(1);
      expect(session.status).toEqual({ type: "ended", reason: "stopped" });
      expect(fake.closed).toBe(true);
    });
  });

  test("a real send reentrantly cancelling this session from inside onFinalReady still reports 'stopped', not 'cancelled'", async () => {
    // The regression this guards: @assistant-ui/core's real
    // aui.composer.send() (what onFinalReady() reaches via ChatPage.tsx's
    // SttAutoSend) calls this session's own cancel() synchronously,
    // before returning - verified against the installed library source,
    // not assumed. An earlier version called onFinalReady() BEFORE its
    // own finish("stopped", ...), so that reentrant cancel() ran
    // finish("cancelled") first and the real one landed second, a no-op
    // behind `if (ended) return`: every successful push-to-talk turn
    // reported its own end reason backwards (a code review, 2026-09-06).
    await withFakeAudioEnv(async () => {
      const fake = fakeSocketFactory();
      const sessionRef: { current: ReturnType<DictationAdapter["listen"]> | null } = { current: null };
      const adapter = createSttDictationAdapter({
        createSocket: fake.createSocket,
        turnSchedulerRef: { current: null },
        onFinalReady: () => sessionRef.current?.cancel(), // mimics aui.composer.send()'s own reentrant cancel()
      });
      sessionRef.current = adapter.listen();
      fake.emit({ type: "final", text: "turn the lights on" });
      expect(sessionRef.current.status).toEqual({ type: "ended", reason: "stopped" });
    });
  });

  test("no_speech ends the session cleanly without triggering a send", async () => {
    await withFakeAudioEnv(async () => {
      const fake = fakeSocketFactory();
      const onFinalReady = mock(() => {});
      const adapter = createSttDictationAdapter({ createSocket: fake.createSocket, turnSchedulerRef: { current: null }, onFinalReady });
      const session = adapter.listen();
      fake.emit({ type: "no_speech" });
      expect(session.status).toEqual({ type: "ended", reason: "stopped" });
      expect(onFinalReady).not.toHaveBeenCalled();
    });
  });

  test("VAD speech during an active reply stops it - barge-in", async () => {
    await withFakeAudioEnv(async () => {
      const fake = fakeSocketFactory();
      const scheduler = new SentenceSpeechScheduler();
      const stopSpy = mock(scheduler.stop.bind(scheduler));
      scheduler.stop = stopSpy;
      const adapter = createSttDictationAdapter({
        createSocket: fake.createSocket,
        turnSchedulerRef: { current: scheduler },
        onFinalReady: () => {},
      });
      adapter.listen();
      fake.emit({ type: "vad", speaking: true });
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("VAD speaking: false never stops playback", async () => {
    await withFakeAudioEnv(async () => {
      const fake = fakeSocketFactory();
      const scheduler = new SentenceSpeechScheduler();
      const stopSpy = mock(scheduler.stop.bind(scheduler));
      scheduler.stop = stopSpy;
      const adapter = createSttDictationAdapter({
        createSocket: fake.createSocket,
        turnSchedulerRef: { current: scheduler },
        onFinalReady: () => {},
      });
      adapter.listen();
      fake.emit({ type: "vad", speaking: false });
      expect(stopSpy).not.toHaveBeenCalled();
    });
  });

  test("stop() ends the session and closes the socket", async () => {
    await withFakeAudioEnv(async () => {
      const fake = fakeSocketFactory();
      const adapter = createSttDictationAdapter({ createSocket: fake.createSocket, turnSchedulerRef: { current: null }, onFinalReady: () => {} });
      const session = adapter.listen();
      await session.stop();
      expect(session.status).toEqual({ type: "ended", reason: "stopped" });
      expect(fake.closed).toBe(true);
    });
  });
});
