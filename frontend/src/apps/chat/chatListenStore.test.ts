import { describe, expect, test, mock, afterEach } from "bun:test";
import { useChatListenStore } from "@/apps/chat/chatListenStore";
import { FakeAudioContext, fakeWavBody } from "../../../tests/fakeAudioContext";

afterEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

function zeroFrameWavBody(): Uint8Array {
  const header = fakeWavBody();
  const view = new DataView(header.buffer);
  view.setUint32(40, 0, true); // "data" chunk size: zero playable frames
  return header;
}

describe("chatListenStore", () => {
  // The real live bug (2026-09-04, docs/dev.md's tts-role entry): a
  // superseded "Listen" call's own eventual failure landed on the wrong
  // message, marking a reply "Couldn't play" that the person had already
  // moved on from. Reproduces the exact interleaving (click first, click
  // second before the first settles, THEN let the first fail).
  test("a superseded Listen call's late failure never marks the wrong message as errored", async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let ttsCallCount = 0;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/tts")) {
        ttsCallCount++;
        if (ttsCallCount === 1) return firstGate.then(() => Promise.reject(new Error("simulated late network failure")));
        return Promise.resolve(new Response(fakeWavBody().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "audio/wav" } }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      useChatListenStore.getState().play("row-1-reply", "first reply");
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(useChatListenStore.getState().loadingId).toBe("row-1-reply");

      // The real race: click the second message's Listen before the
      // first settles - this bumps the shared request token past it.
      useChatListenStore.getState().play("row-2-reply", "second reply");
      await new Promise((resolve) => setTimeout(resolve, 5));

      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 20));

      // The FIRST message must never show the stale-rejection failure.
      expect(useChatListenStore.getState().errorId).not.toBe("row-1-reply");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // A code review (2026-09-04) found `onEnded` only cleared `playingId`,
  // not `loadingId`: a reply whose audio has zero playable frames never
  // fires `onFirstAudio` at all (streamingWavPlayer.ts's `finish()` calls
  // `onEnded` directly when nothing was ever scheduled), so `loadingId`
  // stayed stuck on that message forever.
  test("a reply with zero playable audio frames settles back to idle, not stuck loading", async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/tts")) {
        return Promise.resolve(new Response(zeroFrameWavBody().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "audio/wav" } }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      useChatListenStore.getState().play("row-1-reply", "an almost-silent reply");
      await new Promise((resolve) => setTimeout(resolve, 20));
      const state = useChatListenStore.getState();
      expect(state.loadingId).toBeNull();
      expect(state.playingId).toBeNull();
      expect(state.errorId).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
