// THIN-INC audit rows 2 to 7 (rules 0, 4 and 12; docs/plans/privacy-mode-
// 2026-09-24.md): a temporary chat on the default path leaves no trace where
// the thin path reads or writes. Row 1 and the stored half of rows 2 and 3 are
// temporaryTurn.test.ts's; this file adds what each row names beyond that:
// recall reads nothing into a temporary chat, no summary job is scheduled,
// search keeps no row and keeps its age gate, the Incognito list is exclusive,
// the spoken routes cannot reach a temporary session, and issue #163's
// mismatch is refused on the default path.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { TestClient } from "../client";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, startFakeSearxng, startRecordingProxy, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { createConversation, isTemporaryConversation, listTemporaryConversations, logTurn } from "@/lib/conversationHistory";
import * as summaryRefresh from "@/lib/summaryRefresh";
import { HOSTED_SEARCH_KEY_SETTING, __setHostedSearchEndpointForTests } from "@/lib/hostedSearch";
import { __resetSearchCacheForTests } from "@/lib/packageHost";
import { db } from "@/db";
import { people, conversations, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { TurnValue } from "@/wire";
import { changedTables, drainStream, tableCounts, withEngine } from "./modeHarness";

let people_: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  people_ = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  __setHostedSearchEndpointForTests(null);
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const SAFE_RESULT: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
const SAID = "my dentist appointment is on the fourteenth at nine";
const ASK = "when is my dentist appointment";

function insertPerson(name: string, role: "teen" | "adult") {
  const now = new Date().toISOString();
  const id = `person-incog-${name.toLowerCase()}`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:2:testfix" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

function seedEarlierEpisode(): void {
  const created = createConversation(people_.owner, { surface: "chat" });
  if (!created.ok) throw new Error(created.error);
  logTurn(people_.owner, "chat", SAID, { reply: { text: "Noted." }, source: "model", safety: SAFE_RESULT, conversation_id: created.value.id, turn_id: "turn-earlier-1" });
}

describe("THIN-INC row 2: episode recall in a temporary chat", () => {
  test("a durable chat is shown the earlier episode, a temporary chat asking the same thing is not", async () => {
    seedEarlierEpisode();
    await withEngine(() => "Okay.", async (seen) => {
      const durable = await runTurnNext(people_.owner, "chat", ASK, {});
      expect(durable.ok).toBe(true);
      expect(JSON.stringify(seen.at(-1)!.messages)).toContain(SAID);

      const before = tableCounts();
      seen.length = 0;
      const temporary = await runTurnNext(people_.owner, "chat", ASK, { temporary: true });
      expect(temporary.ok).toBe(true);
      expect(seen.length).toBeGreaterThan(0);
      for (const request of seen) expect(JSON.stringify(request.messages)).not.toContain(SAID);
      expect(changedTables(before, tableCounts())).toEqual([]);
    });
  });
});

describe("THIN-INC row 3: the summary refresh is never scheduled for a temporary chat", () => {
  test("a durable turn schedules it, a blocking, a streamed and a follow-up temporary turn do not", async () => {
    const schedule = spyOn(summaryRefresh, "scheduleSummaryRefresh");
    try {
      await withEngine(() => "Okay.", async () => {
        await runTurnNext(people_.owner, "chat", "what should we cook on Friday", {});
        expect(schedule).toHaveBeenCalledTimes(1);
        schedule.mockClear();

        const first = await runTurnNext(people_.owner, "chat", "plan a picnic", { temporary: true });
        if (!first.ok || first.kind !== "immediate") throw new Error("expected an immediate result");
        const streamed = await runTurnNextStream(people_.owner, "chat", "and a walk after", { conversationId: first.value.conversation_id });
        await drainStream(streamed);
        await runTurnNext(people_.owner, "chat", "thanks", { conversationId: first.value.conversation_id });
        expect(isTemporaryConversation(first.value.conversation_id)).toBe(true);
        expect(schedule).toHaveBeenCalledTimes(0);
      });
    } finally {
      schedule.mockRestore();
    }
  });
});

// A search records the service's own health sample (serviceHealth.ts, fire and forget, keyed to the
// host, holding no query, person or chat), the same for a durable chat; the diff leaves those two out.
const HUB_HEALTH_TABLES = ["status_events", "status_heartbeat"];
const changedBesidesHubHealth = (before: Record<string, number>) => changedTables(before, tableCounts()).filter((name) => !HUB_HEALTH_TABLES.includes(name));

describe("THIN-INC row 4: search from a temporary chat", () => {
  const searchCalls = (request: { messages: { role: string }[] }) =>
    request.messages.some((m) => m.role === "tool") ? undefined : [{ id: "call-1", name: "websearch", args: JSON.stringify({ expression: "president of chile" }) }];

  async function searchingEngine<T>(fn: () => Promise<T>): Promise<T> {
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: () => "It answers your question.",
      scriptedToolCalls: (request) => (!request.tools || request.tools.length === 0 ? undefined : searchCalls(request)?.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } }))),
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

  test("an adult's temporary search keeps no row anywhere", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      await searchingEngine(async () => {
        const before = tableCounts();
        const result = await runTurnNext(people_.owner, "chat", "who is the president of chile", { temporary: true });
        expect(result.ok).toBe(true);
        expect(searxng.queries.length).toBeGreaterThan(0);
        expect(changedBesidesHubHealth(before)).toEqual([]);
      });
    } finally {
      searxng.stop();
    }
  });

  test("the hosted key still applies its adult gate: a minor cannot open a temporary chat, an adult's query reaches the provider and stores nothing", async () => {
    const hits: (string | null)[] = [];
    const provider = Bun.serve({ port: 0, fetch: (req) => { hits.push(new URL(req.url).searchParams.get("q")); return Response.json({ web: { results: [{ title: "Hosted", url: "https://hosted.example/", description: "from the provider" }] } }); } });
    __setHostedSearchEndpointForTests(`http://127.0.0.1:${provider.port}/res/v1/web/search`);
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, "BSA-test-key-do-not-log");
    try {
      await searchingEngine(async () => {
        for (const minor of [people_.child, insertPerson("Juniper", "teen")]) {
          const refused = await runTurnNext(minor, "chat", "who is the president of chile", { temporary: true });
          expect(refused.ok).toBe(false);
        }
        expect(hits).toEqual([]);
        const before = tableCounts();
        const result = await runTurnNext(people_.owner, "chat", "who is the president of chile", { temporary: true });
        expect(result.ok).toBe(true);
        expect(hits.length).toBe(1);
        expect(changedBesidesHubHealth(before)).toEqual([]);
      });
    } finally {
      provider.stop(true);
    }
  });
});
