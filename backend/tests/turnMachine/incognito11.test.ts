// THIN-INC row 7 (INCOGNITO-11, issue #163; docs/plans/privacy-mode-2026-09-24.md,
// "The persistence boundary"): the default path (runTurnNext) creates a
// temporary thread without a durable row. The client flow is: initialize()
// asks POST /api/conversations for mode "temporary", then every turn names
// that id. A durable id claimed as temporary is refused, never downgraded.
// The turn is driven through the default path's own entry point; the whole
// database is diffed, in the style of temporaryTurn.test.ts.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, conversationTurns, people as peopleTable } from "@/db/schema";
import { TestClient } from "../client";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { setHouseholdSettingValue } from "@/lib/settings";
import { isTemporaryConversation, createConversation } from "@/lib/conversationHistory";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import type { PersonRow } from "@/types";
import { changedTables, tableCounts, withEngine } from "./modeHarness";

let client: TestClient;
let owner: PersonRow;

beforeEach(async () => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  owner = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()!;
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

describe("THIN-INC row 7: INCOGNITO-11 on the default path", () => {
  test("INCOGNITO-11 default path creates temporary thread without a durable row", async () => {
    // The client's initialize(): a temporary thread before any message exists.
    const created = await client.post("/api/conversations", { mode: "temporary" });
    expect(created.status).toBe(201);
    const { id, mode } = (await created.json()) as { id: string; mode: string };
    expect(mode).toBe("temporary");
    expect(isTemporaryConversation(id)).toBe(true);
    expect(db.select().from(conversations).where(eq(conversations.id, id)).get()).toBeUndefined();

    // Then the turns, on that id, through the default path.
    const before = tableCounts();
    await withEngine(() => "Okay, just between us.", async () => {
      const first = await runTurnNext(owner, "chat", "plan a surprise for the family", { conversationId: id, temporary: true });
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.value.conversation_id).toBe(id);
      const second = await runTurnNext(owner, "chat", "and what should we cook", { conversationId: id, temporary: true });
      expect(second.ok).toBe(true);
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(changedTables(before, tableCounts())).toEqual([]);
    expect(db.select().from(conversations).where(eq(conversations.id, id)).get()).toBeUndefined();
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, id)).all()).toEqual([]);
  });

  test("a first turn with no id and temporary: true mints an in-memory thread, not a row", async () => {
    const before = tableCounts();
    await withEngine(() => "Sure.", async () => {
      const result = await runTurnNext(owner, "chat", "hello", { temporary: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isTemporaryConversation(result.value.conversation_id)).toBe(true);
      expect(db.select().from(conversations).where(eq(conversations.id, result.value.conversation_id)).get()).toBeUndefined();
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(changedTables(before, tableCounts())).toEqual([]);
  });

  test("a durable id claimed as temporary is refused with a typed error and nothing is written", async () => {
    const durable = createConversation(owner, { surface: "chat" });
    if (!durable.ok) throw new Error(durable.error);
    const before = tableCounts();
    await withEngine(() => "should never be asked", async (seen) => {
      const result = await runTurnNext(owner, "chat", "this is private", { conversationId: durable.value.id, temporary: true });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("temporary_mismatch");
      expect(seen).toEqual([]);
    });
    expect(changedTables(before, tableCounts())).toEqual([]);
    expect(db.select().from(conversations).where(eq(conversations.id, durable.value.id)).get()!.mode).toBe("chat");
  });
});
