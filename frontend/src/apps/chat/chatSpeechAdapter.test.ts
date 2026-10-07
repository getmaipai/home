import { afterEach, describe, expect, mock, test } from "bun:test";
import { createChatSpeechAdapter } from "@/apps/chat/chatSpeechAdapter";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

afterEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

describe("chat speech adapter", () => {
  test("cancelling stops playback and aborts the active request immediately", async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;
    let requestSignal: AbortSignal | undefined;
    let releaseRequest = () => {};
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return requestGate.then(() => new Response(new Uint8Array(), { status: 200, headers: { "content-type": "audio/wav" } }));
    }) as unknown as typeof fetch;

    try {
      const utterance = createChatSpeechAdapter().speak("first reply");
      expect(requestSignal?.aborted).toBe(false);
      utterance.cancel();
      expect(requestSignal?.aborted).toBe(true);
      expect(utterance.status).toEqual({ type: "ended", reason: "cancelled" });

      releaseRequest();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(utterance.status).toEqual({ type: "ended", reason: "cancelled" });
    } finally {
      releaseRequest();
      globalThis.fetch = originalFetch;
    }
  });

  test("a superseded utterance's late failure cannot replace its cancelled state", async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;
    let releaseRequest = () => {};
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    globalThis.fetch = mock(() => requestGate.then(() => Promise.reject(new Error("late TTS failure")))) as unknown as typeof fetch;

    try {
      const utterance = createChatSpeechAdapter().speak("first reply");
      utterance.cancel();
      releaseRequest();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(utterance.status).toEqual({ type: "ended", reason: "cancelled" });
    } finally {
      releaseRequest();
      globalThis.fetch = originalFetch;
    }
  });
});
