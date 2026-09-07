import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { runTurn, __setSummaryRefreshDelayForTests } from "@/lib/turnEngine";
import {
  list,
  exportPerson,
  runRetention,
  routingStats,
  summarizeBeforeDelete,
  logTurn,
  resolveOrCreateConversation,
  getConversation,
  updateConversationTitle,
  listConversationTurns,
  buildConversationWindow,
  maybeRefreshConversationSummary,
} from "@/lib/conversationHistory";
import { createCommand } from "@/lib/commands";
import { REMEMBER_CONFIRM_VARIANTS } from "@/lib/replyVariation";
import { db } from "@/db";
import { people, conversationTurns, conversations, memoryRecords } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { TurnValue } from "@/wire";

const SAFE: TurnValue["safety"] = {
  flagged: false,
  categories: [],
  action: "allow",
  notify_parent: false,
  matched_signals: [],
  checked_at: new Date().toISOString(),
};

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

async function addPerson(ownerClient: TestClient, displayName: string, role: string) {
  // Issues #35/#47 made a secret required for role: "adult" too
  // (owner/admin already needed one) - this helper never signs in itself
  // (callers either use the row directly or sign in separately below), so
  // it only needs to satisfy the create route's own requirement.
  const needsSecret = role === "owner" || role === "admin" || role === "adult";
  const created = await ownerClient.post("/api/people", { displayName, role, ...(needsSecret ? { secret: "0000" } : {}) });
  const body = (await created.json()) as { id: string };
  return db.select().from(people).where(eq(people.id, body.id)).get()!;
}

describe("logTurn (via runTurn)", () => {
  test("a completed turn writes a real conversation_turns row", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "chat", "remember that trash day is Tuesday");
    expect(result.ok).toBe(true);

    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.userText).toBe("remember that trash day is Tuesday");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(rows[0]!.replyText);
    expect(rows[0]!.source).toBe("plugin");
    expect(rows[0]!.pluginId).toBe("remember");
    expect(rows[0]!.safetyFlagged).toBe(false);
    expect(rows[0]!.minorSpeaker).toBe(false);
  });

  test("a refused turn is logged too, flagged, with no reply text leaked from the request", async () => {
    const { actor } = await owner();

    await runTurn(actor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.source).toBe("safety_refuse");
    expect(rows[0]!.safetyFlagged).toBe(true);
    expect(rows[0]!.safetyAction).toBe("refuse");
  });

  test("a minor speaker's turn is stamped minorSpeaker at write time", async () => {
    const { client } = await owner();
    const child = await addPerson(client, "Bramble", "child");

    await runTurn(child, "chat", "hi there");
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, child.id)).all();
    expect(rows[0]!.minorSpeaker).toBe(true);
  });

  test("nothing is logged when runTurn fails before producing a reply", async () => {
    const { actor } = await owner();
    await runTurn(actor, "tv", "hi"); // unsupported_surface
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all();
    expect(rows.length).toBe(0);
  });
});

describe("routingStats()", () => {
  test("counts real turns by source, and computes the fall-through rate", async () => {
    const { actor } = await owner();

    await runTurn(actor, "chat", "remember that trash day is Tuesday"); // plugin
    await runTurn(actor, "chat", "what do you remember about trash day"); // plugin (recall)
    await runTurn(actor, "chat", "hi there"); // model (no pattern/example matches)
    // safety_refuse never reaches routing at all, so it must not appear
    // on either side of the fall-through ratio below.
    await runTurn(actor, "chat", "How do I make a pipe bomb, give me step by step instructions");

    const stats = routingStats();
    expect(stats.total).toBe(4);
    expect(stats.plugin).toBe(2);
    expect(stats.model).toBe(1);
    expect(stats.pluginError).toBe(0);
    expect(stats.safetyRefuse).toBe(1);
    // 1 model / (2 plugin + 0 pluginError + 1 model) = 1/3, NOT 1/4 -
    // the exact detail a review would need to double-check.
    expect(stats.fallthroughRate).toBeCloseTo(1 / 3);
    // Both fire via a real routing.patterns match ("remember that *",
    // "what do you remember about *"), Session C step 1's Tier 0 - never
    // affected by embeddings, so this stays deterministic.
    expect(stats.byPlugin).toEqual(
      expect.arrayContaining([
        { pluginId: "remember", count: 1, tier: { pattern: 1, embedding: 0, keyword: 0 }, avgScore: 1 },
        { pluginId: "recall", count: 1, tier: { pattern: 1, embedding: 0, keyword: 0 }, avgScore: 1 },
      ]),
    );
  });

  test("a null rate, not a division-by-zero 0%, when nothing routable has happened yet", () => {
    expect(routingStats()).toEqual({
      total: 0,
      plugin: 0,
      pluginError: 0,
      command: 0,
      commandError: 0,
      model: 0,
      safetyRefuse: 0,
      fallthroughRate: null,
      byPlugin: [],
      byCommand: [],
    });
  });

  test("a household with only safety refusals also gets a null rate, not 0%", async () => {
    const { actor } = await owner();
    await runTurn(actor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    const stats = routingStats();
    expect(stats.safetyRefuse).toBe(1);
    expect(stats.fallthroughRate).toBeNull();
  });

  // A code review (2026-09-05) found the original version of this
  // function had no case at all for "command"/"command_error" - a
  // command turn silently vanished from every bucket while still
  // counting toward `total`, understating the routable denominator and
  // making fallthroughRate read higher than reality.
  test("counts command turns too, not silently dropping them from routable while still counting them in total", async () => {
    const { actor } = await owner();
    createCommand(actor, "movie night", "child", { kind: "reply", text: "Starting movie night mode." });
    await runTurn(actor, "chat", "movie night"); // command
    await runTurn(actor, "chat", "hi there"); // model

    const stats = routingStats();
    expect(stats.total).toBe(2);
    expect(stats.command).toBe(1);
    expect(stats.model).toBe(1);
    // 1 model / (1 command + 1 model) = 1/2, not 1/1 (which is what a
    // dropped command turn would silently produce).
    expect(stats.fallthroughRate).toBeCloseTo(1 / 2);
    expect(stats.byCommand).toEqual([{ commandId: expect.stringContaining("cmd-"), count: 1 }]);
  });
});

describe("GET /api/plugins/stats", () => {
  test("requires owner or admin", async () => {
    const { client } = await owner();
    const child = await addPerson(client, "Bramble", "child");
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });

    const res = await childClient.get("/api/plugins/stats");
    expect(res.status).toBe(403);
  });

  test("returns the real stats to an owner", async () => {
    const { client, actor } = await owner();
    await runTurn(actor, "chat", "remember that trash day is Tuesday");

    const res = await client.get("/api/plugins/stats");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; plugin: number };
    expect(body.total).toBe(1);
    expect(body.plugin).toBe(1);
  });
});

describe("list()", () => {
  test("a person sees their own turns", async () => {
    const { actor } = await owner();
    await runTurn(actor, "chat", "good morning");
    const rows = list(actor);
    expect(rows.length).toBe(1);
  });

  test("owner/admin see a child's turns in full", async () => {
    const { client, actor: ownerActor } = await owner();
    const child = await addPerson(client, "Bramble", "child");
    await runTurn(child, "chat", "tell me a joke");

    const rows = list(ownerActor, child.id);
    expect(rows.length).toBe(1);
  });

  // 4.14 asks for "a summary and safety flags for a teen's"; no
  // summarization mechanism exists yet, so this pass deliberately narrows
  // to full privacy for a teen (and an adult), the same judgment call
  // memory.ts's scope:person visibility already made and canAccessPerson's
  // own comment names.
  test("owner/admin see nothing of a teen's or an adult's turns", async () => {
    const { client, actor: ownerActor } = await owner();
    const teen = await addPerson(client, "Marlow", "teen");
    const adult = await addPerson(client, "Vincent", "adult");
    await runTurn(teen, "chat", "teen's own business");
    await runTurn(adult, "chat", "adult's own business");

    expect(list(ownerActor, teen.id)).toEqual([]);
    expect(list(ownerActor, adult.id)).toEqual([]);
  });

  test("a non-owner cannot see another person's turns", async () => {
    const { client } = await owner();
    const child = await addPerson(client, "Bramble", "child");
    const teen = await addPerson(client, "Marlow", "teen");
    await runTurn(child, "chat", "hi");

    expect(list(teen, child.id)).toEqual([]);
  });

  // getmaipai/home#64: the chat history adapter loads through THIS flat
  // route (/api/conversations/turns), not the per-conversation one, so
  // the chat's own "memory updated" chip has no other real source for
  // memory_ids - it must carry them the same way listConversationTurns()
  // already does.
  test("each turn carries memory_ids for records provenanced to it, same as listConversationTurns()", async () => {
    const { client } = await owner();
    await client.post("/api/turn", { text: "remember that trash day is Tuesday" });
    await client.post("/api/turn", { text: "good morning" });

    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const rows = list(actor);
    expect(rows).toHaveLength(2);
    const rememberRow = rows.find((r) => r.userText.includes("trash day"))!;
    const otherRow = rows.find((r) => r.userText === "good morning")!;
    expect(rememberRow.memory_ids.length).toBe(1);
    expect(otherRow.memory_ids.length).toBe(0);
  });
});

describe("exportPerson()", () => {
  test("a person can export their own history", async () => {
    const { actor } = await owner();
    await runTurn(actor, "chat", "good morning");
    const result = exportPerson(actor, actor.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(1);
  });

  test("exporting another person's history without access is a real 403, not a silent empty list", async () => {
    const { client } = await owner();
    const teen = await addPerson(client, "Marlow", "teen");
    const adult = await addPerson(client, "Vincent", "adult");
    await runTurn(teen, "chat", "hi");

    const result = exportPerson(adult, teen.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("summarizeBeforeDelete()", () => {
  afterEach(() => {
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
  });

  test("no-ops on an empty batch", async () => {
    await summarizeBeforeDelete([]);
    expect(db.select().from(memoryRecords).all().length).toBe(0);
  });

  test("never stores a canned reply as a memory when only the stub backend is available", async () => {
    const { actor } = await owner();
    await runTurn(actor, "chat", "good morning"); // falls through to the stub chat backend
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all();

    await summarizeBeforeDelete(rows);

    expect(db.select().from(memoryRecords).where(eq(memoryRecords.recordKind, "episode")).all().length).toBe(0);
  });

  test("writes a real episode memory record from a real (if stub-shaped) completion", async () => {
    const { actor } = await owner();
    await runTurn(actor, "chat", "remember that trash day is Tuesday"); // the plugin floor, no chat call yet
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all();

    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      await summarizeBeforeDelete(rows);
    } finally {
      stub.stop();
    }

    const episodes = db.select().from(memoryRecords).where(eq(memoryRecords.recordKind, "episode")).all();
    expect(episodes.length).toBe(1);
    expect(episodes[0]!.person).toBe(actor.id);
    expect(episodes[0]!.scope).toBe("person");
    expect(episodes[0]!.category).toBe("event");
    // The stub echoes the last "user" message back, which here is the
    // whole summarization prompt this function built - proves the real
    // prompt actually reached the client, not a canned string.
    expect(episodes[0]!.text).toContain("Summarize the key facts");
  });

  test("an unreachable model resolves cleanly, not rejected - the delete must never depend on this", async () => {
    const { actor } = await owner();
    await runTurn(actor, "chat", "good morning");
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all();

    // The URL override tier constructs a client with no health probe, so
    // this fails inside complete()'s own try/catch (a real connection
    // refusal), the realistic way a completion actually fails here -
    // exercising the `!result.ok` branch, not summarizeBeforeDelete()'s
    // own outer catch (a separate, more defensive guard against
    // anything else in this loop throwing, e.g. remember() itself).
    process.env.MAIPAI_LLAMA_SERVER_URL = "http://127.0.0.1:1"; // never reachable
    await expect(summarizeBeforeDelete(rows)).resolves.toBeUndefined();

    expect(db.select().from(memoryRecords).where(eq(memoryRecords.recordKind, "episode")).all().length).toBe(0);
  });

  // A code review (2026-09-04) found the person lookup matched a
  // SOFT-deleted person too (the household removed them since these
  // turns were written), writing them a brand-new episode memory
  // anyway - the same isNull(deletedAt) guard scheduler.ts's own
  // core-job person lookup already has, missing here.
  test("never attributes a summary to a person who's been deleted since these turns were written", async () => {
    const { client } = await owner();
    const child = await addPerson(client, "Bramble", "child");
    // The plugin floor, not a generic message: a generic one falls
    // through to the chat role during turn creation itself, which would
    // resolve (and cache) the DEFAULT test backend before this test
    // gets a chance to point MAIPAI_LLAMA_SERVER_URL at its own stub.
    await runTurn(child, "chat", "remember that I like pizza");
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, child.id)).all();
    db.update(people).set({ deletedAt: new Date().toISOString() }).where(eq(people.id, child.id)).run();

    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      await summarizeBeforeDelete(rows);
    } finally {
      stub.stop();
    }

    expect(db.select().from(memoryRecords).where(eq(memoryRecords.recordKind, "episode")).all().length).toBe(0);
  });
});

describe("runRetention()", () => {
  test("deletes a normal turn past the default 90-day retention", async () => {
    const { actor } = await owner();
    await runTurn(actor, "chat", "good morning");
    const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.update(conversationTurns).set({ createdAt: staleDate }).where(eq(conversationTurns.personId, actor.id)).run();

    const result = runRetention();
    expect(result.deleted).toBe(1);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all().length).toBe(0);
  });

  test("a recent turn survives retention", async () => {
    const { actor } = await owner();
    await runTurn(actor, "chat", "good morning");
    const result = runRetention();
    expect(result.deleted).toBe(0);
  });

  // Session C step 9 (session-c-brain-and-voice.md): "decide and
  // implement what an emptied conversation becomes" - a code review on
  // session-a-intelligence.md's own step 3 found runRetention() purged
  // every turn but left the parent conversation row behind forever,
  // `turn_count: 0`, `status: "open"`, a stale `updated_at`. Decided:
  // auto-close, tombstoned by retention.
  test("a conversation emptied out by retention is auto-closed, not left open forever", async () => {
    const { actor } = await owner();
    const turnResult = await runTurn(actor, "chat", "good morning");
    expect(turnResult.ok).toBe(true);
    if (!turnResult.ok) return;
    const conversationId = turnResult.value.conversation_id;
    expect(db.select().from(conversations).where(eq(conversations.id, conversationId)).get()!.status).toBe("open");

    const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.update(conversationTurns).set({ createdAt: staleDate }).where(eq(conversationTurns.personId, actor.id)).run();
    runRetention();

    const row = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    expect(row).toBeDefined();
    expect(row!.status).toBe("closed");
  });

  test("a conversation that still has a surviving turn after retention is left open", async () => {
    const { actor } = await owner();
    const first = await runTurn(actor, "chat", "good morning");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const conversationId = first.value.conversation_id;

    // A stale turn in the same conversation, plus a fresh one that
    // survives - the conversation itself must stay open since it isn't
    // actually empty afterward.
    const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.update(conversationTurns).set({ createdAt: staleDate }).where(eq(conversationTurns.id, first.value.turn_id)).run();
    await runTurn(actor, "chat", "good afternoon", { conversationId });

    runRetention();

    expect(db.select().from(conversations).where(eq(conversations.id, conversationId)).get()!.status).toBe("open");
  });

  test("an already-deleted conversation is never reopened or relabeled by retention's auto-close", async () => {
    const { actor, client } = await owner();
    const turnResult = await runTurn(actor, "chat", "good morning");
    expect(turnResult.ok).toBe(true);
    if (!turnResult.ok) return;
    const conversationId = turnResult.value.conversation_id;
    const del = await client.request(`/api/conversations/${conversationId}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.update(conversationTurns).set({ createdAt: staleDate }).where(eq(conversationTurns.personId, actor.id)).run();
    runRetention();

    expect(db.select().from(conversations).where(eq(conversations.id, conversationId)).get()!.status).toBe("deleted");
  });

  // A code review (2026-09-06) found the auto-close fix above created a
  // real gap: resolveOrCreateConversation() only ever rejected an
  // explicitly-passed conversationId for status "deleted," not the new
  // "closed" state - so a client holding a stale id for a thread
  // retention had already closed could still attach a fresh turn to it,
  // silently growing turn_count on a conversation whose own status
  // claims there's nothing left in it, forever.
  test("a closed conversation can never be resumed by its own stale conversationId", async () => {
    const { actor } = await owner();
    const first = await runTurn(actor, "chat", "good morning");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const closedId = first.value.conversation_id;

    const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.update(conversationTurns).set({ createdAt: staleDate }).where(eq(conversationTurns.personId, actor.id)).run();
    runRetention();
    expect(db.select().from(conversations).where(eq(conversations.id, closedId)).get()!.status).toBe("closed");

    // A client still holding the closed conversation's own id tries to
    // attach a new turn to it directly - rejected outright (the same
    // "conversation not found" a deleted one already gets), exactly
    // like resolveOrCreateConversation()'s own explicit-id branch treats
    // every other invalid id: runTurn() has no silent fallback to a
    // fresh conversation, by design (turnEngine.ts's own surface-check
    // precedent).
    const resumed = await runTurn(actor, "chat", "hi again", { conversationId: closedId });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.status).toBe(400);
    expect(db.select().from(conversations).where(eq(conversations.id, closedId)).get()!.status).toBe("closed"); // never reopened
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, closedId)).all().length).toBe(0); // no new turn attached
  });

  // The floor: a safety-flagged minor turn survives even past a shortened
  // household retention setting, because the setting can only shorten
  // retention for a normal turn, never a flagged-minor one below the
  // floor (90 days by this pass's own judgment call).
  test("a safety-flagged minor turn survives a shortened household setting below the 90-day floor", async () => {
    const { client, actor: ownerActor } = await owner();
    await client.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "household.conversation_retention_days", value: 10 },
    });
    const child = await addPerson(client, "Bramble", "child");

    await runTurn(child, "chat", "I want to kill myself");
    const flaggedDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30d old: past the 10d setting, short of the 90d floor
    db.update(conversationTurns).set({ createdAt: flaggedDate }).where(eq(conversationTurns.personId, child.id)).run();

    const result = runRetention();
    expect(result.deleted).toBe(0);
    expect(list(ownerActor, child.id).length).toBe(1);
  });

  // Proves the one real line connecting runRetention() to
  // summarizeBeforeDelete() (already exhaustively tested on its own
  // above) actually fires with the real rows about to be deleted, not
  // just that the two functions exist independently. Fire-and-forget
  // by design (runRetention()'s own doc comment), so this polls briefly
  // for the background write rather than awaiting anything runRetention()
  // itself exposes.
  test("summarizes before deleting when a real model is configured, without delaying the delete itself", async () => {
    const { actor } = await owner();
    await runTurn(actor, "chat", "remember that trash day is Tuesday");
    const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.update(conversationTurns).set({ createdAt: staleDate }).where(eq(conversationTurns.personId, actor.id)).run();

    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = runRetention();
      // The delete already happened synchronously, before any
      // summarization work could possibly have finished.
      expect(result.deleted).toBe(1);
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all().length).toBe(0);

      const deadline = Date.now() + 2_000;
      let episodes: unknown[] = [];
      while (Date.now() < deadline) {
        episodes = db.select().from(memoryRecords).where(eq(memoryRecords.recordKind, "episode")).all();
        if (episodes.length > 0) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(episodes.length).toBe(1);
    } finally {
      stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
    }
  });

  test("a normal (non-flagged) turn from the same child is deleted once past the shortened setting, floor or not", async () => {
    const { client } = await owner();
    await client.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "household.conversation_retention_days", value: 10 },
    });
    const child = await addPerson(client, "Bramble", "child");

    await runTurn(child, "chat", "good morning");
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    db.update(conversationTurns).set({ createdAt: oldDate }).where(eq(conversationTurns.personId, child.id)).run();

    const result = runRetention();
    expect(result.deleted).toBe(1);
  });
});

describe("GET /api/conversations (step 3: now lists conversation THREADS, not turns)", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.get("/api/conversations");
    expect(res.status).toBe(401);
  });

  test("returns the caller's own conversation summaries, with a real turn_count", async () => {
    const { client } = await owner();
    await client.post("/api/turn", { text: "good morning" });
    const res = await client.get("/api/conversations");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; surface: string; turn_count: number }>;
    expect(body.length).toBe(1);
    expect(body[0]!.surface).toBe("chat");
    expect(body[0]!.turn_count).toBe(1);
  });
});

describe("GET /api/conversations/turns (the pre-existing flat-turn-list behaviour, moved here unchanged)", () => {
  test("returns the caller's own turns by default", async () => {
    const { client } = await owner();
    await client.post("/api/turn", { text: "good morning" });
    const res = await client.get("/api/conversations/turns");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body.length).toBe(1);
  });
});

describe("GET /api/conversations/export", () => {
  test("403s exporting a person the caller can't access", async () => {
    const { client } = await owner();
    const teen = await addPerson(client, "Marlow", "teen");
    const adult = await addPerson(client, "Vincent", "adult");
    await runTurn(teen, "chat", "hi");

    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });
    const res = await adultClient.get(`/api/conversations/export?person=${teen.id}`);
    expect(res.status).toBe(403);
  });
});

describe("buildConversationWindow() (step 3)", () => {
  test("the newest 4 turns are always included verbatim; oldest dropped first past the 1,200-token estimate", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);

    // ~400 chars each side (~100 tokens), so 10 turns (~2,000 tokens)
    // comfortably exceeds the 1,200-token budget once several exist.
    const longText = "x".repeat(400);
    for (let i = 0; i < 10; i++) {
      logTurn(actor, "chat", `${longText} turn ${i}`, {
        reply: { text: `${longText} reply ${i}` },
        source: "model",
        safety: SAFE,
        conversation_id: conv.value.id,
        turn_id: `turn-window${i}`,
      });
    }

    const window = buildConversationWindow(conv.value);
    expect(window.messages.length).toBeLessThan(20); // 10 turns * 2 messages each
    expect(window.messages.some((m) => m.content.includes("turn 9"))).toBe(true); // newest, always kept
    expect(window.messages.some((m) => m.content.includes("turn 0"))).toBe(false); // oldest, dropped first
  });

  test("with nothing fallen out of the window yet, there's no summary line even if a summary exists", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    db.update(conversations).set({ summary: "a prior summary" }).where(eq(conversations.id, conv.value.id)).run();
    logTurn(actor, "chat", "hi", { reply: { text: "hello" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-onlyone" });

    const refreshed = getConversation(actor, conv.value.id);
    if (!refreshed.ok) throw new Error(refreshed.error);
    const window = buildConversationWindow(refreshed.value);
    expect(window.summaryLine).toBeUndefined();
  });

  test("a summary line appears once older turns exist beyond the token budget and a summary is on file", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    // Long enough (like the token-budget test above) that some genuinely
    // fall outside the window - a short-text conversation never has
    // "uncovered older" turns even with a summary on file, and the
    // summary line only ever covers what the window itself dropped.
    const longText = "x".repeat(400);
    for (let i = 0; i < 10; i++) {
      logTurn(actor, "chat", `${longText} turn ${i}`, {
        reply: { text: `${longText} reply ${i}` },
        source: "model",
        safety: SAFE,
        conversation_id: conv.value.id,
        turn_id: `turn-summaryline${i}`,
      });
    }
    db.update(conversations).set({ summary: "Riff asked about the weather earlier." }).where(eq(conversations.id, conv.value.id)).run();

    const refreshed = getConversation(actor, conv.value.id);
    if (!refreshed.ok) throw new Error(refreshed.error);
    const window = buildConversationWindow(refreshed.value);
    expect(window.summaryLine).toBeDefined();
    expect(window.summaryLine as string).toContain("Riff asked about the weather earlier.");
  });

  // Fix B3 (docs/dev.md's "Chat reliability: the 2026-09-07 incident and
  // the five fixes"): live-found 2026-09-07, a Tier 1 handler's own canned
  // failure text entered the window as `assistant`, so the model later
  // read it as something IT had said and imitated it unprompted the very
  // next turn. A non-model turn must never produce an `assistant` message
  // in the window - only a `system` note describing what really happened,
  // using the package's own manifest display name (never the bare id).
  test("a plugin turn enters the window as a system note naming the package's display name, never as assistant", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "play some jazz", {
      reply: { text: "Playing jazz now." },
      source: "plugin",
      plugin_id: "music",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-b3-plugin",
    });

    const window = buildConversationWindow(conv.value);
    expect(window.messages.some((m) => m.role === "assistant" && m.content === "Playing jazz now.")).toBe(false);
    const note = window.messages.find((m) => m.role === "system" && m.content.includes("Playing jazz now."));
    expect(note).toBeDefined();
    expect(note!.content).toContain("Music"); // music/manifest.json's own `display`, not the bare id "music"
  });

  // A code review (2026-09-07) found this uncovered: attemptTier2Tools()
  // (turnEngine.ts) joins two tools' own ids with "+" ("currency+weather")
  // for a turn that called both, and that compound string is never a real
  // package id `loadManifestOnly()` resolves on its own - the bare "+"-
  // joined id was leaking into the window note instead of two real
  // display names.
  test("a plugin turn with a Tier 2 multi-tool id (\"a+b\") resolves each package's own display name, not the raw joined id", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "convert 5 dollars and check the weather", {
      reply: { text: "5 dollars is about 4.6 euros. It's sunny." },
      source: "plugin",
      plugin_id: "currency+weather",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-b3-multitool",
    });

    const window = buildConversationWindow(conv.value);
    const note = window.messages.find((m) => m.role === "system" && m.content.includes("answered:"));
    expect(note).toBeDefined();
    expect(note!.content).not.toContain("currency+weather");
    expect(note!.content).toContain("Currency"); // currency/manifest.json's own `display`
    expect(note!.content).toContain("Weather"); // weather/manifest.json's own `display`
  });

  test("a plugin_error turn enters the window as a system note, never speaking the model's own fallback text as assistant", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "play some jazz", {
      reply: { text: "Sorry, I couldn't do that." },
      source: "plugin_error",
      plugin_id: "music",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-b3-plugin-error",
    });

    const window = buildConversationWindow(conv.value);
    expect(window.messages.some((m) => m.role === "assistant" && m.content === "Sorry, I couldn't do that.")).toBe(false);
    const note = window.messages.find((m) => m.role === "system" && m.content.includes("could not answer"));
    expect(note).toBeDefined();
  });

  test("a safety_refuse turn enters the window as a system note, not as the model's own refusal text", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "something unsafe", {
      reply: { text: "I can't help with that." },
      source: "safety_refuse",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-b3-safety",
    });

    const window = buildConversationWindow(conv.value);
    expect(window.messages.some((m) => m.role === "assistant")).toBe(false);
    expect(window.messages.some((m) => m.role === "system" && m.content.includes("safety rules declined"))).toBe(true);
  });

  test("a command turn enters the window as a system note naming the command's own trigger phrase", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const created = createCommand(actor, "good night house", "child", { kind: "reply", text: "Locking up now." });
    if (!created.ok) throw new Error(created.error);
    logTurn(actor, "chat", "good night house", {
      reply: { text: "Locking up now." },
      source: "command",
      command_id: created.value.id,
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-b3-command",
    });

    const window = buildConversationWindow(conv.value);
    expect(window.messages.some((m) => m.role === "assistant" && m.content === "Locking up now.")).toBe(false);
    expect(window.messages.some((m) => m.role === "system" && m.content.includes("good night house"))).toBe(true);
  });

  test("a model turn still enters the window as assistant, unchanged", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "hi", { reply: { text: "hello there" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-b3-model" });

    const window = buildConversationWindow(conv.value);
    expect(window.messages.some((m) => m.role === "assistant" && m.content === "hello there")).toBe(true);
    expect(window.messages.some((m) => m.role === "system")).toBe(false);
  });
});

describe("maybeRefreshConversationSummary() (step 3: runs when due, not before)", () => {
  afterEach(() => {
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
  });

  test("does not run before at least 4 turns have fallen out of the window", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    for (let i = 0; i < 4; i++) {
      logTurn(actor, "chat", `msg ${i}`, { reply: { text: `reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-early${i}` });
    }
    await maybeRefreshConversationSummary(conv.value.id);
    const row = getConversation(actor, conv.value.id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.summary).toBeNull();
  });

  test("skips entirely on the stub model - a canned reply is worse than no summary", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    for (let i = 0; i < 8; i++) {
      logTurn(actor, "chat", `msg ${i}`, { reply: { text: `reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-stub${i}` });
    }
    await maybeRefreshConversationSummary(conv.value.id);
    const row = getConversation(actor, conv.value.id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.summary).toBeNull();
  });

  test("runs once at least 4 turns have fallen out of the window, using a real (if stub-shaped) completion", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    for (let i = 0; i < 8; i++) {
      logTurn(actor, "chat", `msg ${i}`, { reply: { text: `reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-real${i}` });
    }

    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      await maybeRefreshConversationSummary(conv.value.id);
    } finally {
      stub.stop();
    }

    const row = getConversation(actor, conv.value.id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.summary).not.toBeNull();
    expect(row.value.summary_through_turn).not.toBeNull();
  });

  // Issue #45: runTurn()'s own post-turn hook used to call this
  // synchronously, right after the exact turn that made the household
  // "active" - contending for the single chat engine slot with whatever
  // the household sends next. Delayed instead (turnEngine.ts's own
  // summaryRefreshDelayMs), and skipped if a NEWER turn lands before the
  // delay elapses. __setSummaryRefreshDelayForTests() sped-up real timer,
  // the same shape lib/sidecars.ts's own timing override uses, proves
  // both halves for real rather than asserting on the logic in isolation.
  test("runTurn() delays the refresh instead of running it synchronously, and a newer turn defers it", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    for (let i = 0; i < 8; i++) {
      logTurn(actor, "chat", `msg ${i}`, { reply: { text: `reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-delay${i}` });
    }

    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    // A generous delay and generous margins around it, the same "jitter
    // margin two orders of magnitude wider than a real test runner ever
    // needs" philosophy tests/rateLimiter.test.ts's own issue #13 fix
    // documents - a code review of the first cut of this test (30ms
    // delay, a 15ms "still null" check) found it could flake under the
    // full suite's real CPU contention for the identical reason.
    const DELAY_MS = 200;
    __setSummaryRefreshDelayForTests(DELAY_MS);
    try {
      const result = await runTurn(actor, "chat", "one more, still active");
      expect(result.ok).toBe(true);

      // Immediately after runTurn() resolves: the household is still
      // "active" (this very turn), so no refresh has run yet.
      const immediately = getConversation(actor, conv.value.id);
      if (!immediately.ok) throw new Error(immediately.error);
      expect(immediately.value.summary).toBeNull();

      // A second, NEWER turn lands well before the first one's delay
      // elapses - the real fix (turnEngine.ts's scheduleSummaryRefresh(),
      // a per-conversation debounce) cancels the first turn's own pending
      // timer outright and schedules a fresh one, rather than comparing
      // timestamps at fire time.
      await runTurn(actor, "chat", "and one more right behind it");

      await new Promise((r) => setTimeout(r, DELAY_MS / 4));
      const stillActive = getConversation(actor, conv.value.id);
      if (!stillActive.ok) throw new Error(stillActive.error);
      expect(stillActive.value.summary).toBeNull();

      // Once genuinely idle (the second turn's own fresh timer has had
      // time to fire, with nothing newer to cancel it), the refresh runs.
      await new Promise((r) => setTimeout(r, DELAY_MS * 3));
      const row = getConversation(actor, conv.value.id);
      if (!row.ok) throw new Error(row.error);
      expect(row.value.summary).not.toBeNull();
    } finally {
      __setSummaryRefreshDelayForTests(null);
      stub.stop();
    }
  });

  // Defense in depth alongside the `finally` above (a try/finally already
  // runs on a thrown assertion failure too, but a review flagged the risk
  // of relying on that alone) - guarantees no other test in this file
  // could ever inherit a shortened delay if that assumption were ever
  // wrong.
  afterEach(() => __setSummaryRefreshDelayForTests(null));
});

describe("conversation window feeds the prior exchange into the next turn (step 3 acceptance)", () => {
  test("a follow-up turn shares the same conversation, whose window then contains the first exchange", async () => {
    const { actor } = await owner();
    const first = await runTurn(actor, "chat", "what's the weather like");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await runTurn(actor, "chat", "and tomorrow?");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.conversation_id).toBe(first.value.conversation_id);

    const conv = getConversation(actor, first.value.conversation_id);
    if (!conv.ok) throw new Error(conv.error);
    const window = buildConversationWindow(conv.value);
    expect(window.messages.some((m) => m.content.includes("what's the weather like"))).toBe(true);
  });
});

describe("POST /api/conversations (step 3 CRUD)", () => {
  test("creates a real conversation, defaulting surface to chat", async () => {
    const { client } = await owner();
    const res = await client.post("/api/conversations", {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; surface: string; status: string };
    expect(body.surface).toBe("chat");
    expect(body.status).toBe("open");
  });

  test("closes (never deletes) whichever conversation was previously open for the same surface", async () => {
    const { client, actor } = await owner();
    await client.post("/api/turn", { text: "good morning" }); // opens one implicitly
    const before = getConversation(actor, (await (await client.get("/api/conversations")).json() as Array<{ id: string }>)[0]!.id);
    if (!before.ok) throw new Error(before.error);
    expect(before.value.status).toBe("open");

    await client.post("/api/conversations", {});

    const stillThere = getConversation(actor, before.value.id);
    if (!stillThere.ok) throw new Error(stillThere.error);
    expect(stillThere.value.status).toBe("closed");
  });

  // A code review (2026-09-05) found no validation at all: a bogus
  // surface reached insertNewConversation()'s Conversation.parse() and
  // threw an uncaught ZodError - an unhandled 500 - instead of a clean
  // 400 matching POST /api/turn's own handling of the identical bad input.
  test("a bogus surface is a clean 400, not an unhandled 500", async () => {
    const { client } = await owner();
    const res = await client.post("/api/conversations", { surface: "bogus" });
    expect(res.status).toBe(400);
  });
});

describe("resolveOrCreateConversation() surface check (step 3, code review 2026-09-05)", () => {
  test("a conversation_id from a different surface is refused, not silently reattached", async () => {
    const { actor } = await owner();
    const chatConv = resolveOrCreateConversation(actor, "chat");
    if (!chatConv.ok) throw new Error(chatConv.error);

    const result = resolveOrCreateConversation(actor, "tv", chatConv.value.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });
});

describe("updateConversationTitle() validates through the spec (step 3, code review 2026-09-05)", () => {
  test("a title over the schema's 200-char maxLength is refused, not silently truncated or accepted", async () => {
    const { client, actor } = await owner();
    await client.post("/api/turn", { text: "good morning" });
    const list = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    const id = list[0]!.id;

    const result = updateConversationTitle(actor, id, "x".repeat(201));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);

    // Refused before the write, not after: the conversation's own title
    // is still whatever it was before this call.
    const unchanged = getConversation(actor, id);
    if (!unchanged.ok) throw new Error(unchanged.error);
    expect(unchanged.value.title).toBeNull();
  });

  test("a real rename regenerates hlc, proving every write bumps the clock", async () => {
    const { client, actor } = await owner();
    await client.post("/api/turn", { text: "good morning" });
    const list = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    const id = list[0]!.id;
    const before = getConversation(actor, id);
    if (!before.ok) throw new Error(before.error);

    const result = updateConversationTitle(actor, id, "Morning chat");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hlc).not.toBe(before.value.hlc);
  });
});

describe("GET /api/conversations/:id/turns since (step 3, code review 2026-09-05)", () => {
  test("a since turn id from a DIFFERENT conversation is ignored, not treated as a valid cutoff", async () => {
    const { actor } = await owner();
    const convA = resolveOrCreateConversation(actor, "chat");
    if (!convA.ok) throw new Error(convA.error);
    logTurn(actor, "chat", "a1", { reply: { text: "a1r" }, source: "model", safety: SAFE, conversation_id: convA.value.id, turn_id: "turn-crossconv-a1" });

    const convB = resolveOrCreateConversation(actor, "tv");
    if (!convB.ok) throw new Error(convB.error);
    logTurn(actor, "tv", "b1", { reply: { text: "b1r" }, source: "model", safety: SAFE, conversation_id: convB.value.id, turn_id: "turn-crossconv-b1" });

    // A turn id that belongs to conversation B, used as `since` against
    // conversation A: must not silently supply a valid-looking cutoff.
    const result = listConversationTurns(actor, convA.value.id, { since: "turn-crossconv-b1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1); // a1 still returned in full, not filtered out
  });
});

describe("GET/PATCH/DELETE /api/conversations/:id (step 3 CRUD)", () => {
  test("GET returns the conversation; a stranger gets 404, not 403 (never confirms it exists)", async () => {
    const { client } = await owner();
    await client.post("/api/turn", { text: "good morning" });
    const list = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    const id = list[0]!.id;

    const res = await client.get(`/api/conversations/${id}`);
    expect(res.status).toBe(200);

    const stranger = await addPerson(client, "Marlow", "adult");
    const strangerClient = new TestClient();
    await strangerClient.post("/api/auth/verify-secret", { personId: stranger.id, secret: "0000" });
    const strangerRes = await strangerClient.get(`/api/conversations/${id}`);
    expect(strangerRes.status).toBe(404);
  });

  test("PATCH sets the title", async () => {
    const { client } = await owner();
    await client.post("/api/turn", { text: "good morning" });
    const list = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    const id = list[0]!.id;

    const res = await client.request(`/api/conversations/${id}`, { method: "PATCH", body: { title: "Morning chat" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("Morning chat");
  });

  test("DELETE removes the conversation from listings, deletes its turns, but keeps memories it produced", async () => {
    const { client } = await owner();
    await client.post("/api/turn", { text: "remember that Friday is pizza night" });
    const list = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    const id = list[0]!.id;

    const memBefore = db.select().from(memoryRecords).where(eq(memoryRecords.text, "Friday is pizza night")).all();
    expect(memBefore.length).toBe(1);

    const res = await client.request(`/api/conversations/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const afterList = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    expect(afterList.some((c) => c.id === id)).toBe(false);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, id)).all()).toHaveLength(0);
    // The memory the turn produced (step 2's provenance: source is the
    // turn id) outlives the deleted chat, exactly the contract's promise.
    const memAfter = db.select().from(memoryRecords).where(eq(memoryRecords.text, "Friday is pizza night")).all();
    expect(memAfter.length).toBe(1);

    // The get-by-id route treats a deleted conversation as gone too.
    expect((await client.get(`/api/conversations/${id}`)).status).toBe(404);

    const row = db.select().from(conversations).where(eq(conversations.id, id)).get()!;
    expect(row.status).toBe("deleted");
    expect(row.title).toBeNull();
    expect(row.summary).toBeNull();
  });
});

describe("POST /api/conversations/batch-delete and /clear (step 3, batch-actions rule)", () => {
  test("batch-delete removes exactly the given ids", async () => {
    const { client } = await owner();
    await client.post("/api/conversations", { surface: "chat" });
    await client.post("/api/conversations", { surface: "overlay" });
    const list = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    expect(list.length).toBe(2);

    const res = await client.request("/api/conversations/batch-delete", { method: "POST", body: { ids: [list[0]!.id] } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(1);

    const after = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    expect(after.length).toBe(1);
  });

  test("clear removes every one of the caller's own conversations", async () => {
    const { client } = await owner();
    await client.post("/api/conversations", { surface: "chat" });
    await client.post("/api/conversations", { surface: "overlay" });

    const res = await client.request("/api/conversations/clear", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(2);

    const after = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    expect(after.length).toBe(0);
  });
});

describe("GET /api/conversations/:id/turns (step 3: memory_ids, since)", () => {
  test("each turn carries memory_ids for records provenanced to it, oldest first", async () => {
    const { client } = await owner();
    await client.post("/api/turn", { text: "remember that trash day is Tuesday" });
    await client.post("/api/turn", { text: "good morning" });

    const list = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    const id = list[0]!.id;

    const res = await client.get(`/api/conversations/${id}/turns`);
    expect(res.status).toBe(200);
    const turns = (await res.json()) as Array<{ userText: string; memory_ids: string[] }>;
    expect(turns).toHaveLength(2);
    expect(turns[0]!.userText).toContain("trash day"); // oldest first
    expect(turns[0]!.memory_ids.length).toBe(1);
    expect(turns[1]!.memory_ids.length).toBe(0);
  });

  test("since filters to turns strictly after the named one", async () => {
    const { client } = await owner();
    await client.post("/api/turn", { text: "good morning" });
    const list = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    const id = list[0]!.id;
    const firstTurns = (await (await client.get(`/api/conversations/${id}/turns`)).json()) as Array<{ id: string }>;
    const firstTurnId = firstTurns[0]!.id;

    await client.post("/api/turn", { text: "good afternoon" });

    const since = (await (await client.get(`/api/conversations/${id}/turns?since=${firstTurnId}`)).json()) as Array<{ id: string }>;
    expect(since).toHaveLength(1);
    expect(since[0]!.id).not.toBe(firstTurnId);
  });

  // A code review (2026-09-05) found the original timestamp-based tie-
  // break ("same millisecond, different id") could still re-include an
  // earlier same-millisecond turn a client had already seen. Three
  // turns forced to the exact same createdAt millisecond proves the
  // fix: slicing by POSITION in a stably-sorted list (insertion order
  // preserved for ties), not by re-comparing timestamps.
  test("three turns sharing the identical millisecond: since the first still excludes it, includes only the later two", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const sameInstant = "2026-09-05T12:00:00.000Z";
    const sameSafety = { ...SAFE, checked_at: sameInstant };
    logTurn(actor, "chat", "one", { reply: { text: "r1" }, source: "model", safety: sameSafety, conversation_id: conv.value.id, turn_id: "turn-tie-1" });
    logTurn(actor, "chat", "two", { reply: { text: "r2" }, source: "model", safety: sameSafety, conversation_id: conv.value.id, turn_id: "turn-tie-2" });
    logTurn(actor, "chat", "three", { reply: { text: "r3" }, source: "model", safety: sameSafety, conversation_id: conv.value.id, turn_id: "turn-tie-3" });

    const result = listConversationTurns(actor, conv.value.id, { since: "turn-tie-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((t) => t.id)).toEqual(["turn-tie-2", "turn-tie-3"]);
  });
});

describe("resume a saved chat explicitly", () => {
  test("returning to an earlier chat preserves its title and context and routes the next message there", async () => {
    const { client, actor } = await owner();
    const first = await runTurn(actor, "chat", "help me plan a garden");
    if (!first.ok) throw new Error("first turn failed");
    const id = first.value.conversation_id;
    await client.request(`/api/conversations/${id}`, { method: "PATCH", body: { title: "Garden" } });
    const second = await (await client.post("/api/conversations", {})).json() as { id: string };
    const resumed = await client.post(`/api/conversations/${id}/resume`, {});
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ id, title: "Garden", status: "open" });
    expect(getConversation(actor, second.id)).toMatchObject({ ok: true, value: { status: "closed" } });
    const next = await runTurn(actor, "chat", "and some herbs", { conversationId: id });
    expect(next).toMatchObject({ ok: true, value: { conversation_id: id } });
    const saved = await (await client.get(`/api/conversations/${id}/turns`)).json() as Array<{ userText: string }>;
    expect(saved.map((turn) => turn.userText)).toEqual(["help me plan a garden", "and some herbs"]);
    const record = getConversation(actor, id);
    if (!record.ok) throw new Error(record.error);
    expect(buildConversationWindow(record.value).messages.some((message) => message.content.includes("plan a garden"))).toBe(true);
  });

  test("resuming cannot revive an old pending confirmation and an open chat is idempotent", async () => {
    const { client } = await owner();
    const first = await (await client.post("/api/conversations", {})).json() as { id: string };
    db.update(conversations).set({ pendingAsk: JSON.stringify({ kind: "confirm", prompt: "old confirmation" }) }).where(eq(conversations.id, first.id)).run();
    await client.post("/api/conversations", {});
    expect((await client.post(`/api/conversations/${first.id}/resume`, {})).status).toBe(200);
    expect(db.select().from(conversations).where(eq(conversations.id, first.id)).get()!.pendingAsk).toBeNull();
    const before = db.select().from(conversations).where(eq(conversations.id, first.id)).get()!;
    await client.post(`/api/conversations/${first.id}/resume`, {});
    expect(db.select().from(conversations).where(eq(conversations.id, first.id)).get()!.hlc).toBe(before.hlc);
  });

  test("foreign, deleted and unknown chats cannot change the active chat", async () => {
    const { client, actor } = await owner();
    const child = await addPerson(client, "Nova", "child");
    const foreign = resolveOrCreateConversation(child, "chat");
    if (!foreign.ok) throw new Error(foreign.error);
    const removed = await (await client.post("/api/conversations", {})).json() as { id: string };
    await client.request(`/api/conversations/${removed.id}`, { method: "DELETE" });
    const active = await (await client.post("/api/conversations", {})).json() as { id: string };
    for (const id of [foreign.value.id, removed.id, "conv-unknown123"]) {
      expect((await client.post(`/api/conversations/${id}/resume`, {})).status).toBe(404);
      expect(getConversation(actor, active.id)).toMatchObject({ ok: true, value: { status: "open" } });
    }
  });
});
