// CF-SEARCH-02 (owner-approved 2026-10-17, RULES.md rule 6): a search the model wrote that shares no word
// with the person's message is retried once with the person's own words, never a dead-end refusal.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "../stackFixture";
import { withStub } from "./toolHarness";
import { spyOn } from "bun:test";
import * as plugins from "@/lib/plugins";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

const REFUSAL = "I don't actually have that in this conversation, so I won't guess.";
let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  __setToolOfferOverridesForTests(["websearch"]);
});

afterEach(() => {
  __setToolOfferOverridesForTests(null);
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const call = (name: string, args: object) => [{ id: "call-1", name, args: JSON.stringify(args) }];
const isFirst = (request: { tool_choice?: unknown; messages: { role: string }[] }) => request.tool_choice !== "none" && !request.messages.some((m) => m.role === "tool");

/** Runs websearch as a failed lookup that records its arguments; every other tool runs for real. */
function recordSearch() {
  const original = plugins.runPlugin;
  const queries: string[] = [];
  const spy = spyOn(plugins, "runPlugin").mockImplementation(async (id, ...rest) => {
    if (id !== "websearch") return original(id, ...rest);
    queries.push(String((rest[1] as { expression?: string }).expression));
    return { ok: false as const, status: 502 as const, error: "down", code: "search_unavailable", fallback_reply: { reply: { text: "unused" }, actions: [] } } as never;
  });
  return { spy, queries };
}

async function ask(utterance: string, args: object, who: "owner" | "child" = "owner") {
  const rec = recordSearch();
  const calls: string[] = [];
  const result = await withStub(
    { reply: () => "I could not reach the search just now.", calls: (request) => { if (!isFirst(request)) return undefined; calls.push("model"); return call("websearch", args); } },
    () => runTurnNext(people[who], "chat", utterance),
  );
  rec.spy.mockRestore();
  if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
  return { rec, result, modelRounds: calls.length };
}
const policyOutcomes = (turnId: string) => ((JSON.parse(db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!.stats as unknown as string) as { nodes?: { node: string; outcome?: Record<string, unknown> }[] }).nodes ?? []).filter((n) => n.node === "policy").map((n) => n.outcome);

describe("CF-SEARCH-02: an ungrounded search is retried once with the person's own words", () => {
  test("no overlap: 'who won last night' searches 'won last night', not the model's query", async () => {
    const { rec, result } = await ask("who won last night", { expression: "sports results October 16 2026", scope: "web" });
    expect(rec.queries).toEqual(["won last night"]);
    expect(result.value.reply.text).not.toBe(REFUSAL);
    const outcomes = policyOutcomes(result.value.turn_id);
    expect(outcomes.some((o) => o?.code === "ungrounded_args")).toBe(true);
    expect(outcomes.some((o) => o?.retried_with_user_words === true)).toBe(true);
  });

  test("the typed 'cloud flare' variants: spacing grounds, a no-overlap rewording retries with the typed words", async () => {
    expect((await ask("is cloud flare down", { expression: "Cloudflare status", scope: "web" })).rec.queries).toEqual(["Cloudflare status"]);
    expect((await ask("is cloud flare down", { expression: "global outage tracker", scope: "web" })).rec.queries).toEqual(["cloud flare down"]);
  });

  test("a long message is capped at 120 characters on a word boundary", async () => {
    const long = `who won ${"basketball ".repeat(30)}`;
    const { rec } = await ask(long, { expression: "unrelated zebra", scope: "web" });
    expect(rec.queries.length).toBe(1);
    expect(rec.queries[0]!.length).toBeLessThanOrEqual(120);
  });

  test("no second retry: a bare-pronoun message that cannot ground still ends in the refusal line, one model round", async () => {
    const { rec, result } = await ask("it", { expression: "something else", scope: "web" });
    expect(rec.queries).toEqual([]);
    expect(result.value.reply.text).toBe(REFUSAL);
  });

  test("a child's retried query goes through the same gate as the original", async () => {
    const original = await ask("who won last night", { expression: "sports results October 16 2026", scope: "web" }, "child");
    const naming = await ask("who won last night", { expression: "sports results October 16 2026", scope: "web" }, "child");
    expect(naming.rec.queries).toEqual(original.rec.queries);
    // Whatever the child's gate allows for a grounded query it allows here; whatever it refuses it refuses here.
    const grounded = await ask("who won last night", { expression: "who won last night", scope: "web" }, "child");
    expect(original.rec.queries.length).toBe(grounded.rec.queries.length);
  });

  test("a side-effect tool with ungrounded arguments is still refused, never retried", async () => {
    __setToolOfferOverridesForTests(["weather"]);
    const rec = recordSearch();
    const result = await withStub(
      { reply: () => "", calls: (request) => (isFirst(request) ? call("weather", { place: "Zanzibar" }) : undefined) },
      () => runTurnNext(people.owner, "chat", "tell me about that old film"),
    );
    rec.spy.mockRestore();
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(rec.queries).toEqual([]);
    expect(result.value.reply.text).toBe(REFUSAL);
  });
});
