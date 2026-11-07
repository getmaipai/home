// AUDIT-PERF-01 item 6: per-conversation and per-person maps are capped and forgotten with their conversation.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { MAX_REMEMBERED_KEYS, setBounded } from "@/lib/boundedMap";
import { __conversationMemorySizesForTests, __rememberConversationForTests, forgetConversationMemory, deleteConversationById, updateConversationArchived, createConversation } from "@/lib/conversationHistory";
import { pickStillCue, pickThinkingCue, __resetThinkingCuesForTests } from "@/lib/replyVariation";
import { owner } from "./support/testAuth";

beforeEach(() => { resetDb(); __resetThinkingCuesForTests(); });

describe("setBounded", () => {
  test("keeps at most 500 keys and drops the least recently set", () => {
    const map = new Map<string, number>();
    for (let i = 0; i < MAX_REMEMBERED_KEYS + 20; i++) setBounded(map, `k${i}`, i);
    expect(map.size).toBe(MAX_REMEMBERED_KEYS);
    expect(map.has("k0")).toBe(false);
    expect(map.has("k519")).toBe(true);
    setBounded(map, "k20", 1); // refreshed: now the newest
    setBounded(map, "extra", 1);
    expect(map.has("k20")).toBe(true);
    expect(map.has("k21")).toBe(false);
  });

  test("the cue memories stay bounded across many people", () => {
    for (let i = 0; i < MAX_REMEMBERED_KEYS + 50; i++) { pickStillCue(`person-${i}`); pickThinkingCue(`person-${i}`); }
    // No public size; the next picks still work and never repeat the previous cue for a recent person.
    const a = pickStillCue("person-549");
    const b = pickStillCue("person-549");
    expect(a).not.toBe(b);
  });
});

describe("per-conversation memory", () => {
  test("is forgotten when a conversation is deleted or archived, and capped at 500", async () => {
    const { row } = await owner();
    const mk = () => { const r = createConversation(row); if (!r.ok) throw new Error("no conversation"); return r.value.id; };
    const ids = [mk(), mk()];
    for (const id of ids) __rememberConversationForTests(id);
    expect(__conversationMemorySizesForTests().hasBudget(ids[0]!)).toBe(true);
    expect(updateConversationArchived(row, ids[0]!, true).ok).toBe(true);
    expect(__conversationMemorySizesForTests().hasBudget(ids[0]!)).toBe(false);
    expect(__conversationMemorySizesForTests().hasRefused(ids[0]!)).toBe(false);
    expect(deleteConversationById(row, ids[1]!).ok).toBe(true);
    expect(__conversationMemorySizesForTests().hasBudget(ids[1]!)).toBe(false);
    expect(__conversationMemorySizesForTests().hasRefused(ids[1]!)).toBe(false);
    for (let i = 0; i < MAX_REMEMBERED_KEYS + 30; i++) __rememberConversationForTests(`c${i}`);
    expect(__conversationMemorySizesForTests().budgets).toBeLessThanOrEqual(MAX_REMEMBERED_KEYS);
    expect(__conversationMemorySizesForTests().refused).toBeLessThanOrEqual(MAX_REMEMBERED_KEYS);
  });
});
