import { describe, expect, test, mock, afterEach } from "bun:test";
import type { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult, PendingAttachment, ThreadMessage } from "@assistant-ui/react";
import { createChatModelAdapter, stripThinking } from "@/apps/chat/chatModelAdapter";
import { ChatTurnError } from "@/apps/chat/chatTurnError";
import { createLocalImageAttachmentAdapter, clearStagedImageAttachments } from "@/apps/chat/localImageAttachmentAdapter";
import { FakeAudioContext, fakeWavBody } from "../../../tests/fakeAudioContext";
import { assistantStreamBody as ndjsonStream, staggeredAssistantStreamBody as staggeredNdjsonStream, ASSISTANT_STREAM_HEADERS } from "../../../tests/assistantStreamBody";

afterEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
  clearStagedImageAttachments();
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

function stubEnvironment(streamBody: ReadableStream<Uint8Array> | (() => Promise<never>), additionalStreams: ReadableStream<Uint8Array>[] = []) {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  const originalFetch = globalThis.fetch;
  const ttsCalls: string[] = [];
  const turnBodies: unknown[] = [];
  const turnAccepts: (string | null)[] = [];
  let turnCalls = 0;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/turn/stream")) {
      turnBodies.push(JSON.parse(String(init?.body ?? "{}")));
      turnAccepts.push(new Headers(init?.headers).get("accept"));
      if (typeof streamBody === "function") return streamBody();
      const call = turnCalls++;
      const body = call === 0 ? streamBody : additionalStreams[call - 1] ?? streamBody;
      return Promise.resolve(new Response(body, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
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
    turnBodies,
    turnAccepts,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function collect(messages: ThreadMessage[], abortSignal = new AbortController().signal, onCrisisResources: (text: string) => void = () => {}, getModel?: () => string | undefined, onArtifactReady?: (artifactId: string) => void, onConnection?: (state: { phase: "online" | "dropped" | "reconnecting" | "resumed"; attempt?: number; resumedTokens?: number }) => void): Promise<{ yields: ChatModelRunResult[]; error?: unknown }> {
  const adapter = createChatModelAdapter({
    consumeThinking: () => false,
    consumeSupersedes: () => undefined,
    onCrisisResources,
    turnSchedulerRef: { current: null },
    getModel,
    onArtifactReady,
    onConnection,
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

  // Issue #20: a reply can end (stream truncated, hit a token limit, a
  // backend crash) while still inside an UNCLOSED think block - the
  // regex requires a matching </think>, finds none, and the raw
  // reasoning used to be shown verbatim in the chat bubble.
  test("an unclosed <think> block (stream cut off mid-reasoning) never leaks the raw tag or reasoning", () => {
    const result = stripThinking("<think>reasoning about the answer here");
    expect(result).not.toContain("<think>");
    expect(result).not.toContain("reasoning about the answer");
    expect(result).toBe("MaiPai thought about it but didn't give a final answer. Try asking again.");
  });

  test("real text before an unclosed <think> block is kept, only the trailing reasoning is dropped", () => {
    const result = stripThinking("Here's what I know so far.<think>reasoning about the rest");
    expect(result).toBe("Here's what I know so far.");
  });
});

describe("image capability boundary", () => {
  test("refuses a complete image before any turn request reaches fetch", async () => {
    const message = {
      ...fakeUserMessage("What is in this?") ,
      attachments: [{
        id: "att-local-image",
        type: "image",
        name: "photo.png",
        contentType: "image/png",
        status: { type: "complete" as const },
        content: [{ type: "image" as const, image: "data:image/png;base64,aGk=" }],
      }],
    };
    const result = await collect([message]);

    expect(result.error).toBeUndefined();
    expect(lastText(result.yields)).toContain("cannot interpret images yet");
  });
});

// ATT-01, live finding 2026-09-22: SimpleTextAttachmentAdapter (assistant-ui's
// own, composerAddMenu.tsx's text/Markdown path) resolves a document
// attachment's content onto message.attachments[i].content, a separate
// array from message.content (the typed text) - lastUserText() only
// ever read the latter, so an attached text file's own content silently
// never reached the model, even though the attach-and-send itself
// succeeded with no error at all.
describe("document attachment content", () => {
  test("a PDF rides as an additive document_attachments payload on the actual turn request", async () => {
    const env = stubEnvironment(ndjsonStream([
      { type: "delta", text: "Read." },
      { type: "done", value: { turn_id: "turn-pdf", reply: { text: "Read." }, source: "model", safety: SAFETY } },
    ]));
    const fileAdapter = createLocalImageAttachmentAdapter();
    const pending = await fileAdapter.add({ file: new File(["pdf bytes"], "notes.pdf", { type: "application/pdf" }) });
    try {
      const message = { ...fakeUserMessage("summarize"), attachments: [{ ...pending, type: "file", status: { type: "complete" as const } }] };
      await collect([message as unknown as ThreadMessage]);
      expect(env.turnBodies[0]).toMatchObject({
        text: "summarize",
        document_attachments: [{ name: "notes.pdf", media_type: "application/pdf", data: "data:application/pdf;base64,cGRmIGJ5dGVz" }],
      });
    } finally {
      await fileAdapter.remove(pending as PendingAttachment);
      env.restore();
    }
  });

  test("attaching a text file and sending delivers the turn - its own content rides along in the outgoing text", async () => {
    const env = stubEnvironment(ndjsonStream([
      { type: "delta", text: "Noted." },
      { type: "done", value: { turn_id: "turn-att1", reply: { text: "Noted." }, source: "model", safety: SAFETY } },
    ]));
    try {
      const message = {
        ...fakeUserMessage("what does this say"),
        attachments: [{
          id: "att-local-doc",
          type: "document",
          name: "notes.txt",
          contentType: "text/plain",
          status: { type: "complete" as const },
          content: [{ type: "text" as const, text: '<attachment name="notes.txt">\nbuy milk\n</attachment>' }],
        }],
      };
      const result = await collect([message]);

      expect(result.error).toBeUndefined();
      expect(lastText(result.yields)).toBe("Noted.");
      expect(env.turnBodies[0]).toMatchObject({ text: 'what does this say\n\n<attachment name="notes.txt">\nbuy milk\n</attachment>' });
    } finally {
      env.restore();
    }
  });

  test("no attachment: the outgoing text is exactly the typed text, unchanged", async () => {
    const env = stubEnvironment(ndjsonStream([
      { type: "delta", text: "Hi." },
      { type: "done", value: { turn_id: "turn-att2", reply: { text: "Hi." }, source: "model", safety: SAFETY } },
    ]));
    try {
      await collect([fakeUserMessage("hello")]);
      expect(env.turnBodies[0]).toMatchObject({ text: "hello" });
    } finally {
      env.restore();
    }
  });
});

describe("createChatModelAdapter streaming", () => {
  test("a failed done reply carries the admin-details marker into message metadata", async () => {
    const env = stubEnvironment(ndjsonStream([
      { type: "done", value: { turn_id: "turn-failed-live", reply: { text: "That was too much text for me to read in one go. Try a shorter question." }, source: "plugin", failed_generation: true, safety: SAFETY } },
    ]));
    try {
      const { yields } = await collect([fakeUserMessage("find all of these")]);
      const last = yields.at(-1);
      expect(last?.metadata?.custom?.failedGeneration).toBe(true);
      expect(last?.metadata?.custom?.turnId).toBe("turn-failed-live");
      expect(JSON.stringify(last)).not.toContain("exceed_context_size_error");
    } finally {
      env.restore();
    }
  });

  test("sends the selected model on each turn request", async () => {
    const env = stubEnvironment(ndjsonStream([
      { type: "delta", text: "Selected." },
      { type: "done", value: { reply: { text: "Selected." }, source: "model", safety: SAFETY } },
    ]));
    try {
      await collect([fakeUserMessage("hi there")], new AbortController().signal, () => {}, () => "llama-3.1-8b");
      expect(env.turnBodies[0]).toMatchObject({ model: "llama-3.1-8b" });
    } finally {
      env.restore();
    }
  });

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
  // but never yielded as message CONTENT - the whole reason it exists is
  // to fill dead air, not to become part of the message. Lane 11 item 1
  // added the one thing it's missing: a metadata-only yield that drives
  // the transient activity line (chatTurnActivity.ts), for the person who
  // can't hear it play.
  test("a spoken_cue plays before the real reply, sets the activity line, and is never yielded as content", async () => {
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
        consumeSupersedes: () => undefined,
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
      // holding restLines back) - one metadata-only yield (the activity
      // line), no content part at all.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(yields).toHaveLength(1);
      expect(yields[0]?.content).toBeUndefined();
      expect(yields[0]?.metadata?.custom).toEqual({ activity: "One sec." });
      expect(env.ttsCalls).toEqual(["One sec."]);

      release();
      await done;
      expect(lastText(yields)).toBe("The real answer.");
      // The first real delta clears the activity line with its own
      // metadata-only yield (an empty custom bag), ahead of the content
      // yield right after it.
      expect(yields[1]).toEqual({ metadata: { custom: {} } });
      expect(yields[2]).toEqual({ content: [{ type: "text", text: "The real answer." }] });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["One sec.", "The real answer."]);
    } finally {
      env.restore();
    }
  });

  // THIN-5E: the server splits a reply's <think> spans into reasoning parts
  // (routes/turn.ts feedThinkSplit, covered by backend/tests/wellFormed.test.ts
  // and neutralizeThinkTags), so a text part never carries the tags and the
  // client no longer re-parses them. These keep the user-visible behaviours the
  // old in-adapter tag scanner protected, on the wire the chat now reads.
  test("a reasoning-only stretch yields no text part, so the working indicator stays up", async () => {
    const { stream, release } = staggeredNdjsonStream(
      [{ type: "reasoning", text: "reasoning about the" }],
      [
        { type: "delta", text: "The real answer." },
        { type: "done", value: { reply: { text: "The real answer." }, source: "model", safety: SAFETY } },
      ],
    );
    const env = stubEnvironment(stream);
    try {
      const done = collect([fakeUserMessage("what's the answer")]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      release();
      const { yields } = await done;
      expect(yields[0]?.content).toEqual([{ type: "reasoning", text: "reasoning about the" }]);
      expect(lastText(yields)).toBeUndefined();
      expect(yields[yields.length - 1]?.content).toEqual([
        { type: "reasoning", text: "reasoning about the" },
        { type: "text", text: "The real answer." },
      ]);
    } finally {
      env.restore();
    }
  });

  test("reasoning is never spoken or shown as text - only the answer is", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "reasoning", text: "reasoning about the answer here" },
        { type: "delta", text: "The real answer." },
        { type: "done", value: { reply: { text: "The real answer." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the answer")]);
      for (const y of yields) for (const part of y.content ?? []) if (part.type === "text") expect(part.text).not.toContain("reasoning about");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["The real answer."]);
    } finally {
      env.restore();
    }
  });

  // The adapter shows released text exactly as sent; it holds nothing back
  // looking for a tag the wire never carries (rule 9: no client-side parsing).
  test("a released delta is shown as sent, never held back for a possible <think> tag", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Use the <thi" },
        { type: "done", value: { reply: { text: "Use the <thi" }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("how")]);
      const first = yields.find((y) => y.content?.some((part) => part.type === "text"));
      expect(first?.content).toEqual([{ type: "text", text: "Use the <thi" }]);
    } finally {
      env.restore();
    }
  });

  test("sentences split across deltas are spoken whole, and a trailing fragment is flushed at done", async () => {
    const fullText = "First. Second sentence here. Third part no period";
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "First. Second sen" },
        { type: "delta", text: "tence here. Third part no period" },
        { type: "done", value: { reply: { text: fullText }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the answer")]);
      expect(lastText(yields)).toBe(fullText);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual(["First.", "Second sentence here.", "Third part no period"]);
    } finally {
      env.restore();
    }
  });

  // Jesse, 2026-09-06: the composer's own Send/Stop toggle tracks only
  // text generation, so it flipped back to "Send" while a reply was still
  // being spoken - onSpeakingChange (ChatPage.tsx's "stop speaking"
  // control) exists specifically because these two are genuinely
  // different signals, not the same thing twice.
  test("onSpeakingChange tracks the reply's own audio, independent of when text generation finishes", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Hello there." },
        { type: "done", value: { reply: { text: "Hello there." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const speakingEvents: boolean[] = [];
      const adapter = createChatModelAdapter({
        consumeThinking: () => false,
        consumeSupersedes: () => undefined,
        onCrisisResources: () => {},
        turnSchedulerRef: { current: null },
        onSpeakingChange: (speaking) => speakingEvents.push(speaking),
      });
      const options = {
        messages: [fakeUserMessage("hi")],
        runConfig: {},
        abortSignal: new AbortController().signal,
        context: {},
        unstable_getMessage: () => fakeUserMessage("hi"),
      } as unknown as ChatModelRunOptions;
      // Draining the generator to completion is exactly "text generation
      // finished" - speech (a separate TTS fetch, then playback) hasn't
      // necessarily caught up yet, which is the entire gap this exists to
      // cover. eslint's no-unused-vars only ignores a leading-underscore
      // NAME on function args (argsIgnorePattern), not a for-of binding,
      // hence the inline disable for this one intentionally-discarded value.
      for await (const value of runAdapter(adapter, options)) {
        void value;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(speakingEvents).toEqual([false, true, false]);
    } finally {
      env.restore();
    }
  });
});

// SHELL-02: the reasoning Element (thread.aui.tsx) has an actual mount
// point now (/next/chat), so the `reasoning` wire event (REASONING-01)
// stops being discarded client-side and becomes its own
// ReasoningMessagePart alongside the reply text.
describe("createChatModelAdapter reasoning (SHELL-02)", () => {
  test("a reasoning event renders as its own part alongside the reply text, not discarded", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "reasoning", text: "Let me think about this." },
        { type: "delta", text: "The answer is 42." },
        { type: "done", value: { reply: { text: "The answer is 42." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what is the answer")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        { type: "reasoning", text: "Let me think about this." },
        { type: "text", text: "The answer is 42." },
      ]);
    } finally {
      env.restore();
    }
  });

  // REASONING-02: a tool-calling reply never streams a live `reasoning`
  // event (its reasoning never rides a visible span to split out of) -
  // `event.value.reasoning` (wire.ts's own buffered fallback) is what
  // the reasoning Element renders for exactly that case.
  test("a tool-calling reply with no live reasoning event falls back to the done event's own reasoning field", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "It's sunny today." },
        { type: "done", value: { reply: { text: "It's sunny today." }, reasoning: "Checking the weather tool.", source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the weather")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        { type: "reasoning", text: "Checking the weather tool." },
        { type: "text", text: "It's sunny today." },
      ]);
    } finally {
      env.restore();
    }
  });

  test("speakReplies: false never calls TTS, even though the reply still renders and streams", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "First sentence." },
        { type: "done", value: { reply: { text: "First sentence." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const adapter = createChatModelAdapter({
        consumeThinking: () => false,
        consumeSupersedes: () => undefined,
        onCrisisResources: () => {},
        turnSchedulerRef: { current: null },
        speakReplies: false,
      });
      const options = {
        messages: [fakeUserMessage("hi there")],
        runConfig: {},
        abortSignal: new AbortController().signal,
        context: {},
        unstable_getMessage: () => fakeUserMessage("hi there"),
      } as unknown as ChatModelRunOptions;
      const yields: ChatModelRunResult[] = [];
      for await (const r of runAdapter(adapter, options)) yields.push(r);
      expect(lastText(yields)).toBe("First sentence.");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual([]);
    } finally {
      env.restore();
    }
  });

  // VOICE-LIVE-02: consumeSpoken() is the one place `spoken: true` ever
  // reaches the wire - RESP-01's own flag, read once per send and reset,
  // the same single-shot shape consumeTemporary()/consumePackageScope()
  // already establish.
  test("consumeSpoken() arms spoken: true on the request, once, then resets", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Hi!" },
        { type: "done", value: { reply: { text: "Hi!" }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      let spoken = true;
      const adapter = createChatModelAdapter({
        consumeThinking: () => false,
        consumeSupersedes: () => undefined,
        onCrisisResources: () => {},
        turnSchedulerRef: { current: null },
        consumeSpoken: () => {
          const value = spoken || undefined;
          spoken = false;
          return value;
        },
      });
      const options = { messages: [fakeUserMessage("hi")], runConfig: {}, abortSignal: new AbortController().signal, context: {}, unstable_getMessage: () => fakeUserMessage("hi") } as unknown as ChatModelRunOptions;
      const yields: ChatModelRunResult[] = [];
      for await (const r of runAdapter(adapter, options)) yields.push(r);
      expect(env.turnBodies[0]).toMatchObject({ spoken: true });
    } finally {
      env.restore();
    }
  });

  // VOICE-LIVE-02: `speakReplies` also accepts a getter, read fresh
  // every send - the live voice session flips it on only while it's
  // open; a typed message sent while it's closed never speaks.
  test("speakReplies as a function is read per send, not fixed at adapter creation", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "First sentence." },
        { type: "done", value: { reply: { text: "First sentence." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      let liveOpen = false;
      const adapter = createChatModelAdapter({
        consumeThinking: () => false,
        consumeSupersedes: () => undefined,
        onCrisisResources: () => {},
        turnSchedulerRef: { current: null },
        speakReplies: () => liveOpen,
      });
      const options = { messages: [fakeUserMessage("hi")], runConfig: {}, abortSignal: new AbortController().signal, context: {}, unstable_getMessage: () => fakeUserMessage("hi") } as unknown as ChatModelRunOptions;
      const yields: ChatModelRunResult[] = [];
      for await (const r of runAdapter(adapter, options)) yields.push(r);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(env.ttsCalls).toEqual([]);

      liveOpen = true;
      const env2 = stubEnvironment(
        ndjsonStream([
          { type: "delta", text: "Second sentence." },
          { type: "done", value: { reply: { text: "Second sentence." }, source: "model", safety: SAFETY } },
        ]),
      );
      try {
        const yields2: ChatModelRunResult[] = [];
        for await (const r of runAdapter(adapter, { ...options, messages: [fakeUserMessage("hi again")] } as ChatModelRunOptions)) yields2.push(r);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(env2.ttsCalls.length).toBeGreaterThan(0);
      } finally {
        env2.restore();
      }
    } finally {
      env.restore();
    }
  });
});

// SHELL-02 slice 3: weather's and almanac-date's own structured result
// (wire.ts's `structured_part`) becomes a real ToolCallMessagePart, not
// Home-drawn prose - `toolName` is the producing package's own real
// id (`structured_part.tool_id`), so NextChatPage.tsx's registered
// spec-sheet render (and, for anything else, Thread's own built-in
// ToolFallback) both key on something honest.
describe("createChatModelAdapter structured results (SHELL-02 slice 3)", () => {
  test("a structured_part on the done event becomes a real tool-call part, named for its producing package, card before prose", async () => {
    const structuredPart = { kind: "spec_sheet" as const, tool_id: "weather", title: "Lantern Bay", rows: [{ label: "Temperature", value: "61°F" }] };
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "It's 61°F in Lantern Bay." },
        { type: "done", value: { turn_id: "turn-weather123", reply: { text: "It's 61°F in Lantern Bay." }, source: "plugin", safety: SAFETY, structured_part: structuredPart } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the weather")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        { type: "tool-call", toolCallId: "turn-weather123-structured", toolName: "weather", args: {}, argsText: "", result: structuredPart },
        { type: "text", text: "It's 61°F in Lantern Bay." },
      ]);
    } finally {
      env.restore();
    }
  });

  test("a plain-text reply with no structured_part yields no tool-call part", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Basil and parsley are easy herbs." },
        { type: "done", value: { turn_id: "turn-herbs123", reply: { text: "Basil and parsley are easy herbs." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what herbs should I grow")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([{ type: "text", text: "Basil and parsley are easy herbs." }]);
    } finally {
      env.restore();
    }
  });
});

// APPROVE-CARD-01: `TurnValue.confirm` (wire.ts) - set only on the turn
// that just parked a confirm_needed/consent_needed ask (turnNext.ts's
// finishTurn() "asked" branch) - becomes a real ToolCallMessagePart the
// same way structured_part/artifact above do, `toolName: "confirm"`
// (ConfirmTool's own registration, NextChatPage.tsx), card before the
// prose that carries the actual question text.
describe("createChatModelAdapter confirm results (APPROVE-CARD-01)", () => {
  test("confirm on the done event becomes a real tool-call part, card before prose", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Go ahead and lock the doors?" },
        { type: "done", value: { turn_id: "turn-confirm123", reply: { text: "Go ahead and lock the doors?" }, source: "confirm", safety: SAFETY, confirm: { package_id: "lock-doors", open: true } } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("lock the doors")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        { type: "tool-call", toolCallId: "turn-confirm123-confirm", toolName: "confirm", args: {}, argsText: "", result: { package_id: "lock-doors", open: true, turn_id: "turn-confirm123" } },
        { type: "text", text: "Go ahead and lock the doors?" },
      ]);
    } finally {
      env.restore();
    }
  });

  test("a plain-text reply with no confirm yields no confirm tool-call part", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Basil and parsley are easy herbs." },
        { type: "done", value: { turn_id: "turn-herbs789", reply: { text: "Basil and parsley are easy herbs." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what herbs should I grow")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([{ type: "text", text: "Basil and parsley are easy herbs." }]);
    } finally {
      env.restore();
    }
  });

  // The same single-shot shape consumeSpoken()/consumeTemporary()/
  // consumePackageScope() already establish - consumeAskAnswer() is the
  // one place `ask_answer` ever reaches the wire (ConfirmTool's own
  // respondToApproval handler, NextChatPage.tsx).
  test("consumeAskAnswer() arms ask_answer on the request, once, then resets", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Sure, locking the doors." },
        { type: "done", value: { reply: { text: "Sure, locking the doors." }, source: "plugin", plugin_id: "lock-doors", safety: SAFETY } },
      ]),
    );
    try {
      let askAnswer: { turnId: string; approved: boolean } | undefined = { turnId: "turn-confirm123", approved: true };
      const adapter = createChatModelAdapter({
        consumeThinking: () => false,
        consumeSupersedes: () => undefined,
        onCrisisResources: () => {},
        turnSchedulerRef: { current: null },
        consumeAskAnswer: () => {
          const value = askAnswer;
          askAnswer = undefined;
          return value;
        },
      });
      const options = { messages: [fakeUserMessage("Yes")], runConfig: {}, abortSignal: new AbortController().signal, context: {}, unstable_getMessage: () => fakeUserMessage("Yes") } as unknown as ChatModelRunOptions;
      const yields: ChatModelRunResult[] = [];
      for await (const r of runAdapter(adapter, options)) yields.push(r);
      expect(env.turnBodies[0]).toMatchObject({ ask_answer: { turn_id: "turn-confirm123", approved: true } });
    } finally {
      env.restore();
    }
  });
});

// PROJECT-PROGRESS-01: `start_project`'s own outcome names the project id
// it just launched (wire.ts's `TurnValue.project`) - a real
// ToolCallMessagePart here, `toolName: "project"` (NextChatPage.tsx's
// registered JobProgress render polls GET /api/projects/:id for the rest).
// AFTER the text, not before, since 2026-09-27 (Jesse found live): a
// project's card is a "here's what came of that" footer like sources, the
// same reasoning chatHistoryAdapter.ts's own #182 reload-path rule
// already applies to a project's finished artifact - putting it before
// text here, while live, meant ProjectResultReload's later
// `reloadMainThread()` visibly relocated the same card once the reload
// landed.
describe("createChatModelAdapter project progress (PROJECT-PROGRESS-01)", () => {
  test("a project on the done event becomes a real tool-call part, card after prose", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Starting a bedtime story now - 2 steps, about 1 minute." },
        {
          type: "done",
          value: {
            turn_id: "turn-project123",
            reply: { text: "Starting a bedtime story now - 2 steps, about 1 minute." },
            source: "model",
            safety: SAFETY,
            project: { id: "proj-example123" },
          },
        },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("write me a bedtime story")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        { type: "text", text: "Starting a bedtime story now - 2 steps, about 1 minute." },
        { type: "tool-call", toolCallId: "turn-project123-project", toolName: "project", args: {}, argsText: "", result: { id: "proj-example123" } },
      ]);
    } finally {
      env.restore();
    }
  });

  test("a plain reply with no project yields no project tool-call part", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Basil and parsley are easy herbs." },
        { type: "done", value: { turn_id: "turn-herbs789", reply: { text: "Basil and parsley are easy herbs." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what herbs should I grow")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([{ type: "text", text: "Basil and parsley are easy herbs." }]);
    } finally {
      env.restore();
    }
  });
});

// Jesse, live-found 2026-09-27: "auto open the canvas... this should
// be the default when generating an artifact that requires the
// canvas" - `onArtifactReady` fires exactly once, right where `artifact`
// (chatModelAdapter.ts) is known non-null on the turn's own terminal
// event, so NextChatPage.tsx can open the canvas with no click needed.
describe("createChatModelAdapter onArtifactReady", () => {
  test("a write_document reply calls onArtifactReady with the new artifact's id", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Wrote it." },
        {
          type: "done",
          value: {
            turn_id: "turn-artifact123",
            reply: { text: "Wrote it." },
            source: "plugin",
            plugin_id: "write_document",
            safety: SAFETY,
            artifact: { id: "art-example123", version: 1 },
          },
        },
      ]),
    );
    const ready: string[] = [];
    try {
      await collect([fakeUserMessage("write me a short note")], undefined, undefined, undefined, (id) => ready.push(id));
      expect(ready).toEqual(["art-example123"]);
    } finally {
      env.restore();
    }
  });

  test("a plain reply with no artifact never calls onArtifactReady", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Basil and parsley are easy herbs." },
        { type: "done", value: { turn_id: "turn-herbs789", reply: { text: "Basil and parsley are easy herbs." }, source: "model", safety: SAFETY } },
      ]),
    );
    const ready: string[] = [];
    try {
      await collect([fakeUserMessage("what herbs should I grow")], undefined, undefined, undefined, (id) => ready.push(id));
      expect(ready).toEqual([]);
    } finally {
      env.restore();
    }
  });
});

// Slice 5(a): CHAT-16's `TurnValue.sources` becomes a real ToolCallMessagePart
// too - `toolName: "sources"`, AFTER the text part (spec.md's "a compact card
// under the reply," the opposite order from the structured card above, which
// reads before the prose).
describe("createChatModelAdapter sources (slice 5(a))", () => {
  const SOURCE = { id: "src-abc123", kind: "web" as const, title: "Lantern Bay tide chart", url: "https://example.com/tides", site: "example.com", snippet: null, source: "turn-tide123", created_at: "2026-09-22T00:00:00.000Z", hlc: "1788000000000:0:test" };

  test("sources on the done event become a real tool-call part after the text part", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "High tide is at 4pm." },
        { type: "done", value: { turn_id: "turn-tide123", reply: { text: "High tide is at 4pm." }, source: "model", safety: SAFETY, sources: [SOURCE] } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("when's high tide")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([{ type: "text", text: "High tide is at 4pm." }, { type: "tool-call", toolCallId: "turn-tide123-sources", toolName: "sources", args: {}, argsText: "", result: [SOURCE] }]);
    } finally {
      env.restore();
    }
  });

  test("a reply with no sources yields no sources tool-call part", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Basil and parsley are easy herbs." },
        { type: "done", value: { turn_id: "turn-herbs456", reply: { text: "Basil and parsley are easy herbs." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what herbs should I grow")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([{ type: "text", text: "Basil and parsley are easy herbs." }]);
    } finally {
      env.restore();
    }
  });

  test("a structured_part and sources on the same reply: structured card first, text, then sources", async () => {
    const structuredPart = { kind: "spec_sheet" as const, tool_id: "weather", title: "Lantern Bay", rows: [{ label: "Temperature", value: "61°F" }] };
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "It's 61°F in Lantern Bay." },
        { type: "done", value: { turn_id: "turn-weather789", reply: { text: "It's 61°F in Lantern Bay." }, source: "plugin", safety: SAFETY, structured_part: structuredPart, sources: [SOURCE] } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the weather")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        { type: "tool-call", toolCallId: "turn-weather789-structured", toolName: "weather", args: {}, argsText: "", result: structuredPart },
        { type: "text", text: "It's 61°F in Lantern Bay." },
        { type: "tool-call", toolCallId: "turn-weather789-sources", toolName: "sources", args: {}, argsText: "", result: [SOURCE] },
      ]);
    } finally {
      env.restore();
    }
  });
});

// TOOL-EVENTS-01 (spec-v0.1.16): tool_call/tool_result/tool_error aren't
// emitted by any real package yet (the backend half - docs/dev.md's own
// handoff note - hasn't landed), so these are scripted the same way
// slice 5(a)'s sources tests were before CHAT-16 landed emission:
// consumer before producer, proven against the wire shape spec-v0.1.16
// promises, not a real turn. Events use `t`, not `type` - a separate
// discriminant from the rest of this stream (chatModelAdapter.ts's own
// comment on why).
describe("createChatModelAdapter tool timeline (TOOL-EVENTS-01, frontend half)", () => {
  test("a tool_call followed by a tool_result becomes a tool_timeline part, before the text part", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: { query: "tide chart" }, call_id: "call-1" },
        { t: "tool_result", call_id: "call-1", package_id: "websearch", outcome: { text: "3 results" } },
        { type: "delta", text: "High tide is at 4pm." },
        { type: "done", value: { turn_id: "turn-tide999", reply: { text: "High tide is at 4pm." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("when's high tide")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        { type: "tool-call", toolCallId: "turn-tide999-tools", toolName: "tool_timeline", args: {}, argsText: "", result: [{ callId: "call-1", packageId: "websearch", state: "ok" }] },
        { type: "text", text: "High tide is at 4pm." },
      ]);
    } finally {
      env.restore();
    }
  });

  test("a tool_result's sites ride along on the tool_timeline part's call (TOOL-EVENTS-02)", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: { query: "mariners score" }, call_id: "call-1" },
        { t: "tool_result", call_id: "call-1", package_id: "websearch", outcome: { text: "4-2", sites: [{ host: "mlb.com", url: "https://www.mlb.com/mariners" }] } },
        { type: "delta", text: "The Mariners won 4-2." },
        { type: "done", value: { turn_id: "turn-tools999", reply: { text: "The Mariners won 4-2." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("who won the mariners game")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        {
          type: "tool-call",
          toolCallId: "turn-tools999-tools",
          toolName: "tool_timeline",
          args: {},
          argsText: "",
          result: [{ callId: "call-1", packageId: "websearch", state: "ok", sites: [{ host: "mlb.com", url: "https://www.mlb.com/mariners" }] }],
        },
        { type: "text", text: "The Mariners won 4-2." },
      ]);
    } finally {
      env.restore();
    }
  });

  test("a tool_call with no matching result yet stays in the running state", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: {}, call_id: "call-1" },
        { type: "done", value: { turn_id: "turn-run1", reply: { text: "Still working." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("search")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        { type: "tool-call", toolCallId: "turn-run1-tools", toolName: "tool_timeline", args: {}, argsText: "", result: [{ callId: "call-1", packageId: "websearch", state: "running" }] },
        { type: "text", text: "Still working." },
      ]);
    } finally {
      env.restore();
    }
  });

  test("a tool_error event keeps its failure kind on the timeline call", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: {}, call_id: "call-1" },
        { t: "tool_error", call_id: "call-1", package_id: "websearch", error: "timed out" },
        { type: "done", value: { turn_id: "turn-err1", reply: { text: "Something went wrong." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("search")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        { type: "tool-call", toolCallId: "turn-err1-tools", toolName: "tool_timeline", args: {}, argsText: "", result: [{ callId: "call-1", packageId: "websearch", state: "error", failureKind: "timed out" }] },
        { type: "text", text: "Something went wrong." },
      ]);
    } finally {
      env.restore();
    }
  });

  test("tool_error text is never stored on the timeline call", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: {}, call_id: "call-1" },
        { t: "tool_error", call_id: "call-1", package_id: "websearch", error: "unavailable" },
        { type: "done", value: { turn_id: "turn-err2", reply: { text: "I could not look that up." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("search")]);
      const timeline = yields.at(-1)?.content?.find((part) => part.type === "tool-call");
      expect(timeline).toMatchObject({ result: [{ failureKind: "unavailable" }] });
      expect(JSON.stringify(timeline)).not.toContain("raw");
    } finally {
      env.restore();
    }
  });

  test("two interleaved tool calls keep call order and resolve independently", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: {}, call_id: "call-1" },
        { t: "tool_call", package_id: "weather", args: {}, call_id: "call-2" },
        { t: "tool_result", call_id: "call-2", package_id: "weather", outcome: { text: "61F" } },
        { t: "tool_result", call_id: "call-1", package_id: "websearch", outcome: { text: "3 results" } },
        { type: "done", value: { turn_id: "turn-multi1", reply: { text: "Here's what I found." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("search and check weather")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        {
          type: "tool-call",
          toolCallId: "turn-multi1-tools",
          toolName: "tool_timeline",
          args: {},
          argsText: "",
          result: [
            { callId: "call-1", packageId: "websearch", state: "ok" },
            { callId: "call-2", packageId: "weather", state: "ok" },
          ],
        },
        { type: "text", text: "Here's what I found." },
      ]);
    } finally {
      env.restore();
    }
  });

  // A review caught this: the kit's own ToolTimeline Element used to key
  // each rendered step by `chip` (the package id) - two calls to the
  // SAME package in one turn (two separate searches, e.g.) would collide
  // on an identical React key. Fixed in the kit (key by index, ui-v0.5.28,
  // the same fix elements/sources.tsx already got for its own domain-key
  // collision) - this proves the DATA side doesn't collapse the two
  // calls into one entry, which the render-side key fix depends on.
  test("two calls to the same package keep two distinct entries", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: { query: "tide chart" }, call_id: "call-1" },
        { t: "tool_call", package_id: "websearch", args: { query: "moon phase" }, call_id: "call-2" },
        { t: "tool_result", call_id: "call-1", package_id: "websearch", outcome: { text: "3 results" } },
        { t: "tool_result", call_id: "call-2", package_id: "websearch", outcome: { text: "1 result" } },
        { type: "done", value: { turn_id: "turn-samepkg1", reply: { text: "Here's what I found." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("search twice")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([
        {
          type: "tool-call",
          toolCallId: "turn-samepkg1-tools",
          toolName: "tool_timeline",
          args: {},
          argsText: "",
          result: [
            { callId: "call-1", packageId: "websearch", state: "ok" },
            { callId: "call-2", packageId: "websearch", state: "ok" },
          ],
        },
        { type: "text", text: "Here's what I found." },
      ]);
    } finally {
      env.restore();
    }
  });

  test("a tool_result for a call_id never seen is ignored, not invented as a step", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { t: "tool_result", call_id: "call-orphan", package_id: "websearch", outcome: { text: "3 results" } },
        { type: "delta", text: "Here's what I found." },
        { type: "done", value: { turn_id: "turn-orphan1", reply: { text: "Here's what I found." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("search")]);
      const last = yields[yields.length - 1];
      expect(last?.content).toEqual([{ type: "text", text: "Here's what I found." }]);
    } finally {
      env.restore();
    }
  });
});

// Lane 11 item 1 (docs/plans/session-b-lane-11-2026-09-13.md): CHAT-16's
// forward-compatible `status` event (chatTurnActivity.ts's own header on
// why it's cast this way, not yet a real TurnStreamEvent member) and the
// transient activity line both producer sides drive - the render side
// (thread.aui.tsx's "indicator" case reading chatTurnActivity.ts's
// useTurnActivity()) is the same "read straight off the message's own
// metadata" shape the old source caption and chatMemoryChip.tsx already
// have direct coverage for, so what's new here is only the producer: what the
// adapter yields and when, one test per acceptance promise. No live
// screenshot is possible for this item: the backend doesn't emit a real
// `status` event yet (Session A, CHAT-16) - this file's own stubbed
// stream is the only fixture that exists to test against.
describe("Lane 11 item 1: the transient activity line (chatTurnActivity.ts)", () => {
  test("a status event sets the activity line; the first delta clears it", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "status", text: "Checking that for you", stage: "lookup" },
        { type: "delta", text: "Here's what I found." },
        { type: "done", value: { reply: { text: "Here's what I found." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("what's the weather")]);
      expect(yields[0]).toEqual({ metadata: { custom: { activity: "Checking that for you" } } });
      expect(yields[1]).toEqual({ metadata: { custom: {} } });
      expect(yields[2]).toEqual({ content: [{ type: "text", text: "Here's what I found." }] });
      expect(lastText(yields)).toBe("Here's what I found.");
    } finally {
      env.restore();
    }
  });

  // An immediate plugin/safety reply never emits a "delta" at all
  // (chatModelAdapter.ts's own "done" comment) - the terminal event has
  // to be the fallback that clears a shown activity line, not only a
  // delta, or a quick tool-floor reply would leave "Checking that for
  // you" stuck in the message's metadata forever.
  test("a done event with no delta in between still clears a shown activity line", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "status", text: "One moment", stage: "tool" },
        { type: "done", value: { reply: { text: "Quick answer." }, source: "plugin", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("do a thing")]);
      expect(yields[0]).toEqual({ metadata: { custom: { activity: "One moment" } } });
      const finalYield = yields[yields.length - 1];
      expect(finalYield?.metadata?.custom).not.toHaveProperty("activity");
      expect(lastText(yields)).toBe("Quick answer.");
    } finally {
      env.restore();
    }
  });

  test("a stream with no status or spoken_cue never touches the activity line", async () => {
    const env = stubEnvironment(
      ndjsonStream([
        { type: "delta", text: "Plain reply." },
        { type: "done", value: { reply: { text: "Plain reply." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("hi")]);
      expect(yields.some((y) => y.metadata?.custom && "activity" in y.metadata.custom)).toBe(false);
      expect(lastText(yields)).toBe("Plain reply.");
    } finally {
      env.restore();
    }
  });
});

describe("createChatModelAdapter errors", () => {
  test("a mid-stream error event surfaces the friendly down-state message", async () => {
    const env = stubEnvironment(
      ndjsonStream([{ type: "delta", text: "Partial reply" }, { type: "error", error: "chat model unavailable: llama-server crashed" }]),
    );
    try {
      const { error } = await collect([fakeUserMessage("hi")]);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("MaiPai's AI isn't running right now. Try again in a moment.");
      expect((error as Error).message).not.toContain("llama-server");
      expect(error).toMatchObject({ code: "unavailable" });
    } finally {
      env.restore();
    }
  });

  test("a streamed error event becomes a ChatTurnError with its code and the turn id", async () => {
    const message = "The chat engine is unavailable. Try again soon.";
    const env = stubEnvironment(
      ndjsonStream([
        { type: "turn_meta", conversation_id: "conv-resume123", turn_id: "turn-resume123", resume_token: "resume-token-test" },
        { type: "error", error: message, code: "engine_unavailable" },
      ]),
    );
    try {
      const { error } = await collect([fakeUserMessage("hi")]);
      expect(error).toBeInstanceOf(ChatTurnError);
      expect(error).toMatchObject({ message, code: "engine_unavailable", turnId: "turn-resume123" });
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
      expect((error as Error).message).toBe("MaiPai's AI isn't running right now. Try again in a moment.");
    } finally {
      env.restore();
    }
  });

  test("an interrupted stream reconnects from its sequence without duplicating acknowledged text", async () => {
    const value = { reply: { text: "Hello world." }, source: "model", safety: SAFETY, turn_id: "turn-resume123", conversation_id: "conv-resume123" };
    const env = stubEnvironment(
      ndjsonStream([
        { type: "turn_meta", conversation_id: "conv-resume123", turn_id: "turn-resume123", resume_token: "resume-token-test" },
        { type: "delta", text: "Hello", sequence: 1 },
      ]),
      [
        ndjsonStream([
          { type: "turn_meta", conversation_id: "conv-resume123", turn_id: "turn-resume123", resume_token: "resume-token-test" },
          { type: "delta", text: "Hello", sequence: 1 },
          { type: "delta", text: " world.", sequence: 2 },
          { type: "done", value },
        ]),
      ],
    );
    try {
      const result = await collect([fakeUserMessage("hi")]);
      expect(result.error).toBeUndefined();
      expect(lastText(result.yields)).toBe("Hello world.");
      expect(env.turnBodies).toHaveLength(2);
      expect(env.turnBodies[1]).toMatchObject({
        conversation_id: "conv-resume123",
        turn_id: "turn-resume123",
        resume_token: "resume-token-test",
        resume_from: 1,
      });
    } finally {
      env.restore();
    }
  });

  test("a dropped stream with a resume token reports reconnecting then resumed then online", async () => {
    const connection: { phase: string; attempt?: number; resumedTokens?: number }[] = [];
    const value = { reply: { text: "Hello world." }, source: "model", safety: SAFETY, turn_id: "turn-resume123", conversation_id: "conv-resume123" };
    const env = stubEnvironment(
      ndjsonStream([{ type: "turn_meta", conversation_id: "conv-resume123", turn_id: "turn-resume123", resume_token: "resume-token-test" }, { type: "delta", text: "Hello", sequence: 1 }]),
      [ndjsonStream([{ type: "turn_meta", conversation_id: "conv-resume123", turn_id: "turn-resume123", resume_token: "resume-token-test" }, { type: "delta", text: " world.", sequence: 2 }, { type: "done", value }])],
    );
    try {
      const result = await collect([fakeUserMessage("hi")], undefined, () => {}, undefined, undefined, (state) => connection.push(state));
      expect(result.error).toBeUndefined();
      expect(connection).toEqual([{ phase: "online" }, { phase: "reconnecting", attempt: 1 }, { phase: "resumed", resumedTokens: 1 }, { phase: "online" }]);
    } finally { env.restore(); }
  });

  test("a stream that cannot resume reports dropped before the error", async () => {
    const connection: string[] = [];
    const env = stubEnvironment(ndjsonStream([{ type: "delta", text: "Partial" }]));
    try {
      const result = await collect([fakeUserMessage("hi")], undefined, () => {}, undefined, undefined, (state) => connection.push(state.phase));
      expect(result.error).toBeInstanceOf(Error);
      expect(connection).toEqual(["online", "dropped"]);
    } finally { env.restore(); }
  });

  test("an unreachable hub becomes a ChatTurnError with code client_unreachable", async () => {
    const env = stubEnvironment(() => Promise.reject(new Error("network error")));
    try {
      const { error } = await collect([fakeUserMessage("hi")]);
      expect(error).toBeInstanceOf(ChatTurnError);
      expect((error as Error).message).toMatch(/Could not reach the hub/);
      expect(error).toMatchObject({ code: "client_unreachable", turnId: undefined });
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

  // Jesse, 2026-09-06: stopping a reply should behave like every other
  // voice/chat app's barge-in - cut audio immediately, not let whatever's
  // already queued keep playing out. scheduler.stop() (unlike finish())
  // closes the AudioContext right away, so that's the observable signal
  // a user-initiated stop actually took the barge-in path.
  test("an aborted run cuts audio immediately (stop), not letting it finish naturally", async () => {
    const originalClose = FakeAudioContext.prototype.close;
    const close = mock(() => Promise.resolve());
    FakeAudioContext.prototype.close = close;
    const controller = new AbortController();
    const env = stubEnvironment(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    try {
      const { error } = await collect([fakeUserMessage("hi")], controller.signal);
      expect(error).toBeInstanceOf(DOMException);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      FakeAudioContext.prototype.close = originalClose;
      env.restore();
    }
  });

  // The flip side: a genuine failure (not a user-initiated stop) still
  // lets whatever's already been enqueued finish naturally - only a real
  // Stop click is barge-in.
  test("a mid-stream failure that isn't a user stop never cuts audio short", async () => {
    const originalClose = FakeAudioContext.prototype.close;
    const close = mock(() => Promise.resolve());
    FakeAudioContext.prototype.close = close;
    const env = stubEnvironment(
      ndjsonStream([{ type: "delta", text: "Partial reply" }, { type: "error", error: "chat model unavailable: llama-server crashed" }]),
    );
    try {
      const { error } = await collect([fakeUserMessage("hi")]);
      expect(error).toBeInstanceOf(Error);
      expect(close).not.toHaveBeenCalled();
    } finally {
      FakeAudioContext.prototype.close = originalClose;
      env.restore();
    }
  });

  // A coded error (e.g., "safety_refused" from the backend) surfaces the
  // backend's own message, not the generic "AI isn't answering" banner.
  test("a safety_refused error surfaces the backend's message, not the generic banner", async () => {
    const env = stubEnvironment(
      ndjsonStream([{ type: "delta", text: "Partial reply" }, { type: "error", error: "That response violated our safety policy", code: "safety_refused" }]),
    );
    try {
      const { error } = await collect([fakeUserMessage("hi")]);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("That response violated our safety policy");
      expect((error as Error).message).not.toMatch(/check Household/);
    } finally {
      env.restore();
    }
  });

  // SAFETY-01 (#85): a streamed refusal's crisis resources ride on the
  // error event, the one terminal event it sends, and are shown the
  // same way a done value's are.
  test("the crisis resources still reach the banner callback on a safety refusal", async () => {
    const line = "If you're in crisis, the 988 Suicide & Crisis Lifeline is free and available 24/7: call or text 988.";
    const env = stubEnvironment(ndjsonStream([{ type: "delta", text: "Partial reply" }, { type: "error", error: "That response violated our safety policy", code: "safety_refused", crisis_resources: line }]));
    const shown: string[] = [];
    try {
      const { error } = await collect([fakeUserMessage("hi")], new AbortController().signal, (text) => shown.push(text));
      expect(error).toBeInstanceOf(ChatTurnError);
      expect((error as ChatTurnError).code).toBe("safety_refused");
      expect(shown).toEqual([line]);
    } finally {
      env.restore();
    }
  });

  // Issue #163, found by a code review of that fix: turning Incognito on
  // via the header toggle mid-chat (not New Thread) still sends the
  // existing durable conversation id, which the backend now refuses with
  // `code: "temporary_mismatch"` (a plain 400 before any stream event, not
  // a mid-stream one - rawStreamPost's own non-ok branch, api.ts). Without
  // this case the person would see the backend's raw, id-bearing error
  // string instead of something they can act on.
  test("a temporary_mismatch error (Incognito turned on mid-chat) gives an actionable message, not the raw backend string", async () => {
    const env = stubEnvironment(
      (() => Promise.resolve(new Response(JSON.stringify({ error: "conversation conv-existing123 is a durable conversation, not temporary", code: "temporary_mismatch" }), { status: 400 }))) as unknown as () => Promise<never>,
    );
    try {
      const { error } = await collect([fakeUserMessage("hi")]);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Incognito can't turn on partway through a chat. Start a new chat to go incognito.");
    } finally {
      env.restore();
    }
  });
});

// getmaipai/home#60: an edited message survives a history reload.
// chatHistoryAdapter.test.ts covers the branch reconstruction itself; this
// covers the two pieces run() is responsible for that make it possible -
// sending the edit's own supersedes and stamping a live reply's real turn
// id, both proven directly rather than through a full ChatPage render
// (that render path hit a genuine happy-dom/Radix hover-and-click
// limitation, the same class of gap ChatPage.test.tsx's own header
// comment already documents for a different component; verified live in
// the running app instead).
describe("getmaipai/home#60: supersedes and live turnId", () => {
  test("consumeSupersedes()'s value is sent as the request body's supersedes field", async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    let capturedBody: { supersedes?: string } | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/turn/stream")) {
        capturedBody = JSON.parse(String(init?.body ?? "{}"));
        return Promise.resolve(
          new Response(ndjsonStream([{ type: "done", value: { reply: { text: "ok" }, source: "model", safety: SAFETY } }]), {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
          }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;
    try {
      const adapter = createChatModelAdapter({
        consumeThinking: () => false,
        consumeSupersedes: () => "turn-original123",
        onCrisisResources: () => {},
        turnSchedulerRef: { current: null },
      });
      const options = {
        messages: [fakeUserMessage("edited text")],
        runConfig: {},
        abortSignal: new AbortController().signal,
        context: {},
        unstable_getMessage: () => fakeUserMessage("edited text"),
      } as unknown as ChatModelRunOptions;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of runAdapter(adapter, options)) {
        /* drain */
      }
      expect(capturedBody).toMatchObject({ supersedes: "turn-original123" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a continuation carries the stable partial answer and its source turn", async () => {
    const env = stubEnvironment(
      ndjsonStream([{ type: "done", value: { reply: { text: "The rest." }, source: "model", safety: SAFETY, turn_id: "turn-next", conversation_id: "conv-next" } }]),
    );
    const adapter = createChatModelAdapter({
      consumeThinking: () => false,
      consumeSupersedes: () => undefined,
      consumeContinuation: () => ({ assistantText: "The answer stopped here.", fromTurnId: "turn-stopped" }),
      onCrisisResources: () => {},
      turnSchedulerRef: { current: null },
    });
    try {
      const options = { messages: [fakeUserMessage("Tell me about bicycles")], runConfig: {}, abortSignal: new AbortController().signal, context: {}, unstable_getMessage: () => fakeUserMessage("Tell me about bicycles") } as unknown as ChatModelRunOptions;
      for await (const value of runAdapter(adapter, options)) {
        void value;
      }
      expect(env.turnBodies[0]).toMatchObject({ text: "Tell me about bicycles", continuation_text: "The answer stopped here.", continuation_of: "turn-stopped" });
    } finally {
      env.restore();
    }
  });

  test("a length-stopped done event leaves the assistant message incomplete", async () => {
    const env = stubEnvironment(
      ndjsonStream([{ type: "done", value: { reply: { text: "Partial answer" }, source: "model", safety: SAFETY, stats: { stop_reason: "length" } } }]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("hi")]);
      expect(yields.at(-1)?.status).toEqual({ type: "incomplete", reason: "length" });
    } finally {
      env.restore();
    }
  });

  // Fixes the gap chatActionBar.tsx's own comment named: "a message from
  // the CURRENT live session has none yet" - turnId used to be populated
  // only once a reload rebuilt it from the database (chatHistoryAdapter.ts).
  test("the done event stamps the real turn_id onto the reply's own metadata for a live (not-yet-reloaded) turn", async () => {
    const env = stubEnvironment(
      ndjsonStream([{ type: "done", value: { reply: { text: "ok" }, source: "model", safety: SAFETY, turn_id: "turn-live456", conversation_id: "conv-live456" } }]),
    );
    try {
      const { yields } = await collect([fakeUserMessage("hi")]);
      const last = yields[yields.length - 1];
      expect(last?.metadata?.custom?.turnId).toBe("turn-live456");
    } finally {
      env.restore();
    }
  });

  test("a completed document notifies the research-mode pane after the line", async () => {
    const env = stubEnvironment(
      ndjsonStream([{ type: "done", value: { reply: { text: "Short answer." }, source: "model", safety: SAFETY, turn_id: "turn-research456", conversation_id: "conv-research456", document_available: true } }]),
    );
    const opened: string[] = [];
    const adapter = createChatModelAdapter({
      consumeThinking: () => false,
      consumeSupersedes: () => undefined,
      onCrisisResources: () => {},
      onResearchDocument: (turnId) => opened.push(turnId),
      turnSchedulerRef: { current: null },
    });
    try {
      const { yields } = await (async () => {
        const options = { messages: [fakeUserMessage("research this")], runConfig: {}, abortSignal: new AbortController().signal, context: {}, unstable_getMessage: () => fakeUserMessage("research this") } as unknown as ChatModelRunOptions;
        const values: ChatModelRunResult[] = [];
        for await (const value of runAdapter(adapter, options)) values.push(value);
        return { yields: values };
      })();
      expect(lastText(yields)).toBe("Short answer.");
      expect(opened).toEqual(["turn-research456"]);
    } finally {
      env.restore();
    }
  });

  // A code review (2026-09-13) found consumeSupersedes() was called after
  // `await deps.getConversationId?.()` and `abortSignal.throwIfAborted()` -
  // an abort or a getConversationId() failure before that point threw past
  // the read-and-reset, leaving chatEditSupersedes.ts's module-scope ref
  // stuck with a stale edit's turn id for the NEXT, unrelated send to
  // wrongly inherit. Moved ahead of both; this proves it stays drained
  // even when everything after it fails.
  test("consumeSupersedes() is drained even when getConversationId() fails before the request is ever sent", async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    let consumed = false;
    const adapter = createChatModelAdapter({
      consumeThinking: () => false,
      consumeSupersedes: () => {
        consumed = true;
        return "turn-original123";
      },
      getConversationId: () => Promise.reject(new Error("conversation resolution failed")),
      onCrisisResources: () => {},
      turnSchedulerRef: { current: null },
    });
    const options = {
      messages: [fakeUserMessage("hi")],
      runConfig: {},
      abortSignal: new AbortController().signal,
      context: {},
      unstable_getMessage: () => fakeUserMessage("hi"),
    } as unknown as ChatModelRunOptions;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of runAdapter(adapter, options)) {
        /* drain */
      }
    } catch {
      /* the failure itself is expected and irrelevant here */
    }
    expect(consumed).toBe(true);
  });
});

describe("the chat asks for the assistant-stream wire", () => {
  test("every turn request, first send and reconnect alike, sends Accept: application/x-assistant-stream", async () => {
    const env = stubEnvironment(
      ndjsonStream([{ type: "turn_meta", conversation_id: "c1", turn_id: "t1", resume_token: "r1" }, { type: "delta", text: "Hi", sequence: 1 }]),
      [ndjsonStream([{ type: "delta", text: " there", sequence: 2 }, { type: "done", value: { turn_id: "t1", reply: { text: "Hi there" }, safety: SAFETY } }])],
    );
    try {
      const { yields, error } = await collect([fakeUserMessage("hello")]);
      expect(error).toBeUndefined();
      expect(lastText(yields)).toBe("Hi there");
      expect(env.turnAccepts).toEqual(["application/x-assistant-stream", "application/x-assistant-stream"]);
    } finally {
      env.restore();
    }
  });
});

describe("behaviours the old NDJSON adapter carried, proven on the assistant-stream path", () => {
  async function collectWith(deps: Partial<Parameters<typeof createChatModelAdapter>[0]>, text: string) {
    const adapter = createChatModelAdapter({ consumeThinking: () => false, consumeSupersedes: () => undefined, onCrisisResources: () => {}, turnSchedulerRef: { current: null }, ...deps });
    const messages = [fakeUserMessage(text)];
    const options = { messages, runConfig: {}, abortSignal: new AbortController().signal, context: {}, unstable_getMessage: () => messages[0]! } as unknown as ChatModelRunOptions;
    const yields: ChatModelRunResult[] = [];
    for await (const r of runAdapter(adapter, options)) yields.push(r);
    return yields;
  }

  test("Incognito: the single-shot temporary choice rides the request once, and the reply streams as usual", async () => {
    const env = stubEnvironment(ndjsonStream([{ type: "delta", text: "Sure.", sequence: 1 }, { type: "done", value: { reply: { text: "Sure." }, safety: SAFETY, turn_id: "t9", conversation_id: "c9" } }]));
    let armed = true;
    try {
      const yields = await collectWith({ consumeTemporary: () => { const was = armed; armed = false; return was ? true : undefined; } }, "hi");
      expect(lastText(yields)).toBe("Sure.");
      expect(env.turnBodies[0]).toMatchObject({ temporary: true });
      expect(armed).toBe(false);
    } finally {
      env.restore();
    }
  });

  test("a done event's crisis_resources are offered alongside the reply, not in place of it", async () => {
    const line = "If you're in crisis, call or text 988.";
    const env = stubEnvironment(ndjsonStream([{ type: "delta", text: "I'm here with you.", sequence: 1 }, { type: "done", value: { reply: { text: "I'm here with you." }, safety: SAFETY, crisis_resources: line, turn_id: "t8", conversation_id: "c8" } }]));
    const shown: string[] = [];
    try {
      const yields = await collectWith({ onCrisisResources: (text) => shown.push(text) }, "I feel awful");
      expect(lastText(yields)).toBe("I'm here with you.");
      expect(shown).toEqual([line]);
    } finally {
      env.restore();
    }
  });

  test("released text reaches the screen piece by piece as it arrives: no client-side buffering or re-splitting", async () => {
    const { stream, release } = staggeredNdjsonStream([{ type: "delta", text: "Half a sen", sequence: 1 }], [{ type: "delta", text: "tence.", sequence: 2 }, { type: "done", value: { reply: { text: "Half a sentence." }, safety: SAFETY, turn_id: "t7", conversation_id: "c7" } }]);
    const env = stubEnvironment(stream);
    try {
      const adapter = createChatModelAdapter({ consumeThinking: () => false, consumeSupersedes: () => undefined, onCrisisResources: () => {}, turnSchedulerRef: { current: null }, speakReplies: false });
      const messages = [fakeUserMessage("hi")];
      const run = runAdapter(adapter, { messages, runConfig: {}, abortSignal: new AbortController().signal, context: {}, unstable_getMessage: () => messages[0]! } as unknown as ChatModelRunOptions);
      const first = await run.next();
      expect(first.value?.content?.[0]).toMatchObject({ type: "text", text: "Half a sen" });
      release();
      for await (const _ of run) void _;
    } finally {
      env.restore();
    }
  });
});
