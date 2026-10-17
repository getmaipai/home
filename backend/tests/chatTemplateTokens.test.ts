// Chat-template control tokens never reach a person, a voice or a stored reply (lib/chatTemplateTokens.ts,
// applied at the Stack client boundary in lib/llm.ts).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ChatTemplateTokenFilter, stripChatTemplateTokens } from "@/lib/chatTemplateTokens";
import { complete, startCompleteStreamPieces } from "@/lib/llm";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { IDENTITY_HEADERS, startStackFixture, getDefaultScriptedStack, useDefaultScriptedStack } from "./stackFixture";
import { resetDb } from "./reset-db";

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __setStackClientForTests(getDefaultScriptedStack().client);
});
afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetStackEngineForTests();
});

describe("stripChatTemplateTokens", () => {
  test("the exact leaked sample and the harmony tokens come out", () => {
    expect(stripChatTemplateTokens("red<|message|>")).toBe("red");
    expect(stripChatTemplateTokens("<|channel|>final<|message|>It is red.<|return|>")).toBe("It is red.");
    expect(stripChatTemplateTokens("<|start|>assistant<|channel|>analysis<|message|>Think.<|end|>Done.")).toBe("Think.Done.");
    expect(stripChatTemplateTokens("Hi<|im_end|><|endoftext|>")).toBe("Hi");
  });
  test("ordinary text, pipes and angle brackets are unchanged", () => {
    for (const text of ["a < b and c > d", "x <|> y", "use a | pipe", "<b>bold</b>", "if (a <| b)", "Hello, how are you?"]) expect(stripChatTemplateTokens(text)).toBe(text);
  });
  test("a reply that is only a token becomes empty", () => {
    expect(stripChatTemplateTokens("<|message|>")).toBe("");
    expect(stripChatTemplateTokens("<|channel|>final<|message|>")).toBe("");
  });
});

describe("ChatTemplateTokenFilter", () => {
  const sample = "<|channel|>final<|message|>The sky is red<|message|> at dusk.<|return|>";
  const expected = "The sky is red at dusk.";
  test("the same result however the pieces are split", () => {
    for (let i = 0; i <= sample.length; i++) {
      for (let j = i; j <= sample.length; j++) {
        const filter = new ChatTemplateTokenFilter();
        const out = filter.push(sample.slice(0, i)) + filter.push(sample.slice(i, j)) + filter.push(sample.slice(j)) + filter.flush();
        expect(out).toBe(expected);
      }
    }
  });
  test("one character at a time", () => {
    const filter = new ChatTemplateTokenFilter();
    let out = "";
    for (const ch of sample) out += filter.push(ch);
    expect(out + filter.flush()).toBe(expected);
  });
  test("a trailing lone angle bracket is released at the end of the stream", () => {
    const filter = new ChatTemplateTokenFilter();
    expect(filter.push("a <") + filter.flush()).toBe("a <");
  });
});

function sseChat(deltas: string[], blockingContent: string) {
  return startStackFixture({
    "POST /v1/chat/completions": async (req) => {
      const body = (await req.clone().json()) as { stream?: boolean };
      if (!body.stream) return Response.json({ model: "m", choices: [{ index: 0, message: { role: "assistant", content: blockingContent }, finish_reason: "stop" }] }, { headers: IDENTITY_HEADERS });
      const enc = new TextEncoder();
      const lines = deltas.map((d) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: d }, finish_reason: null }] })}\n\n`);
      lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`, "data: [DONE]\n\n");
      return new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(enc.encode(l)); c.close(); } }), { headers: { "content-type": "text/event-stream", ...IDENTITY_HEADERS } });
    },
  });
}

describe("at the Stack client boundary", () => {
  test("a streamed reply with a token split across pieces arrives clean", async () => {
    const fixture = sseChat(["The answer is red", "<|mes", "sage|>", " and done."], "unused");
    __setStackClientForTests(fixture.client);
    try {
      const started = await startCompleteStreamPieces("chat", [{ role: "user", content: "color?" }]);
      if (!started.ok) throw new Error(started.error);
      let text = "";
      for (;;) {
        const step = await started.pieces.next();
        if (step.done) break;
        if (step.value.channel === "text") text += step.value.text;
      }
      expect(text).toBe("The answer is red and done.");
    } finally { fixture.stop(); }
  });
  test("a blocking completion is clean too", async () => {
    const fixture = sseChat([], "red<|message|>");
    __setStackClientForTests(fixture.client);
    try {
      const result = await complete("chat", [{ role: "user", content: "color?" }]);
      expect(result.ok && result.value.text).toBe("red");
    } finally { fixture.stop(); }
  });
});
