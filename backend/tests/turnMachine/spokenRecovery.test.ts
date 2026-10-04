// THIN-4F with T5 / THIN-2G together: a spoken turn whose first tool fails and whose one retry
// round calls websearch keeps the spoken limits in that retry round: fewer pages read, the
// answering round's evidence under the spoken token budget, and still only one retry round.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { retryDeadlineMs } from "@/lib/turnMachine/deadline";
import { __setPageReaderForTests, __resetSearchCacheForTests, SEARCH_PAGES_MAX_SPOKEN } from "@/lib/packageHost";
import { SPOKEN_EVIDENCE_TOKENS_MAX, SPOKEN_SOURCES_MAX, SPOKEN_SOURCE_TEXT_CHARS } from "@/lib/composer";
import { withStub, failWeather, script, replies, isRetryRound, FROM_SEARCH, SEARCH_CALL } from "./toolHarness";

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
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

describe("a spoken turn whose tool fails and whose retry round searches", () => {
  test("the retry round's search reads the spoken page budget and the answering round stays under the spoken evidence cap", async () => {
    const results = [1, 2, 3, 4, 5].map((n) => ({ title: `Result ${n}`, url: `https://site${n}.example.com/page`, content: `snippet ${n} about the weather` }));
    const searxng = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ query: "oslo weather forecast today", results }) });
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
    const fetched: string[] = [];
    __setPageReaderForTests(async (url) => {
      fetched.push(url);
      return { type: "document", file_id: "file-1", url, title: "A page", text: "x".repeat(6_000), chunks: [], links: [], sections: [] };
    });
    const { spy } = failWeather();
    try {
      await withStub({ calls: script([SEARCH_CALL]), reply: replies }, async (seen) => {
        const result = await runTurnNext(people.owner, "chat", "what is the weather in oslo today", { spoken: true });
        expect(result.ok).toBe(true);
        if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
        expect(result.value.reply.text).toBe(FROM_SEARCH);
        expect(result.value.sources?.length).toBeGreaterThan(0);
        // One retry round, not two.
        expect(seen.filter(isRetryRound)).toHaveLength(1);
        // The search inside it read the spoken page budget, not the written one.
        expect(fetched.length).toBeGreaterThan(0);
        expect(fetched.length).toBeLessThanOrEqual(SEARCH_PAGES_MAX_SPOKEN);
        // The answering round carries the spoken evidence cap.
        const phrasing = seen.find((r) => r.messages.some((m) => m.role === "tool"))!;
        const toolContent = String(phrasing.messages.find((m) => m.role === "tool")!.content);
        expect(Math.ceil(toolContent.length / 4)).toBeLessThanOrEqual(SPOKEN_EVIDENCE_TOKENS_MAX);
        const payload = JSON.parse(toolContent) as { sources: { page_text?: string }[] };
        expect(payload.sources.length).toBeLessThanOrEqual(SPOKEN_SOURCES_MAX);
        for (const source of payload.sources) expect((source.page_text ?? "").length).toBeLessThanOrEqual(SPOKEN_SOURCE_TEXT_CHARS);
      });
    } finally {
      spy.mockRestore();
      searxng.stop(true);
    }
  });

  test("the retry round of a spoken turn runs under half the deadline, a written one under the whole", () => {
    expect(retryDeadlineMs(8_000, true)).toBe(4_000);
    expect(retryDeadlineMs(8_000, false)).toBe(8_000);
  });
});
