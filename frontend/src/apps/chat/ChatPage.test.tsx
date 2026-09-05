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
    pluginId: null,
    safetyFlagged: false,
    safetyAction: "allow",
    minorSpeaker: false,
    createdAt: "2026-09-04T00:00:00.000Z",
  };
}

/** happy-dom (tests/preload.ts) has no Web Audio API at all - a real gap
 * this session found live (2026-09-04) is unrelated to: this stub exists
 * purely so streamingWavPlayer.ts's/sentenceSpeechScheduler.ts's
 * constructors don't throw in tests, not to fake around a real
 * environment limitation. `decodeAudioData` (sentenceSpeechScheduler.ts's
 * own dependency, unlike streamingWavPlayer.ts's hand-rolled decode) just
 * returns a fixed-duration fake buffer - nothing in these tests asserts
 * on real decoded sample data. */
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createBuffer(_numChannels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  decodeAudioData(_arrayBuffer: ArrayBuffer) {
    return Promise.resolve({ duration: 0.1 });
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

function minimalWavHeader() {
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
  return header;
}

/** Builds a real newline-delimited-JSON response body matching
 * POST /api/turn/stream's real wire shape (wire.ts's TurnStreamEvent) -
 * one JSON object per line, split into individual chunks fed to the
 * ReadableStream one at a time (not one giant write) so the frontend's
 * own chunk-by-chunk reader loop is exercised for real. */
function ndjsonStream(lines: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      controller.close();
    },
  });
}

/** Same shape as ndjsonStream, but enqueues `firstLines` immediately and
 * holds `restLines` back until `release()` is called - lets a test
 * inspect state genuinely in between the two batches, which a fully
 * synchronous stream (everything enqueued in one `start()`) never
 * allows: by the time any `findBy`/`waitFor` resolves against it, the
 * whole thing has already drained. */
function staggeredNdjsonStream(firstLines: unknown[], restLines: unknown[]): { stream: ReadableStream<Uint8Array>; release: () => void } {
  const encoder = new TextEncoder();
  let release = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of firstLines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      release = () => {
        for (const line of restLines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        controller.close();
      };
    },
  });
  return { stream, release };
}

describe("ChatPage streaming send", () => {
  // The real end-to-end ask (2026-09-04, Jesse: "check our old project -
  // we didnt do autoplay - we streamed"): sending a message must show the
  // reply's text arriving progressively (not all at once after the whole
  // thing finishes) and must speak each completed sentence via
  // POST /api/tts as soon as it's ready, with no "Listen" click involved
  // at all for a fresh reply.
  test("a sent message's reply text streams in and each sentence is spoken automatically", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;

    const ttsCalls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        const stream = ndjsonStream([
          { type: "delta", text: "First sentence." },
          { type: "delta", text: " Second sentence." },
          {
            type: "done",
            value: {
              reply: { text: "First sentence. Second sentence." },
              source: "model",
              safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
            },
          },
        ]);
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      if (url.includes("/api/tts")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        ttsCalls.push(body.text ?? "");
        return Promise.resolve(
          new Response(minimalWavHeader(), { status: 200, headers: { "content-type": "audio/wav" } }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "hi there" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      // The full, final reply text renders once the stream completes.
      await findByText("First sentence. Second sentence.");
      // Each completed sentence was spoken as its own /api/tts call, not
      // one call for the whole reply after the fact.
      await waitFor(() => expect(ttsCalls).toEqual(["First sentence.", "Second sentence."]));
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  // A "spoken_cue" event (backend/src/wire.ts, 2026-09-05: fires at most
  // once when the model's own first token is genuinely slow) is spoken
  // but never displayed and never counted as part of the reply - the
  // whole reason it exists is to fill dead air, not to become a message.
  test("a spoken_cue plays before the real reply and never appears in the chat bubble", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;

    const ttsCalls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        const stream = ndjsonStream([
          { type: "spoken_cue", text: "One sec." },
          { type: "delta", text: "The real answer." },
          {
            type: "done",
            value: {
              reply: { text: "The real answer.", speech: "The real answer." },
              source: "model",
              safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
            },
          },
        ]);
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      if (url.includes("/api/tts")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        ttsCalls.push(body.text ?? "");
        return Promise.resolve(
          new Response(minimalWavHeader(), { status: 200, headers: { "content-type": "audio/wav" } }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText, queryByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "hi there" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await findByText("The real answer.");
      // The cue was spoken (first, ahead of the real sentence)...
      await waitFor(() => expect(ttsCalls).toEqual(["One sec.", "The real answer."]));
      // ...but never rendered anywhere in the thread.
      expect(queryByText("One sec.")).toBeNull();
      expect(queryByText((content) => content.includes("One sec."))).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  // A code review (2026-09-05) found the "MaiPai is thinking…" spinner
  // was dismissed on ANY first stream event, including a spoken_cue -
  // exactly in the slow-first-token case the cue exists for, the spinner
  // vanished while the bubble was still empty (spoken_cue never touches
  // `visible`), leaving nothing on screen while "One sec." played out
  // loud. Uses staggeredNdjsonStream to genuinely inspect the state
  // in between the cue and the real delta - a fully synchronous stream
  // drains before any assertion could observe the gap.
  test("the thinking spinner stays up through a spoken_cue - it only clears once real content arrives", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;

    const { stream, release } = staggeredNdjsonStream(
      [{ type: "spoken_cue", text: "One sec." }],
      [
        { type: "delta", text: "The real answer." },
        {
          type: "done",
          value: {
            reply: { text: "The real answer.", speech: "The real answer." },
            source: "model",
            safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
          },
        },
      ],
    );
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      if (url.includes("/api/tts")) {
        return Promise.resolve(new Response(minimalWavHeader(), { status: 200, headers: { "content-type": "audio/wav" } }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText, queryByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "hi there" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      // Only the cue has arrived so far - the spinner must still be up,
      // and the bubble still empty.
      await findByText("MaiPai is thinking…");
      expect(queryByText("The real answer.")).toBeNull();

      await act(async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // Real content arrived - the spinner is gone and the answer shows.
      await findByText("The real answer.");
      expect(queryByText("MaiPai is thinking…")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  test("a <think> block never renders or gets spoken - only the real answer after it", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;

    const ttsCalls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        const stream = ndjsonStream([
          { type: "delta", text: "<think>reasoning about the" },
          { type: "delta", text: " answer here</think>The real answer." },
          {
            type: "done",
            value: {
              reply: { text: "<think>reasoning about the answer here</think>The real answer." },
              source: "model",
              safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
            },
          },
        ]);
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      if (url.includes("/api/tts")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        ttsCalls.push(body.text ?? "");
        return Promise.resolve(
          new Response(minimalWavHeader(), { status: 200, headers: { "content-type": "audio/wav" } }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText, queryByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "what's the answer" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await findByText("The real answer.");
      expect(queryByText(/reasoning about/)).toBeNull();
      expect(queryByText(/<think>/)).toBeNull();
      await waitFor(() => expect(ttsCalls).toEqual(["The real answer."]));
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  // A code review (2026-09-04) found the opening <think> tag was only
  // ever detected if it arrived whole in one delta - real token-level
  // streaming can split it across several (a tokenizer's own boundaries
  // rarely align with a tag's characters), and the old check locked in
  // "not a think block" the moment the FIRST delta alone didn't match the
  // full tag. Reproduces that exact real shape: the tag split character
  // by character, not conveniently whole.
  test("a <think> tag split across many small deltas is still recognized and never leaks", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;

    const ttsCalls: string[] = [];
    const fullText = "<think>reasoning about the answer here</think>The real answer.";
    // One character at a time - the real worst case for boundary
    // detection, worse than any real tokenizer would actually produce.
    const deltas = fullText.split("").map((char) => ({ type: "delta", text: char }));

    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        const stream = ndjsonStream([
          ...deltas,
          {
            type: "done",
            value: {
              reply: { text: fullText },
              source: "model",
              safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
            },
          },
        ]);
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      if (url.includes("/api/tts")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        ttsCalls.push(body.text ?? "");
        return Promise.resolve(
          new Response(minimalWavHeader(), { status: 200, headers: { "content-type": "audio/wav" } }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText, queryByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "what's the answer" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await findByText("The real answer.");
      expect(queryByText(/reasoning about/)).toBeNull();
      expect(queryByText(/<think>/)).toBeNull();
      await waitFor(() => expect(ttsCalls).toEqual(["The real answer."]));
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  // A code review (2026-09-04) found the original <think> detector only
  // ever searched for the opening tag at the very START of the unresolved
  // remainder: real text arriving ahead of the tag within the same delta
  // (a network chunk batching a lead-in phrase together with the start of
  // a reasoning block) got the tag, and everything after it, dumped
  // straight into `visible` unresolved. Unlike the "split across many
  // small deltas" test above, the tag here does NOT land at a delta
  // boundary at all - it sits in the middle of a single delta, which is
  // exactly the shape the previous fix (search only from index 0) missed.
  test("real text arriving before a <think> tag in the same delta is still stripped, not dumped raw", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;

    const ttsCalls: string[] = [];
    const fullText = "Let me think. <think>reasoning about the answer</think>The real answer.";
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        // The whole reply arrives as a single delta - "Let me think. " is
        // real, visible text that lands ahead of the opening tag within
        // that one chunk, never on its own delta boundary.
        const stream = ndjsonStream([
          { type: "delta", text: fullText },
          {
            type: "done",
            value: {
              reply: { text: fullText },
              source: "model",
              safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
            },
          },
        ]);
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      if (url.includes("/api/tts")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        ttsCalls.push(body.text ?? "");
        return Promise.resolve(
          new Response(minimalWavHeader(), { status: 200, headers: { "content-type": "audio/wav" } }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText, queryByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "what's the answer" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await findByText("Let me think. The real answer.");
      expect(queryByText(/reasoning about/)).toBeNull();
      expect(queryByText(/<think>/)).toBeNull();
      await waitFor(() => expect(ttsCalls).toEqual(["Let me think.", "The real answer."]));
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  // A code review (2026-09-04) found the original <think> detector was a
  // one-shot flag: it could resolve the FIRST block but had no way to
  // re-arm for a second one appearing later in the same stream, so a
  // second block's raw text leaked into the visible/spoken preview even
  // though stripThinking() would have removed it from the final saved
  // text - the live preview and the saved reply silently disagreeing.
  test("two separate <think> blocks in one reply are both resolved out, not just the first", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;

    const ttsCalls: string[] = [];
    const fullText = "<think>a</think>Hi there. <think>b</think>How can I help?";
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        const stream = ndjsonStream([
          { type: "delta", text: "<think>a</think>Hi there. " },
          { type: "delta", text: "<think>b</think>How can I help?" },
          {
            type: "done",
            value: {
              reply: { text: fullText },
              source: "model",
              safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
            },
          },
        ]);
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      if (url.includes("/api/tts")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        ttsCalls.push(body.text ?? "");
        return Promise.resolve(
          new Response(minimalWavHeader(), { status: 200, headers: { "content-type": "audio/wav" } }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText, queryByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "hi" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await findByText("Hi there. How can I help?");
      expect(queryByText(/<think>/)).toBeNull();
      expect(queryByText(/^a$/)).toBeNull();
      expect(queryByText(/^b$/)).toBeNull();
      await waitFor(() => expect(ttsCalls).toEqual(["Hi there.", "How can I help?"]));
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  // A code review (2026-09-04) found a mid-stream "error" event was
  // thrown as a plain Error, which the catch block's
  // `e instanceof ApiError && e.code === "unavailable"` check can never
  // match - the intended, actionable "check Household → AI models"
  // message never showed, only the generic fallback.
  test("a mid-stream error event shows the same friendly down-state message as a request-time failure", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        const stream = ndjsonStream([
          { type: "delta", text: "Partial reply" },
          { type: "error", error: "chat model unavailable: llama-server crashed" },
        ]);
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "hi" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await findByText(/check Household/);
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  // A code review (2026-09-04) found that a stream ending without ever
  // sending a "done" or "error" event (an abnormal connection drop) left
  // the read loop exiting silently - no exception, so the catch block
  // never ran, and the reply bubble just stopped growing with no banner
  // and no way to tell the person it failed rather than finished.
  test("a stream that ends without a done or error event still shows a real failure, not a silent stall", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        // Only deltas, no terminal event - the connection just closes.
        const stream = ndjsonStream([{ type: "delta", text: "Partial reply" }]);
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "hi" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      // Surfaced with code "unavailable", the same friendly banner a
      // request-time failure shows - not the internal message text
      // (never actually rendered; ApiError's "unavailable" branch always
      // wins over `e.message` in the catch block below).
      await findByText(/check Household/);
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  // A code review (2026-09-04) found `finalText.slice(spokenLength)` (the
  // "done" handler's trailing-fragment flush) assumes `spokenLength`
  // (tracked against `visible`, resolveRaw()'s incremental preview) lines
  // up with `finalText` (stripThinking()'s own, separately-computed,
  // authoritative text) character for character. They don't: whitespace
  // right after a `</think>` tag is stripped by stripThinking()'s
  // `<\/think>\s*` but kept verbatim by resolveRaw(), which only ever
  // advances scanPos past the tag itself. Once any sentence after a think
  // block gets spoken mid-stream, the offset drifts by exactly that much
  // whitespace, and the final trailing fragment gets sliced from the
  // wrong position - dropping its leading characters.
  test("a trailing fragment after a <think> block isn't corrupted by whitespace stripThinking() strips but the live preview kept", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;

    // Two spaces after </think>, one before it: stripThinking() consumes
    // "<think>reasoning</think>  " (tag plus the trailing double space) as
    // one match, leaving a single space (the one before the tag) ahead of
    // "Second"; resolveRaw() keeps all three spaces. "Third part no
    // period" never gets a sentence-ending punctuation mark, so it's only
    // ever flushed by the "done" handler's trailing-fragment logic - the
    // exact path under test.
    const fullText = "First. <think>reasoning</think>  Second sentence here. Third part no period";
    const ttsCalls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        const stream = ndjsonStream([
          { type: "delta", text: fullText },
          {
            type: "done",
            value: {
              reply: { text: fullText },
              source: "model",
              safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
            },
          },
        ]);
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      }
      if (url.includes("/api/tts")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        ttsCalls.push(body.text ?? "");
        return Promise.resolve(
          new Response(minimalWavHeader(), { status: 200, headers: { "content-type": "audio/wav" } }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "what's the answer" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await findByText("First. Second sentence here. Third part no period");
      await waitFor(() =>
        expect(ttsCalls).toEqual(["First.", "Second sentence here.", "Third part no period"]),
      );
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });

  // A code review (2026-09-04) found `awaitingFirstToken` (the "MaiPai is
  // thinking..." spinner) is only ever cleared once a stream event
  // arrives - but a failure before any event (the fetch itself rejecting,
  // e.g. a network error) never reaches that point, and the `finally`
  // block only resets `sending`, never `awaitingFirstToken`. The spinner
  // was left showing forever after such a failure, even though the error
  // banner correctly appeared right next to it.
  test("a request that fails before any stream event still clears the thinking spinner", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/turn/stream")) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByLabelText, findByText, queryByText } = render(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message");
      await act(async () => {
        fireEvent.change(input, { target: { value: "hi" } });
      });
      const sendButton = await findByLabelText("Send");
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await findByText(/Could not reach the hub/);
      expect(queryByText("MaiPai is thinking…")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
  });
});

