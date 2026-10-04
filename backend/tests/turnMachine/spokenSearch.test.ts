// THIN-4F (docs/design/RULES.md rules 1, 6, 8, 12; backlog THIN-4F): a
// spoken turn that searches keeps its first word inside 3 s by reading
// fewer pages and sending the answering round only the top rows' short
// text. A written adult turn is unchanged. Same stub pattern as
// turnNext.test.ts: the real machine, a scripted model, a fake SearXNG.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, startRecordingProxy, type BenchPeople } from "../../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { __setPageReaderForTests, __resetSearchCacheForTests, SEARCH_PAGES_MAX, SEARCH_PAGES_MAX_SPOKEN, SEARCH_PAGE_TEXT_CHARS_SPOKEN } from "@/lib/packageHost";
import { SPOKEN_EVIDENCE_TOKENS_MAX, SPOKEN_SOURCES_MAX, SPOKEN_SOURCE_TEXT_CHARS } from "@/lib/composer";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __setPageReaderForTests(null);
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function withStub<T>(reply: (request: ChatCompletionRequest) => string, fn: () => Promise<T>): Promise<T> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedChatReply: reply,
    scriptedToolCalls: (request) => {
      if (!request.tools || request.tools.length === 0 || request.messages.some((m) => m.role === "tool")) return undefined;
      return [{ id: "call-1", type: "function" as const, function: { name: "websearch", arguments: JSON.stringify({ expression: "berlin wall anniversary" }) } }];
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    return await fn();
  } finally {
    proxy.stop();
    await stub.stop();
  }
}

/** Runs one searching turn with a long page behind every result and returns
 * the answering round's tool message plus how many pages were fetched. */
async function searchTurn(opts: { spoken: boolean }): Promise<{ toolContent: string; fetched: string[] }> {
  const results = [1, 2, 3, 4, 5].map((n) => ({ title: `Result ${n}`, url: `https://site${n}.example.com/page`, content: `snippet ${n} about the wall` }));
  const searxng = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ query: "berlin wall anniversary", results }) });
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
  const fetched: string[] = [];
  __setPageReaderForTests(async (url) => {
    fetched.push(url);
    return { type: "document", file_id: "file-1", url, title: "A page", text: "x".repeat(6_000), chunks: [], links: [], sections: [] };
  });
  let toolContent = "";
  try {
    const result = await withStub(
      (request) => {
        const tool = request.messages.find((m) => m.role === "tool");
        if (tool) toolContent = String(tool.content);
        return tool ? "Here's what I found." : "searching";
      },
      () => runTurnNext(people.owner, "chat", "when did the berlin wall come down", opts.spoken ? { spoken: true } : undefined),
    );
    expect(result.ok).toBe(true);
  } finally {
    searxng.stop(true);
  }
  return { toolContent, fetched };
}

describe("a spoken turn with a search (THIN-4F)", () => {
  test("the answering round carries at most the spoken evidence budget, numbered, with short text per source", async () => {
    const { toolContent } = await searchTurn({ spoken: true });
    expect(toolContent).toContain('"n":1');
    expect(Math.ceil(toolContent.length / 4)).toBeLessThanOrEqual(SPOKEN_EVIDENCE_TOKENS_MAX);
    const payload = JSON.parse(toolContent) as { sources: { n: number; page_text?: string }[] };
    expect(payload.sources.length).toBeLessThanOrEqual(SPOKEN_SOURCES_MAX);
    for (const source of payload.sources) expect((source.page_text ?? "").length).toBeLessThanOrEqual(SPOKEN_SOURCE_TEXT_CHARS);
  });

  test("it reads no more than the spoken page budget, each page cut to the spoken text cap", async () => {
    const { fetched } = await searchTurn({ spoken: true });
    expect(SEARCH_PAGES_MAX_SPOKEN).toBeLessThan(SEARCH_PAGES_MAX);
    expect(SEARCH_PAGE_TEXT_CHARS_SPOKEN).toBeLessThanOrEqual(SPOKEN_SOURCE_TEXT_CHARS + 100);
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.length).toBeLessThanOrEqual(SEARCH_PAGES_MAX_SPOKEN);
  });
});

describe("a written adult turn with a search is unchanged (THIN-4F)", () => {
  test("it reads the full page budget and the answering round carries the written page text, not the spoken cut", async () => {
    const { toolContent, fetched } = await searchTurn({ spoken: false });
    expect(fetched.length).toBe(SEARCH_PAGES_MAX);
    const payload = JSON.parse(toolContent) as { sources: { page_text?: string }[] };
    // THIN-GROUND-01 sizes the written evidence from the model's window (this stub's 4,096
    // tokens halve each 2,500-character page once), so the promise is "the written cap,
    // far above the spoken one", not a fixed 2,500.
    const pageLengths = payload.sources.filter((s) => s.page_text).map((s) => s.page_text!.length);
    expect(pageLengths).toHaveLength(SEARCH_PAGES_MAX);
    for (const length of pageLengths) expect(length).toBeGreaterThan(SPOKEN_SOURCE_TEXT_CHARS * 2);
    expect(toolContent.length).toBeGreaterThan(SPOKEN_EVIDENCE_TOKENS_MAX * 4);
  });
});
