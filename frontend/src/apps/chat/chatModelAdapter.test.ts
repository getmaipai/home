import { describe, expect, test, mock, afterEach } from "bun:test";
import type { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from "@assistant-ui/react";
import { createChatModelAdapter, stripThinking } from "@/apps/chat/chatModelAdapter";
import { FakeAudioContext, fakeWavBody } from "../../../tests/fakeAudioContext";
import { ndjsonStream, staggeredNdjsonStream } from "../../../tests/ndjsonStream";

afterEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

// `ChatModelAdapter.run()`'s own return type is a union with a plain
// Promise branch (a one-shot, non-streaming adapter shape this one never
// uses), which `for await` can't statically iterate - createChatModelAdapter
// always returns the AsyncGenerator branch, so every test here narrows to it.
function runAdapter(adapter: ChatModelAdapter, options: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
  return adapter.run(options) as AsyncGenerator<ChatModelRunResult, void>;
}

function fakeUserMessage(text: string): ThreadMessage {
  return {
    id: "msg-1",
    createdAt: new Date("2026-09-05T00:00:00.000Z"),
    role: "user",
    content: [{ type: "text", text }],
    attachments: [],
    metadata: { custom: {} },
  };
}

function stubEnvironment(streamBody: ReadableStream<Uint8Array> | (() => Promise<never>)) {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  const originalFetch = globalThis.fetch;
  const ttsCalls: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/turn/stream")) {
      if (typeof streamBody === "function") return streamBody();
      return Promise.resolve(new Response(streamBody, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
    }
    if (url.includes("/api/tts")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
      ttsCalls.push(body.text ?? "");
      return Promise.resolve(new Response(fakeWavBody().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "audio/wav" } }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return {
    ttsCalls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function collect(messages: ThreadMessage[], abortSignal = new AbortController().signal): Promise<{ yields: ChatModelRunResult[]; error?: unknown }> {
  const adapter = createChatModelAdapter({
    consumeThinking: () => false,
    onCrisisResources: () => {},
    turnSchedulerRef: { current: null },
  });
  const options = { messages, runConfig: {}, abortSignal, context: {}, unstable_getMessage: () => messages[messages.length - 1]! } as unknown as ChatModelRunOptions;
  const yields: ChatModelRunResult[] = [];
  try {
    for await (const r of runAdapter(adapter, options)) yields.push(r);
  } catch (error) {
    return { yields, error };
  }
  return { yields };
}

function lastText(yields: ChatModelRunResult[]): string | undefined {
  const last = yields[yields.length - 1];
  const part = last?.content?.[0];
  return part && part.type === "text" ? part.text : undefined;
}

const SAFETY = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" };

describe("stripThinking", () => {
  test("removes a <think> block ahead of the real answer", () => {
    expect(stripThinking("<think>let me work this out</think>The answer is 42.")).toBe("The answer is 42.");
  });

  test("passes plain text through unchanged", () => {
    expect(stripThinking("The capital of France is Paris.")).toBe("The capital of France is Paris.");
  });

  test("a reasoning-only reply (nothing after </think>) never re-surfaces the raw block", () => {
    const result = stripThinking("<think>thinking forever and never answering</think>");
    expect(result).not.toContain("<think>");
    expect(result).not.toContain("thinking forever");
  });
});

describe("createChatModelAdapter streaming", () => {
  test("a sent message's reply text streams in and each sentence is spoken automatically", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "First sentence." },
        { type: "delta", text: " Second sentence." },
        { type: "done", value: { reply: { text: "First sentence. Second sentence." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("hi there")]);
      expect(lastText(yields)).toBe("First sentence. Second sentence.");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["First sentence.", "Second sentence."]);
    } finally {
      env.restore();
    }
  });

  // A "spoken_cue" event (backend/src/wire.ts, 2026-09-05: fires at most
  // once when the model's own first token is genuinely slow) is spoken
  // but never yielded as content - the whole reason it exists is to fill
  // dead air, not to become part of the message (which is also what keeps
  // the UI's own loading indicator up through it: nothing yields until a
  // real delta arrives).
  test("a spoken_cue plays before the real reply and never gets yielded as content", async () => {
    const { stream, release } = staggeredNdjsonStream(
      [{ type: "spoken_cue", text: "One sec." }],
      [
        { type: "delta", text: "The real answer." },
        { type: "done", value: { reply: { text: "The real answer.", speech: "The real answer." }, source: "model", safety: SAFETY } },
      ],
    );
    const env = stubEnvironment(stream);
    try {
      const adapter = createChatModelAdapter({
        consumeThinking: () => false,
        onCrisisResources: () => {},
        turnSchedulerRef: { current: null },
      });
      const abortSignal = new AbortController().signal;
      const options = {
        messages: [fakeUserMessage("hi there")],
        runConfig: {},
        abortSignal,
        context: {},
        unstable_getMessage: () => fakeUserMessage("hi there"),
      } as unknown as ChatModelRunOptions;
      const yields: ChatModelRunResult[] = [];
      const done = (async () => {
        for await (const r of runAdapter(adapter, options)) yields.push(r);
      })();

      // Only the cue has arrived so far (the stream is staggered, still
      // holding restLines back) - the loop has consumed it (no yield: a
      // spoken_cue never touches `visible`) and is now blocked awaiting
      // the next line, so nothing should have yielded yet.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(yields).toHaveLength(0);
      expect(env.ttsCalls).toEqual(["One sec."]);

      release();
      await done;
      expect(lastText(yields)).toBe("The real answer.");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["One sec.", "The real answer."]);
    } finally {
      env.restore();
    }
  });

  test("a <think> block never yielded or spoken - only the real answer after it", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "<think>reasoning about the" },
        { type: "delta", text: " answer here</think>The real answer." },
        { type: "done", value: { reply: { text: "<think>reasoning about the answer here</think>The real answer." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the answer")]);
      for (const y of yields) {
        const part = y.content?.[0];
        const text = part && part.type === "text" ? part.text : "";
        expect(text).not.toContain("reasoning about");
        expect(text).not.toContain("<think>");
      }
      expect(lastText(yields)).toBe("The real answer.");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["The real answer."]);
    } finally {
      env.restore();
    }
  });

  // A code review (2026-09-04) found the opening <think> tag was only
  // ever detected if it arrived whole in one delta - real token-level
  // streaming can split it across several. Reproduces that exact shape:
  // the tag split character by character.
  test("a <think> tag split across many small deltas is still recognized and never leaks", async () => {
    const fullText = "<think>reasoning about the answer here</think>The real answer.";
    const deltas = fullText.split("").map((char) => ({ type: "delta", text: char }));
    const env = stubEnvironment(
      ndjsonStream([...deltas, { type: "done", value: { reply: { text: fullText }, source: "model", safety: SAFETY } }]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the answer")]);
      expect(lastText(yields)).toBe("The real answer.");
      for (const y of yields) {
        const part = y.content?.[0];
        const text = part && part.type === "text" ? part.text : "";
        expect(text).not.toContain("reasoning about");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["The real answer."]);
    } finally {
      env.restore();
    }
  });

  // A code review (2026-09-04) found the original <think> detector only
  // ever searched for the opening tag at the very START of the unresolved
  // remainder - real text arriving ahead of the tag within the SAME delta
  // got the tag, and everything after it, dumped straight into `visible`.
  test("real text arriving before a <think> tag in the same delta is still stripped, not dumped raw", async () => {
    const fullText = "Let me think. <think>reasoning about the answer</think>The real answer.";
    const env = stubEnvironment(
      ndjsonStream([{ type: "delta", text: fullText }, { type: "done", value: { reply: { text: fullText }, source: "model", safety: SAFETY } }]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the answer")]);
      expect(lastText(yields)).toBe("Let me think. The real answer.");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["Let me think.", "The real answer."]);
    } finally {
      env.restore();
    }
  });

  // A code review (2026-09-04) found the original <think> detector was a
  // one-shot flag: it could resolve the FIRST block but had no way to
  // re-arm for a second one appearing later in the same stream.
  test("two separate <think> blocks in one reply are both resolved out, not just the first", async () => {
    const fullText = "<think>a</think>Hi there. <think>b</think>How can I help?";
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "<think>a</think>Hi there. " },
        { type: "delta", text: "<think>b</think>How can I help?" },
        { type: "done", value: { reply: { text: fullText }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("hi")]);
      expect(lastText(yields)).toBe("Hi there. How can I help?");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["Hi there.", "How can I help?"]);
    } finally {
      env.restore();
    }
  });

  // A code review (2026-09-04) found `finalText.slice(spokenLength)` (the
  // "done" handler's trailing-fragment flush) assumed `spokenLength`
  // (tracked against the incremental preview) lined up with `finalText`
  // (stripThinking()'s own, separately-computed text) character for
  // character - they don't when whitespace right after </think> is
  // stripped by one but kept by the other.
  test("a trailing fragment after a <think> block isn't corrupted by the whitespace stripThinking() strips but the live preview kept", async () => {
    const fullText = "First. <think>reasoning</think>  Second sentence here. Third part no period";
    const env = stubEnvironment(
      ndjsonStream([{ type: "delta", text: fullText }, { type: "done", value: { reply: { text: fullText }, source: "model", safety: SAFETY } }]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the answer")]);
      expect(lastText(yields)).toBe("First. Second sentence here. Third part no period");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["First.", "Second sentence here.", "Third part no period"]);
    } finally {
      env.restore();
    }
  });
});

describe("createChatModelAdapter errors", () => {
  // A code review (2026-09-04) found a mid-stream "error" event thrown as
  // a plain Error, which the friendly-message check below could never
  // match - the actionable "check Household → AI models" message never
  // showed, only the generic fallback.
  test("a mid-stream error event surfaces the same friendly down-state message as a request-time failure", async () => {
    const env = stubEnvironment(
      ndjsonStream([{ type: "delta", text: "Partial reply" }, { type: "error", error: "chat model unavailable: llama-server crashed" }]),
    );
    try {
      const { error } = await collect([fakeUserMessage("hi")]);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/check Household/);
    } finally {
      env.restore();
    }
  });

  // A code review (2026-09-04) found that a stream ending without ever
  // sending a "done" or "error" event (an abnormal connection drop) left
  // the read loop exiting silently - no exception, no failure surfaced.
  test("a stream that ends without a done or error event still surfaces a real failure", async () => {
    const env = stubEnvironment(ndjsonStream([{ type: "delta", text: "Partial reply" }]));
    try {
      const { error } = await collect([fakeUserMessage("hi")]);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/check Household/);
    } finally {
      env.restore();
    }
  });

  test("a request that fails before any stream event surfaces the generic hub-unreachable message", async () => {
    const env = stubEnvironment(() => Promise.reject(new Error("network error")));
    try {
      const { error } = await collect([fakeUserMessage("hi")]);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Could not reach the hub/);
    } finally {
      env.restore();
    }
  });

  // docs/plans/session-b-ui.md step 4: "honours abortSignal for stop" -
  // a user-initiated stop must read as cancelled to
  // @assistant-ui/core's local-thread-runtime-core.ts (which checks
  // `e.name === "AbortError"`), not as a failed reply.
  test("an aborted run throws a real AbortError, not the generic failure message", async () => {
    const controller = new AbortController();
    const env = stubEnvironment(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    try {
      const { error } = await collect([fakeUserMessage("hi")], controller.signal);
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe("AbortError");
    } finally {
      env.restore();
    }
  });
});
