// AUDIT-PERF-CONV-01: the conversation list reads counts and one preview per conversation in SQL, and the chat window
// reads only the columns it renders, once per turn, through the (conversation_id, status, created_at) index.
import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db, sqlite } from "@/db";
import { people, conversations, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nextHlc } from "@/lib/hlc";
import { newConversationTurnId } from "@/lib/id";
import { createConversation, listConversations, buildConversationWindow, windowPreview, logTurn, __windowRowsForTests, __clearWindowRowCacheForTests } from "@/lib/conversationHistory";
import type { TurnValue } from "@/wire";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

beforeEach(() => {
  resetDb();
  __clearWindowRowCacheForTests();
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

type Seed = { id?: string; conversationId: string; createdAt: string; userText: string; pluginId?: string | null; status?: string; supersedes?: string | null; safetyFlagged?: boolean; crisisSignal?: boolean };
function seedTurns(personId: string, seeds: Seed[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < seeds.length; i += 100) {
    const batch = seeds.slice(i, i + 100).map((seed) => {
      const id = seed.id ?? newConversationTurnId();
      ids.push(id);
      return {
        id,
        personId,
        surface: "chat",
        conversationId: seed.conversationId,
        userText: seed.userText,
        replyText: `reply to ${seed.userText}`.slice(0, 80),
        source: "model",
        pluginId: seed.pluginId ?? null,
        safetyAction: "allow",
        safetyFlagged: seed.safetyFlagged ?? false,
        crisisSignal: seed.crisisSignal ?? false,
        createdAt: seed.createdAt,
        hlc: nextHlc(),
        status: seed.status ?? "done",
        supersedes: seed.supersedes ?? null,
        stats: JSON.stringify({ generations: [{ model: "m", tokens: 12 }], filler: "x".repeat(600) }),
        blocks: JSON.stringify([{ kind: "text", text: "y".repeat(600) }]),
      };
    });
    db.insert(conversationTurns).values(batch).run();
  }
  return ids;
}

const at = (ms: number) => new Date(1_700_000_000_000 + ms).toISOString();

/** The list as it was before AUDIT-PERF-CONV-01: every turn of every listed conversation loaded, the count, the newest time and the
 * newest non-film turn with text worked out in JavaScript. The reference the SQL version must match field for field. */
function referenceAggregates(conversationIds: string[]) {
  const out = new Map<string, { count: number; last: string | null; preview: string | null }>();
  const rows = sqlite.query("SELECT rowid AS rid, conversation_id AS cid, created_at AS createdAt, user_text AS userText, plugin_id AS pluginId FROM conversation_turns ORDER BY rowid").all() as Array<{ cid: string; createdAt: string; userText: string; pluginId: string | null }>;
  const latest = new Map<string, (typeof rows)[number]>();
  for (const t of rows) {
    if (!conversationIds.includes(t.cid)) continue;
    const entry = out.get(t.cid) ?? { count: 0, last: null, preview: null };
    entry.count++;
    if (!entry.last || t.createdAt > entry.last) entry.last = t.createdAt;
    out.set(t.cid, entry);
    if (t.pluginId !== "film" && t.userText.trim()) {
      const current = latest.get(t.cid);
      if (!current || t.createdAt >= current.createdAt) latest.set(t.cid, t);
    }
  }
  for (const [cid, t] of latest) {
    const collapsed = t.userText.replace(/\s+/g, " ").trim();
    const chars = Array.from(collapsed);
    out.get(cid)!.preview = chars.length <= 120 ? collapsed : `${chars.slice(0, 119).join("").trimEnd()}…`;
  }
  return out;
}

describe("AUDIT-PERF-CONV-01: the conversation list", () => {
  test("a seeded list matches the old all-turns implementation field for field", async () => {
    const actor = await owner();
    const made = Array.from({ length: 6 }, () => {
      const c = createConversation(actor, {});
      if (!c.ok) throw new Error(c.error);
      return c.value.id;
    });
    seedTurns(actor.id, [
      // 0: ordinary, newest turn wins
      { conversationId: made[0]!, createdAt: at(1), userText: "first question" },
      { conversationId: made[0]!, createdAt: at(3), userText: "the newest question  \n with   spaces" },
      { conversationId: made[0]!, createdAt: at(2), userText: "a middle question" },
      // 1: the newest turn is a film turn, the one before it is whitespace-only: the preview skips both
      { conversationId: made[1]!, createdAt: at(1), userText: "keep this one" },
      { conversationId: made[1]!, createdAt: at(2), userText: "   \t\n " },
      { conversationId: made[1]!, createdAt: at(3), userText: "a film request", pluginId: "film" },
      // 2: three turns in one millisecond: the later insert wins the preview, as listConversationTurns() orders them
      { conversationId: made[2]!, createdAt: at(5), userText: "tie one" },
      { conversationId: made[2]!, createdAt: at(5), userText: "tie two" },
      { conversationId: made[2]!, createdAt: at(5), userText: "tie three" },
      // 3: only a non-breaking-space turn (JavaScript trims it, SQLite's trim() does not) before a real one
      { conversationId: made[3]!, createdAt: at(1), userText: "real text" },
      { conversationId: made[3]!, createdAt: at(2), userText: "  " },
      // 4: only film and blank turns: no preview at all, but they still count
      { conversationId: made[4]!, createdAt: at(1), userText: "film only", pluginId: "film" },
      { conversationId: made[4]!, createdAt: at(2), userText: "" },
      // 5: a long preview is cut, a failed and a running turn still count
      { conversationId: made[5]!, createdAt: at(1), userText: "running one", status: "running" },
      { conversationId: made[5]!, createdAt: at(2), userText: "failed one", status: "failed" },
      { conversationId: made[5]!, createdAt: at(3), userText: "x".repeat(300) },
    ]);
    // 6: a conversation with no turns at all
    const empty = createConversation(actor, {});
    if (!empty.ok) throw new Error(empty.error);
    const listed = listConversations(actor);
    const all = [...made, empty.value.id];
    const reference = referenceAggregates(all);
    expect(listed.map((c) => c.id).sort()).toEqual([...all].sort());
    for (const c of listed) {
      const expected = reference.get(c.id) ?? { count: 0, last: null, preview: null };
      expect({ id: c.id, turn_count: c.turn_count, last_turn_at: c.last_turn_at, preview: c.preview ?? null }).toEqual({ id: c.id, turn_count: expected.count, last_turn_at: expected.last, preview: expected.preview });
    }
    // The concrete cases the reference encodes, so a wrong reference cannot pass silently.
    const byId = new Map(listed.map((c) => [c.id, c]));
    expect(byId.get(made[0]!)!.preview).toBe("the newest question with spaces");
    expect(byId.get(made[1]!)!.preview).toBe("keep this one");
    expect(byId.get(made[2]!)!.preview).toBe("tie three");
    expect(byId.get(made[3]!)!.preview).toBe("real text");
    expect(byId.get(made[4]!)!.preview).toBeNull();
    expect(byId.get(made[4]!)!.turn_count).toBe(2);
    expect(byId.get(made[5]!)!.preview!.endsWith("…")).toBe(true);
    expect(byId.get(made[5]!)!.turn_count).toBe(3);
    expect(byId.get(empty.value.id)!.turn_count).toBe(0);
  });

  test("a 20,000-turn fixture lists in under 50 ms", async () => {
    const actor = await owner();
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const c = createConversation(actor, {});
      if (!c.ok) throw new Error(c.error);
      ids.push(c.value.id);
    }
    const seeds: Seed[] = [];
    for (const [ci, conversationId] of ids.entries()) {
      for (let t = 0; t < 200; t++) seeds.push({ conversationId, createdAt: at(t * 1000 + ci), userText: `conversation ${ci} turn ${t} ${"words ".repeat(40)}`, pluginId: t % 41 === 0 ? "film" : null });
    }
    seedTurns(actor.id, seeds);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM conversation_turns").get()).toEqual({ n: 20_000 });
    listConversations(actor); // warm the prepared statements
    const timings: number[] = [];
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      const listed = listConversations(actor);
      timings.push(performance.now() - started);
      expect(listed).toHaveLength(100);
    }
    const best = Math.min(...timings);
    console.log(`AUDIT-PERF-CONV-01 list of 100 conversations over 20,000 turns: best ${best.toFixed(1)} ms of ${timings.map((t) => t.toFixed(1)).join(", ")}`);
    expect(best).toBeLessThan(50);
    // The fixture still lists the right numbers.
    const reference = referenceAggregates(ids);
    for (const c of listConversations(actor)) {
      const expected = reference.get(c.id)!;
      expect([c.turn_count, c.last_turn_at, c.preview ?? null]).toEqual([expected.count, expected.last, expected.preview]);
    }
  });
});

describe("AUDIT-PERF-CONV-01: the chat window", () => {
  function recordStatements(): { sql: string[]; stop(): void } {
    const sql: string[] = [];
    const prepare = spyOn(sqlite, "prepare");
    const original = prepare.getMockImplementation();
    prepare.mockImplementation(((query: string, ...rest: unknown[]) => {
      sql.push(query);
      return (original ?? Object.getPrototypeOf(sqlite).prepare).call(sqlite, query, ...rest);
    }) as never);
    return { sql, stop: () => prepare.mockRestore() };
  }
  /** The window's one read of the rows: a select of turn columns by conversation and status with a limit. */
  const isWindowRead = (query: string) => /from "conversation_turns" where/i.test(query) && /"conversation_turns"."status" = \?/i.test(query) && /limit/i.test(query) && /"user_text"/i.test(query);

  async function seeded() {
    const actor = await owner();
    const c = createConversation(actor, {});
    if (!c.ok) throw new Error(c.error);
    return { actor, conversation: c.value };
  }

  test("turns that share one millisecond keep their insertion order in the window", async () => {
    const { actor, conversation } = await seeded();
    const ids = seedTurns(actor.id, [
      { id: "tie-a", conversationId: conversation.id, createdAt: at(10), userText: "tie A" },
      { id: "tie-b", conversationId: conversation.id, createdAt: at(10), userText: "tie B" },
      { id: "tie-c", conversationId: conversation.id, createdAt: at(10), userText: "tie C" },
      { id: "after", conversationId: conversation.id, createdAt: at(11), userText: "after" },
      { id: "before", conversationId: conversation.id, createdAt: at(9), userText: "before" },
    ]);
    expect(ids).toEqual(["tie-a", "tie-b", "tie-c", "after", "before"]);
    const window = await buildConversationWindow(conversation, { historyBudgetTokens: null });
    expect(window.turnIds).toEqual(["before", "tie-a", "tie-b", "tie-c", "after"]);
    expect(windowPreview(conversation).userTexts).toEqual(["before", "tie A", "tie B", "tie C", "after"]);
  });

  test("the window holds the live finished turns and nothing else, as before", async () => {
    const { actor, conversation } = await seeded();
    seedTurns(actor.id, [
      { id: "w1", conversationId: conversation.id, createdAt: at(1), userText: "one" },
      { id: "w2", conversationId: conversation.id, createdAt: at(2), userText: "two (edited away)" },
      { id: "w3", conversationId: conversation.id, createdAt: at(3), userText: "two (edited)", supersedes: "w2" },
      { id: "w4", conversationId: conversation.id, createdAt: at(4), userText: "a film", pluginId: "film" },
      { id: "w5", conversationId: conversation.id, createdAt: at(5), userText: "still running", status: "running" },
      { id: "w6", conversationId: conversation.id, createdAt: at(6), userText: "six" },
    ]);
    const window = await buildConversationWindow(conversation, { historyBudgetTokens: null });
    expect(window.turnIds).toEqual(["w1", "w3", "w6"]);
    expect(window.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(window.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["one", "two (edited)", "six"]);
    // An anchor in the middle: only the turns after it are uncovered, found by position even though w2 is superseded.
    const anchored = { ...conversation, summary: "earlier notes", summary_through_turn: "w2" };
    const after = await buildConversationWindow(anchored, { historyBudgetTokens: null });
    expect(after.turnIds).toEqual(["w3", "w6"]);
    expect(after.summaryLine).toContain("earlier notes");
  });

  test("a turn reads its window rows once for the preview and the window together, and again only after a turn is written", async () => {
    const { actor, conversation } = await seeded();
    seedTurns(actor.id, [
      { conversationId: conversation.id, createdAt: at(1), userText: "hello" },
      { conversationId: conversation.id, createdAt: at(2), userText: "there" },
    ]);
    const recorder = recordStatements();
    try {
      const preview = windowPreview(conversation);
      const window = await buildConversationWindow(conversation, { historyBudgetTokens: null });
      expect(preview.userTexts).toEqual(["hello", "there"]);
      expect(window.messages).toHaveLength(4);
      expect(recorder.sql.filter(isWindowRead)).toHaveLength(1);
      // A turn written here drops the shared rows: the next turn's read sees it.
      logTurn(actor, "chat", "a third", { reply: { text: "ok" }, source: "model", safety: SAFE, conversation_id: conversation.id, turn_id: "turn-third" });
      const next = await buildConversationWindow(conversation, { historyBudgetTokens: null });
      expect(next.turnIds).toHaveLength(3);
      expect(next.messages.at(-2)?.content).toBe("a third");
      expect(recorder.sql.filter(isWindowRead)).toHaveLength(2);
      // A turn written past logTurn() (straight into the table) changes the newest turn, so the key changes and it reads fresh too.
      seedTurns(actor.id, [{ id: "turn-direct", conversationId: conversation.id, createdAt: new Date(Date.now() + 60_000).toISOString(), userText: "direct" }]);
      const direct = await buildConversationWindow(conversation, { historyBudgetTokens: null });
      expect(direct.turnIds.at(-1)).toBe("turn-direct");
      expect(recorder.sql.filter(isWindowRead)).toHaveLength(3);
    } finally {
      recorder.stop();
    }
  });

  test("the window query selects only the columns the window renders", async () => {
    const { actor, conversation } = await seeded();
    seedTurns(actor.id, [{ conversationId: conversation.id, createdAt: at(1), userText: "hello" }]);
    const recorder = recordStatements();
    try {
      await buildConversationWindow(conversation, { historyBudgetTokens: null });
    } finally {
      recorder.stop();
    }
    const read = recorder.sql.find(isWindowRead)!;
    expect(read).toBeDefined();
    for (const wide of ["blocks", "document", "media", "sources", "plan", "signal", "subjects", "reasoning", "structured_part", "confirm", "speaker_evidence", "answer_images"]) {
      expect(read).not.toContain(`"${wide}"`);
    }
    expect(read).toContain('"user_text"');
  });

  test("EXPLAIN QUERY PLAN: the window query uses the (conversation_id, status, created_at) index with no sort step", async () => {
    const { actor, conversation } = await seeded();
    seedTurns(actor.id, [{ conversationId: conversation.id, createdAt: at(1), userText: "hello" }]);
    for (const order of ["newest", "oldest"] as const) {
      const recorder = recordStatements();
      try {
        if (order === "newest") await buildConversationWindow(conversation, { historyBudgetTokens: null });
        else {
          // The fold reads the oldest turns first; its statement differs only in the direction.
          __windowRowsForTests(conversation, "oldest");
        }
      } finally {
        recorder.stop();
      }
      const read = recorder.sql.find(isWindowRead)!;
      expect(read).toBeDefined();
      const params = Array.from({ length: (read.match(/\?/g) ?? []).length }, () => conversation.id);
      const plan = (sqlite.query(`EXPLAIN QUERY PLAN ${read}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
      expect(plan).toContain("conversation_turns_conversation_status_created_idx");
      expect(plan).not.toContain("USE TEMP B-TREE");
    }
  });
});
