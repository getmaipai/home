import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { judgeTurn, runJudgeBatch, runConsolidation } from "@/lib/memoryJudge";
import { remember, similarByVector } from "@/lib/memory";
import { listPending } from "@/lib/notifications";
import { db } from "@/db";
import { people, conversationTurns, memoryRecords } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnValue } from "@/wire";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Marlow", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Marlow")).get()!;
  return { client, actor };
}

const SAFE: TurnValue["safety"] = {
  flagged: false,
  categories: [],
  action: "allow",
  notify_parent: false,
  matched_signals: [],
  checked_at: new Date().toISOString(),
};

/** A model-sourced turn, the real construction path (logTurn(), the
 * exact function turnEngine.ts's own prepareTurn() calls) rather than a
 * hand-rolled row - judgeTurn() only cares about the persisted shape,
 * not how the reply was generated, so there's no need to run a real
 * generation through runTurn() for every test case here. */
function makeTurn(actor: PersonRow, userText: string, replyText: string) {
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("setup failed");
  const turnId = `turn-${Math.random().toString(36).slice(2, 12)}`;
  logTurn(actor, "chat", userText, {
    reply: { text: replyText },
    source: "model",
    safety: SAFE,
    conversation_id: conv.value.id,
    turn_id: turnId,
  });
  return db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!;
}

/** Points the chat backend at a fresh stub scripted to answer exactly
 * one extraction/dedupe/contradiction shape - stubServer.ts's own
 * scriptedChatReply option (added for this file), distinguished by the
 * request's own response_format.json_schema.name since that's the one
 * thing that differs between an extraction call, a dedupe call, and a
 * normal turn-generation call (which never sets response_format at all
 * and so always falls through to the default echo reply here). */
async function withScriptedJudge<T>(reply: (schemaName: string | undefined, request: ChatCompletionRequest) => unknown, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      const schemaName = request.response_format?.type === "json_schema" ? request.response_format.json_schema.name : undefined;
      if (!schemaName) return undefined; // a normal turn-generation call - fall through to the default echo
      return reply(schemaName, request);
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

describe("judgeTurn() - extraction and provenance", () => {
  test("a scripted extraction reply produces the expected record, scoped and provenanced to the turn", async () => {
    const { actor } = await owner();
    const turn = makeTurn(actor, "I hate cilantro", "Noted, no cilantro for you.");

    const result = await withScriptedJudge(
      () => ({ facts: [{ text: "Marlow dislikes cilantro", category: "preference", scope: "person", importance: 0.7 }] }),
      () => judgeTurn(turn),
    );

    expect(result.ok).toBe(true);
    expect(result.factsWritten).toBe(1);
    const rows = db.select().from(memoryRecords).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.text).toBe("Marlow dislikes cilantro");
    expect(rows[0]!.category).toBe("preference");
    expect(rows[0]!.tier).toBe("durable"); // categoryToTier: preference is durable
    expect(rows[0]!.scope).toBe("person");
    expect(rows[0]!.person).toBe(actor.id);
    // Provenance: source is the turn's own id, the exact join key
    // listConversationTurns()'s memory_ids already reads (lib/
    // conversationHistory.ts) - no new column needed for that contract.
    expect(rows[0]!.source).toBe(turn.id);

    const updatedTurn = db.select().from(conversationTurns).where(eq(conversationTurns.id, turn.id)).get()!;
    expect(updatedTurn.judgeStatus).toBe("done");
  });

  test("possessive rule: a fact resolved to the speaker's real name (not a generic 'the user') is stored verbatim", async () => {
    const { actor } = await owner();
    const turn = makeTurn(actor, "no, Willow is my wife", "Got it.");

    await withScriptedJudge(
      () => ({ facts: [{ text: "Willow is Marlow's wife", category: "relationship", scope: "person", importance: 0.9 }] }),
      () => judgeTurn(turn),
    );

    const row = db.select().from(memoryRecords).get()!;
    expect(row.text).toBe("Willow is Marlow's wife");
    expect(row.text).not.toContain("the user");
  });

  test("question rule: an empty extraction is a valid, non-failing answer - nothing written, no notification, turn marked done", async () => {
    const { actor } = await owner();
    const turn = makeTurn(actor, "How long until bacteria grows on meat left out?", "A few hours at room temperature.");

    const result = await withScriptedJudge(() => ({ facts: [] }), () => judgeTurn(turn));

    expect(result.ok).toBe(true);
    expect(result.factsWritten).toBe(0);
    expect(db.select().from(memoryRecords).all().length).toBe(0);
    expect(listPending(actor).length).toBe(0);
    const updatedTurn = db.select().from(conversationTurns).where(eq(conversationTurns.id, turn.id)).get()!;
    expect(updatedTurn.judgeStatus).toBe("done");
  });

  test("relative-date rule: a scripted valid_to is written onto the record", async () => {
    const { actor } = await owner();
    const turn = makeTurn(actor, "we're in Brazil until the 20th visiting family", "Have a great trip.");

    await withScriptedJudge(
      () => ({
        facts: [
          {
            text: "Marlow was in Brazil visiting family, September 2026",
            category: "state",
            scope: "person",
            importance: 0.5,
            valid_to: "2026-09-20T00:00:00.000Z",
          },
        ],
      }),
      () => judgeTurn(turn),
    );

    const row = db.select().from(memoryRecords).get()!;
    expect(row.category).toBe("state");
    expect(row.validTo).toBe("2026-09-20T00:00:00.000Z");
  });

  test("the notification: a successful write triggers exactly one memory.updated for the speaker", async () => {
    const { actor } = await owner();
    const turn = makeTurn(actor, "I hate cilantro", "Noted.");

    await withScriptedJudge(
      () => ({ facts: [{ text: "Marlow dislikes cilantro", category: "preference", scope: "person", importance: 0.7 }] }),
      () => judgeTurn(turn),
    );

    const pending = listPending(actor);
    expect(pending.length).toBe(1);
    expect(pending[0]!.typeId).toBe("memory.updated");
    expect(pending[0]!.text).toContain("cilantro");
  });
});

describe("judgeTurn() - dedupe by supersede", () => {
  test("a dedupe SUPERSEDE decision retires the old record and creates its replacement, never a bare insert", async () => {
    const { actor } = await owner();
    const existing = remember(actor, {
      text: "Marlow lives in New York",
      category: "fact",
      tier: "durable",
      scope: "person",
      person: actor.id,
      source: "test",
      importance: 0.6,
    });
    if (!existing.ok) throw new Error("setup failed");
    // A real vector, not the fire-and-forget one remember() itself kicks
    // off (that hasn't resolved yet by the time similarByVector() below
    // runs) - injected directly the same way memory.test.ts's own step 5
    // cosine tests do, so this test doesn't race its own setup.
    const { sqlite } = await import("@/db");
    sqlite
      .query("INSERT INTO memory_embeddings (memory_id, space, dims, vector, hlc) VALUES (?, 'test', 4, ?, 'test-hlc')")
      .run(existing.value.id, Buffer.from(new Float32Array([1, 0, 0, 0]).buffer));

    const turn = makeTurn(actor, "actually I moved to Boston", "Updated.");

    await withScriptedJudge(
      (schemaName, request) => {
        if (schemaName === "memory_extraction") {
          // valid_to deliberately far off and unrelated to the turn's own
          // timestamp: proves closeValidTo uses turn.createdAt (when the
          // contradiction was learned), never the new fact's own valid_to
          // (a real bug a code review, 2026-09-05, found and fixed).
          return {
            facts: [{ text: "Marlow lives in Boston", category: "fact", scope: "person", importance: 0.6, valid_to: "2099-01-01T00:00:00.000Z" }],
          };
        }
        if (schemaName === "memory_dedupe") {
          const userMsg = request.messages[request.messages.length - 1]!.content;
          expect(userMsg).toContain(existing.value.id); // the candidate really reached the prompt
          return { action: "SUPERSEDE", id: existing.value.id, merged_text: "Marlow lives in Boston", contradiction: true };
        }
        return undefined;
      },
      () => judgeTurn(turn),
    );

    const oldRow = db.select().from(memoryRecords).where(eq(memoryRecords.id, existing.value.id)).get()!;
    expect(oldRow.status).toBe("superseded");
    const newRow = db.select().from(memoryRecords).where(eq(memoryRecords.status, "active")).get()!;
    expect(newRow.text).toBe("Marlow lives in Boston");
    expect(oldRow.supersededBy).toBe(newRow.id);
    // A contradiction closes valid_to on the old record with WHEN THE
    // CONTRADICTION WAS LEARNED (this turn's own timestamp), not with
    // the new fact's own valid_to (2099, asserted above never to leak).
    expect(oldRow.validTo).toBe(turn.createdAt);
    expect(newRow.validTo).toBe("2099-01-01T00:00:00.000Z"); // the new record keeps its own, real valid_to
  });

  test("similarByVector() never surfaces a candidate below the dedupe cosine floor", async () => {
    const { actor } = await owner();
    const unrelated = remember(actor, {
      text: "the wifi password is on the fridge",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    if (!unrelated.ok) throw new Error("setup failed");
    const { sqlite } = await import("@/db");
    sqlite
      .query("INSERT INTO memory_embeddings (memory_id, space, dims, vector, hlc) VALUES (?, 'test', 4, ?, 'test-hlc')")
      .run(unrelated.value.id, Buffer.from(new Float32Array([0, 1, 0, 0]).buffer));

    const matches = similarByVector(actor, new Float32Array([1, 0, 0, 0]), { scope: "household" });
    expect(matches.length).toBe(0);
  });
});

describe("judgeTurn() - the poison guard", () => {
  test("three failed extraction attempts mark the turn judge_failed; fewer than three leave it retryable", async () => {
    const { actor } = await owner();
    const turn = makeTurn(actor, "hello", "hi there");

    __resetLlmSupervisorForTests();
    process.env.MAIPAI_LLAMA_SERVER_URL = "http://127.0.0.1:1"; // never reachable

    const first = await judgeTurn(turn);
    expect(first.ok).toBe(false);
    let row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turn.id)).get()!;
    expect(row.judgeAttempts).toBe(1);
    expect(row.judgeStatus).toBeNull();

    await judgeTurn(row);
    row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turn.id)).get()!;
    expect(row.judgeAttempts).toBe(2);
    expect(row.judgeStatus).toBeNull();

    await judgeTurn(row);
    row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turn.id)).get()!;
    expect(row.judgeAttempts).toBe(3);
    expect(row.judgeStatus).toBe("failed");

    expect(db.select().from(memoryRecords).all().length).toBe(0);
  });

  test("a dedupe-round failure never counts against the poison guard - it just defaults to ADD", async () => {
    const { actor } = await owner();
    const turn = makeTurn(actor, "I hate cilantro", "Noted.");

    // No existing candidates, so dedupe is never even called - this
    // proves the ADD-on-no-candidates path, which is the common case,
    // still writes cleanly and leaves attempts untouched.
    await withScriptedJudge(
      () => ({ facts: [{ text: "Marlow dislikes cilantro", category: "preference", scope: "person", importance: 0.7 }] }),
      () => judgeTurn(turn),
    );

    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turn.id)).get()!;
    expect(row.judgeAttempts).toBe(0);
    expect(row.judgeStatus).toBe("done");
  });
});

describe("runJudgeBatch()", () => {
  test("processes every unjudged model turn, oldest first, and skips turns already judged", async () => {
    const { actor } = await owner();
    const t1 = makeTurn(actor, "I hate cilantro", "Noted.");
    const t2 = makeTurn(actor, "I love hiking", "Nice.");
    // Already judged - must not be re-processed.
    const t3 = makeTurn(actor, "irrelevant", "ok");
    db.update(conversationTurns).set({ judgeStatus: "done" }).where(eq(conversationTurns.id, t3.id)).run();

    const result = await withScriptedJudge(
      (_schemaName, request) => {
        const userText = request.messages[request.messages.length - 1]!.content;
        if (userText.includes("cilantro")) return { facts: [{ text: "Marlow dislikes cilantro", category: "preference", scope: "person", importance: 0.7 }] };
        if (userText.includes("hiking")) return { facts: [{ text: "Marlow loves hiking", category: "preference", scope: "person", importance: 0.7 }] };
        return { facts: [] };
      },
      () => runJudgeBatch(),
    );

    expect(result.processed).toBe(2);
    expect(result.factsWritten).toBe(2);
    const t1Row = db.select().from(conversationTurns).where(eq(conversationTurns.id, t1.id)).get()!;
    const t2Row = db.select().from(conversationTurns).where(eq(conversationTurns.id, t2.id)).get()!;
    expect(t1Row.judgeStatus).toBe("done");
    expect(t2Row.judgeStatus).toBe("done");
  });
});

describe("runConsolidation()", () => {
  test("supersedes the older of a genuinely contradicting pair and links it to the newer, surviving record", async () => {
    const { actor } = await owner();
    const older = remember(actor, {
      text: "Marlow lives in New York",
      category: "identity",
      tier: "durable",
      scope: "person",
      person: actor.id,
      source: "test",
      importance: 0.8,
    });
    const newer = remember(actor, {
      text: "Marlow lives in Boston",
      category: "identity",
      tier: "durable",
      scope: "person",
      person: actor.id,
      source: "test",
      importance: 0.8,
    });
    if (!older.ok || !newer.ok) throw new Error("setup failed");
    const { sqlite } = await import("@/db");
    // cos([1,1,0,0], [1,0,0,0]) = 1/sqrt(2) ~= 0.707, which lands in
    // [0.55, 0.86): related enough to check, not so similar it would
    // already be a near-duplicate.
    sqlite
      .query("INSERT INTO memory_embeddings (memory_id, space, dims, vector, hlc) VALUES (?, 'test', 4, ?, 'test-hlc')")
      .run(older.value.id, Buffer.from(new Float32Array([1, 1, 0, 0]).buffer));
    sqlite
      .query("INSERT INTO memory_embeddings (memory_id, space, dims, vector, hlc) VALUES (?, 'test', 4, ?, 'test-hlc')")
      .run(newer.value.id, Buffer.from(new Float32Array([1, 0, 0, 0]).buffer));

    const result = await withScriptedJudge(() => ({ contradicts: true }), () => runConsolidation());

    expect(result.contradictionsSuperseded).toBe(1);
    const oldRow = db.select().from(memoryRecords).where(eq(memoryRecords.id, older.value.id)).get()!;
    expect(oldRow.status).toBe("superseded");
    expect(oldRow.supersededBy).toBe(newer.value.id);
    const newRow = db.select().from(memoryRecords).where(eq(memoryRecords.id, newer.value.id)).get()!;
    expect(newRow.status).toBe("active"); // the survivor is untouched, not a third new record
  });

  test("demotes a never-recalled durable record older than the staleness window to episodic", async () => {
    const { actor } = await owner();
    const stale = remember(actor, {
      text: "Marlow mentioned a random detail once",
      category: "identity",
      tier: "durable",
      scope: "person",
      person: actor.id,
      source: "test",
      importance: 0.5,
    });
    if (!stale.ok) throw new Error("setup failed");
    const { sqlite } = await import("@/db");
    const oldDate = new Date(Date.now() - 40 * 86_400_000).toISOString();
    sqlite.query("UPDATE memory_records SET created_at = ? WHERE id = ?").run(oldDate, stale.value.id);

    const result = await runConsolidation();

    expect(result.demoted).toBe(1);
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, stale.value.id)).get()!;
    expect(row.tier).toBe("episodic");
  });

  test("never demotes a PINNED never-recalled durable record", async () => {
    const { actor } = await owner();
    const pinned = remember(actor, {
      text: "Marlow's identity fact",
      category: "identity",
      tier: "durable",
      scope: "person",
      person: actor.id,
      source: "test",
      importance: 0.9,
      pinned: true,
    });
    if (!pinned.ok) throw new Error("setup failed");
    const { sqlite } = await import("@/db");
    const oldDate = new Date(Date.now() - 40 * 86_400_000).toISOString();
    sqlite.query("UPDATE memory_records SET created_at = ? WHERE id = ?").run(oldDate, pinned.value.id);

    await runConsolidation();

    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, pinned.value.id)).get()!;
    expect(row.tier).toBe("durable");
  });
});
