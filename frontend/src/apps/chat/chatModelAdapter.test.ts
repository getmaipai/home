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

function stubEnvironment(streamBody: ReadableStream<Uint8Array> | (() => Promise<never>), additionalStreams: ReadableStream<Uint8Array>[] = []) {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  const originalFetch = globalThis.fetch;
  const ttsCalls: string[] = [];
  const turnBodies: unknown[] = [];
  let turnCalls = 0;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/turn/stream")) {
      turnBodies.push(JSON.parse(String(init?.body ?? "{}")));
      if (typeof streamBody === "function") return streamBody();
      const call = turnCalls++;
      const body = call === 0 ? streamBody : additionalStreams[call - 1] ?? streamBody;
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
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
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function collect(messages: ThreadMessage[], abortSignal = new AbortController().signal, onCrisisResources: (text: string) => void = () => {}): Promise<{ yields: ChatModelRunResult[]; error?: unknown }> {
  const adapter = createChatModelAdapter({
    consumeThinking: () => false,
    consumeSupersedes: () => undefined,
    onCrisisResources,
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

  // A code review (2026-09-06) found that a delta landing entirely inside
  // an open <think> block still yielded an empty-string "text" content
  // part - enough for assistant-ui's built-in "no-text" indicator check
  // (thread.aui.tsx) to treat the message as having text and hide its
  // pulsing "Assistant is working" dot, well before there was anything
  // visible to replace it with. Someone without audio (speakers off, or
  // deaf) lost the only signal that MaiPai was still working.
  test("no content is yielded while inside a <think> block with nothing visible yet - the loading indicator stays up", async () => {
    const { stream, release } = staggeredNdjsonStream(
      [{ type: "delta", text: "<think>reasoning about the" }],
      [
        { type: "delta", text: " answer here</think>The real answer." },
        { type: "done", value: { reply: { text: "<think>reasoning about the answer here</think>The real answer." }, source: "model", safety: SAFETY } },
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
        messages: [fakeUserMessage("what's the answer")],
        runConfig: {},
        abortSignal,
        context: {},
        unstable_getMessage: () => fakeUserMessage("what's the answer"),
      } as unknown as ChatModelRunOptions;
      const yields: ChatModelRunResult[] = [];
      const done = (async () => {
        for await (const r of runAdapter(adapter, options)) yields.push(r);
      })();

      // Only the still-open <think> block has arrived so far - nothing
      // visible exists yet, so nothing should have yielded (the indicator
      // stays up rather than being replaced by an empty text part).
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(yields).toHaveLength(0);

      release();
      await done;
      expect(lastText(yields)).toBe("The real answer.");
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  test("a tool_error marks its call failed", async () => {
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
        { type: "tool-call", toolCallId: "turn-err1-tools", toolName: "tool_timeline", args: {}, argsText: "", result: [{ callId: "call-1", packageId: "websearch", state: "error" }] },
        { type: "text", text: "Something went wrong." },
      ]);
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
// metadata" shape chatSourceCaption.tsx/chatMemoryChip.tsx already have
// direct coverage for, so what's new here is only the producer: what the
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
  test("a safety_refused error carrying crisis_resources shows them", async () => {
    const line = "If you're in crisis, the 988 Suicide & Crisis Lifeline is free and available 24/7: call or text 988.";
    const env = stubEnvironment(ndjsonStream([{ type: "delta", text: "Partial reply" }, { type: "error", error: "That response violated our safety policy", code: "safety_refused", crisis_resources: line }]));
    const shown: string[] = [];
    try {
      const { error } = await collect([fakeUserMessage("hi")], new AbortController().signal, (text) => shown.push(text));
      expect(error).toBeInstanceOf(Error);
      expect(shown).toEqual([line]);
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
