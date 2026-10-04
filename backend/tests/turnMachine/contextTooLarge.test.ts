// THIN-GROUND-01 part 2: the engine answered HTTP 400 because the prompt
// exceeded its context. That is a failure kind of its own
// (`context_too_large`), the phrasing round is retried ONCE with the evidence
// block halved and the tools block unchanged, and only then does the person
// see plain copy. "Something went wrong" never reaches them for this.
// The stream is scripted at the LLM client boundary, as modelDeadline.test.ts does.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { resetDb } from "../reset-db";
import { useDefaultScriptedStack } from "../stackFixture";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetStackEngineForTests, stackFailureResult } from "@/lib/stackEngine";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetSearchCacheForTests, __resetSearchRotationForTests, __resetSearxngEnginesCacheForTests, __setPageReaderForTests } from "@/lib/packageHost";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { FAILURE_COPY, classifyGenerationFailure, failureLine } from "@/lib/generationFailure";
import { StackError } from "@/lib/stack/errors";
import { searchEvidenceMaxChars } from "@/lib/composer";
import * as llm from "@/lib/llm";
import type { LlmMessage } from "@/lib/llm";

// What llama.cpp's server says, passed through the Stack's own error body.
const ENGINE_400 = "the request (4456 tokens) exceeds the available context size (4096 tokens), try increasing it (exceed_context_size_error)";

let people: BenchPeople;
let searxng: ReturnType<typeof Bun.serve>;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetLlmSupervisorForTests();
  __resetStackEngineForTests();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  __resetSearchRotationForTests();
  __resetSearxngEnginesCacheForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  searxng = Bun.serve({ port: 0, fetch: (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/config") return Response.json({ engines: [{ name: "google cse", enabled: true, safesearch: true, categories: ["general", "web"] }] });
    return Response.json({ results: [1, 2, 3, 4].map((n) => ({ title: `Avengers result ${n}`, url: `https://site${n}.example.com/page`, content: `Snippet ${n}`, engine: "google cse", engines: ["google cse"] })) });
  } });
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
  __setPageReaderForTests(async (url) => ({ type: "document", file_id: "f", url, title: "Page", text: "word ".repeat(2000), chunks: [], links: [], sections: [] }));
});

afterEach(() => {
  __setPageReaderForTests(null);
  searxng.stop(true);
  __resetStackEngineForTests();
});

const hasTool = (messages: LlmMessage[]) => messages.some((m) => m.role === "tool");

/** Round 1 asks for a search; every round that carries the tool result goes to `phrasing`. */
function scriptTurn(phrasing: (call: number, messages: LlmMessage[]) => { ok: false; error: string } | { ok: true; text: string }) {
  const seen: { messages: LlmMessage[]; tools: unknown }[] = [];
  let phrasingCalls = 0;
  const spy = spyOn(llm, "startCompleteStreamPieces").mockImplementation(async (_role, messages, opts) => {
    seen.push({ messages, tools: opts?.tools });
    if (!hasTool(messages)) {
      return { ok: true, pieces: (async function* () { return [{ id: "call-1", tool: "websearch", args: { expression: "when is the new avengers movie coming out" }, rawArgs: JSON.stringify({ expression: "when is the new avengers movie coming out" }) }]; })(), stats: { usage: null, timings: null, stopReason: null } };
    }
    const step = phrasing(++phrasingCalls, messages);
    if (!step.ok) return { ok: false, status: 503, code: "unavailable", error: step.error };
    return { ok: true, pieces: (async function* () { yield { channel: "text" as const, text: step.text }; return undefined; })(), stats: { usage: null, timings: null, stopReason: null } };
  });
  return { spy, seen, phrasingCalls: () => phrasingCalls };
}

const toolContent = (messages: LlmMessage[]) => String(messages.find((m) => m.role === "tool")?.content ?? "");

describe("the failure kind", () => {
  test("an engine 400 about the context size classifies as context_too_large, not other", () => {
    expect(classifyGenerationFailure(`chat model unavailable: ${ENGINE_400}`).kind).toBe("context_too_large");
    expect(classifyGenerationFailure("chat model unavailable: request exceeds the available context size").kind).toBe("context_too_large");
  });

  test("it comes through the real Stack mapping of a 400", () => {
    const failed = stackFailureResult(new StackError("unknown", ENGINE_400, { status: 400 }), "chat");
    expect(classifyGenerationFailure(failed.error).kind).toBe("context_too_large");
  });

  test("the table has plain copy for it, an adult's and a minor's, with no codes and never the generic line", () => {
    expect(FAILURE_COPY.context_too_large.adult).toBe("That was too much text for me to read in one go. Try a shorter question.");
    expect(FAILURE_COPY.context_too_large.minor).toBe("That was too much for me to read at once. Try a shorter question.");
    for (const minor of [false, true]) {
      const line = failureLine("context_too_large", minor);
      expect(line).not.toContain("Something went wrong");
      expect(line).not.toMatch(/\d{3}|exceed|token/i);
    }
  });

  test("a different 400, or a plain 'other', keeps its own kind", () => {
    expect(classifyGenerationFailure("chat model unavailable: messages must be a non-empty array").kind).toBe("other");
  });
});

describe("the phrasing round after a context overflow", () => {
  test("retries once with the evidence block cut to half and the tools block unchanged, then answers", async () => {
    const turn = scriptTurn((call) => (call === 1 ? { ok: false, error: `chat model unavailable: ${ENGINE_400}` } : { ok: true, text: "It comes out on December 18, 2026." }));
    try {
      const result = await runTurnNext(people.owner, "chat", "when is the new avengers movie coming out");
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toBe("It comes out on December 18, 2026.");
      expect(turn.phrasingCalls()).toBe(2);
      const [first, second] = turn.seen.filter((s) => hasTool(s.messages));
      // The 8B entry's context_tokens is 4000: the evidence cap is 5,600 characters, then half of it.
      const cap = searchEvidenceMaxChars(4000);
      expect(toolContent(first!.messages).length).toBeGreaterThan(cap / 2);
      expect(toolContent(first!.messages).length).toBeLessThanOrEqual(cap);
      expect(toolContent(second!.messages).length).toBeLessThanOrEqual(cap / 2);
      expect(JSON.parse(toolContent(second!.messages)).sources.length).toBeGreaterThan(0);
      expect(second!.tools).toEqual(first!.tools);
    } finally {
      turn.spy.mockRestore();
    }
  });

  test("a second overflow stops there: plain copy, one retry only, never 'Something went wrong'", async () => {
    const turn = scriptTurn(() => ({ ok: false, error: `chat model unavailable: ${ENGINE_400}` }));
    try {
      const result = await runTurnNext(people.owner, "chat", "when is the new avengers movie coming out");
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toBe(FAILURE_COPY.context_too_large.adult);
      expect(result.value.reply.text).not.toContain("Something went wrong");
      expect(turn.phrasingCalls()).toBe(2);
    } finally {
      turn.spy.mockRestore();
    }
  });

  test("a minor gets the minor wording", async () => {
    const turn = scriptTurn(() => ({ ok: false, error: `chat model unavailable: ${ENGINE_400}` }));
    try {
      const result = await runTurnNext(people.child, "chat", "when is the new avengers movie coming out");
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.reply.text).toBe(FAILURE_COPY.context_too_large.minor);
    } finally {
      turn.spy.mockRestore();
    }
  });
});
