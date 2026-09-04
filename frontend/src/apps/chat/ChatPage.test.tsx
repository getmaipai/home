import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { ChatPage } from "@/apps/chat/ChatPage";
import type { ConversationTurnRow, Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(): Roster {
  return {
    id: "person-abc123",
    display_name: "Jesse",
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    hasSecret: true,
  };
}

function makeRow(id: string, replyText: string): ConversationTurnRow {
  return {
    id,
    personId: "person-abc123",
    surface: "chat",
    userText: `question ${id}`,
    replyText,
    source: "model",
    skillId: null,
    safetyFlagged: false,
    safetyAction: "allow",
    minorSpeaker: false,
    createdAt: "2026-09-04T00:00:00.000Z",
  };
}

/** happy-dom (tests/preload.ts) has no Web Audio API at all - a real gap
 * this session found live (2026-09-04) is unrelated to: this stub exists
 * purely so streamingWavPlayer.ts's constructor doesn't throw in tests,
 * not to fake around a real environment limitation. */
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createBuffer(_numChannels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  createBufferSource() {
    const source: {
      buffer: unknown;
      onended: (() => void) | null;
      connect: () => void;
      start: () => void;
    } = {
      buffer: null,
      onended: null,
      connect: () => {},
      start: () => {
        setTimeout(() => source.onended?.(), 0);
      },
    };
    return source;
  }
  close() {
    return Promise.resolve();
  }
}

/** Stubs the two browser primitives handlePlay actually drives (fetch,
 * AudioContext) rather than mocking the api.ts/streamingWavPlayer.ts
 * modules themselves - the same "stub the network, not an already-
 * imported module" reasoning ModelsSection.test.tsx and
 * ChangeSecretSection.test.tsx already establish (mock.module() doesn't
 * reliably re-bind after a static import). The first /api/tts call is
 * held open until releaseFirst() is called and then REJECTS (simulating
 * a network failure that only surfaces after the person has already
 * moved on to a second reply) - the exact shape of the real live bug
 * (2026-09-04): a stale rejection landing on the wrong, already-
 * superseded message. */
function stubEnvironment(rows: ConversationTurnRow[]) {
  const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;

  const originalFetch = globalThis.fetch;
  let ttsCallCount = 0;
  let releaseFirst = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/conversations")) {
      return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
    }
    if (url.includes("/api/tts")) {
      ttsCallCount++;
      if (ttsCallCount === 1) {
        return firstGate.then(() => Promise.reject(new Error("simulated late network failure")));
      }
      // Second and later calls succeed immediately with a minimal, real
      // 44-byte WAV header (no PCM samples needed - the test only cares
      // that this call's own state reaches a stable, non-error outcome).
      const header = new Uint8Array(44);
      const view = new DataView(header.buffer);
      const writeString = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
      };
      writeString(0, "RIFF");
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 24_000, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      return Promise.resolve(
        new Response(header, { status: 200, headers: { "content-type": "audio/wav" } }),
      );
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;

  return {
    releaseFirst,
    restore: () => {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    },
  };
}

describe("ChatPage Listen button", () => {
  // The real live bug (2026-09-04, docs/dev.md's tts-role entry): a
  // superseded "Listen" call's own eventual failure landed on the wrong
  // message, marking a reply "Couldn't play" that the person had already
  // moved on from. Reproduces that exact interleaving (click first,
  // click second before the first settles, THEN let the first fail)
  // against the real handlePlay/StreamingWavPlayer code.
  test("a superseded Listen call's late failure never marks the wrong message as errored", async () => {
    const rows = [makeRow("row-1", "first reply"), makeRow("row-2", "second reply")];
    const env = stubEnvironment(rows);
    try {
      const { findAllByText, getAllByText, queryAllByText } = render(<ChatPage person={makePerson()} />);
      const listenButtons = await findAllByText("Listen");
      expect(listenButtons).toHaveLength(2);

      // Click the first reply's Listen button - its /api/tts call is
      // held open by env's gate, so this is still in flight below.
      await act(async () => {
        fireEvent.click(listenButtons[0]!);
      });
      await waitFor(() => expect(getAllByText("Loading…")).toHaveLength(1));

      // Click the second reply's Listen button before the first settles
      // - the real race. This bumps the shared request token past the
      // first call's.
      const secondListenButton = (await findAllByText("Listen"))[0]!;
      await act(async () => {
        fireEvent.click(secondListenButton);
      });

      // Now let the first call's gate open - it rejects from here.
      await act(async () => {
        env.releaseFirst();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // The FIRST message must never show the stale-rejection failure
      // mode this bug produced.
      expect(queryAllByText("Couldn't play. Try again.")).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  // A code review (2026-09-04) found `onEnded` only cleared `playingId`,
  // not `loadingId`: a reply whose audio has zero playable frames never
  // fires `onFirstAudio` at all (streamingWavPlayer.ts's `finish()` calls
  // `onEnded` directly when nothing was ever scheduled), so `loadingId`
  // stayed stuck on that message forever - the button disabled on
  // "Loading…" with no way to retry short of a reload.
  test("a reply with zero playable audio frames settles back to Listen, not stuck Loading", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;

    // A real, valid 44-byte WAV header with NO PCM samples after it - the
    // exact shape that makes streamingWavPlayer.ts schedule zero buffers.
    const header = new Uint8Array(44);
    const view = new DataView(header.buffer);
    const writeString = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    writeString(0, "RIFF");
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24_000, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, 0, true);

    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(
          new Response(JSON.stringify([makeRow("row-1", "an almost-silent reply")]), { status: 200 }),
        );
      }
      if (url.includes("/api/tts")) {
        return Promise.resolve(new Response(header, { status: 200, headers: { "content-type": "audio/wav" } }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByText, queryByText } = render(<ChatPage person={makePerson()} />);
      const listenButton = await findByText("Listen");
      await act(async () => {
        fireEvent.click(listenButton);
      });
      await waitFor(() => expect(queryByText("Listen")).not.toBeNull());
      expect(queryByText("Loading…")).toBeNull();
      expect(queryByText("Playing…")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });
});

