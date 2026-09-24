import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetBackgroundSupervisorForTests } from "@/lib/backgroundSupervisor";
import { runTurn, __setSummaryRefreshDelayForTests } from "@/lib/turnEngine";
import {
  list,
  listConversations,
  exportPerson,
  runRetention,
  routingStats,
  summarizeBeforeDelete,
  logTurn,
  resolveOrCreateConversation,
  createConversation,
  getConversation,
  updateConversationTitle,
  updateConversationMode,
  listConversationTurns,
  buildConversationWindow,
  maybeRefreshConversationSummary,
  chooseConversationTurn,
  getPendingAsk,
  setPendingAsk,
  insertProvisionalTurn,
  markPreviousTurnCorrected,
} from "@/lib/conversationHistory";
import { createArtifact } from "@/lib/artifacts";
import { newConversationTurnId } from "@/lib/id";
import { createCommand } from "@/lib/commands";
import { REMEMBER_CONFIRM_VARIANTS } from "@/lib/replyVariation";
import { db } from "@/db";
import { people, conversationTurns, conversations, memoryRecords } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
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
  __resetBackgroundSupervisorForTests();
  delete process.env.MAIPAI_BACKGROUND_URL;
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
  test("temporary turns do not enter history, durable memory, or pending asks", async () => {
    const { actor } = await owner();
    const conversation = createConversation(actor, { surface: "chat", mode: "temporary" });
    if (!conversation.ok) throw new Error(conversation.error);
    expect(listConversations(actor)).toHaveLength(0);

    setPendingAsk(conversation.value.id, { kind: "confirm", prompt: "save it?", packageId: "remember", args: {} });
    expect(getPendingAsk(conversation.value.id)).toBeNull();
    const result = await runTurn(actor, "chat", "remember that trash day is Tuesday", { conversationId: conversation.value.id });
    expect(result.ok).toBe(true);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conversation.value.id)).all()).toHaveLength(0);
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.person, actor.id)).all()).toHaveLength(0);
  });

  test("temporary mode is unavailable to child and teen profiles", async () => {
    const { client } = await owner();
    const child = await addPerson(client, "Bramble", "child");
    const teen = await addPerson(client, "Rowan", "teen");
    expect(createConversation(child, { mode: "temporary" })).toEqual({ ok: false, status: 403, error: "temporary chat is not available for minors" });
    expect(createConversation(teen, { mode: "temporary" })).toEqual({ ok: false, status: 403, error: "temporary chat is not available for minors" });
  });

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

describe("logTurn's supersedes option (getmaipai/home#60)", () => {
  test("defaults to null for an ordinary turn", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);

    logTurn(actor, "chat", "hi", { reply: { text: "hello" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-original" });

    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-original")).get()!;
    expect(row.supersedes).toBeNull();
    expect(row.parentTurnId).toBeNull();
    expect(row.branchChosen).toBe(true);
  });

  test("an edit-and-resend writes a new row carrying the old turn's id, leaving the old row untouched", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);

    logTurn(actor, "chat", "whats the weather", {
      reply: { text: "sunny" },
      source: "model",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-original",
    });
    logTurn(
      actor,
      "chat",
      "what's the weather tomorrow",
      { reply: { text: "rainy" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-edited" },
      { supersedes: "turn-original" },
    );

    const original = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-original")).get()!;
    const edited = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-edited")).get()!;
    expect(original.supersedes).toBeNull(); // the replaced row is a real, untouched sibling - never rewritten
    expect(original.userText).toBe("whats the weather");
    expect(original.parentTurnId).toBeNull();
    expect(original.branchChosen).toBe(false);
    expect(edited.supersedes).toBe("turn-original");
    expect(edited.userText).toBe("what's the weather tomorrow");
    expect(edited.parentTurnId).toBeNull();
    expect(edited.branchChosen).toBe(true);

    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conv.value.id)).all();
    expect(rows.length).toBe(2); // both branches persist - editing never deletes the original
  });

  test("a later follow-up points at the selected sibling, and choosing the old sibling persists without rewriting either row", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const value = (turnId: string, text: string): TurnValue => ({ reply: { text }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: turnId });
    logTurn(actor, "chat", "first", value("turn-first", "first answer"));
    logTurn(actor, "chat", "edit", value("turn-edit", "edited answer"), { supersedes: "turn-first" });
    logTurn(actor, "chat", "follow-up", value("turn-follow", "follow-up answer"));

    const follow = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-follow")).get()!;
    expect(follow.parentTurnId).toBe("turn-edit");
    expect(follow.branchChosen).toBe(true);
    const chosen = chooseConversationTurn(actor, "turn-first");
    expect(chosen.ok).toBe(true);
    logTurn(actor, "chat", "next", value("turn-next", "next answer"));
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conv.value.id)).all();
    expect(rows.find((row) => row.id === "turn-first")?.branchChosen).toBe(true);
    expect(rows.find((row) => row.id === "turn-edit")?.branchChosen).toBe(false);
    expect(rows.find((row) => row.id === "turn-follow")?.parentTurnId).toBe("turn-edit");
    expect(rows.find((row) => row.id === "turn-next")?.parentTurnId).toBe("turn-first");
    expect(rows).toHaveLength(4);
  });

  // getmaipai/home#131 (a review finding on the fix itself): a real,
  // genuinely concurrent turn on the same conversation - nothing
  // serializes those - can still be "running" (insertProvisionalTurn()'s
  // own placeholder row) while a person picks a different branch.
  // chooseConversationTurn()'s own sibling query must never touch that
  // row's branchChosen: it isn't a real branch member yet, and
  // logTurn()'s own eventual upsert would silently overwrite whatever
  // this set anyway, hiding the bug rather than fixing it.
  test("choosing a branch never touches a still-running sibling's own row", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const value = (turnId: string, text: string): TurnValue => ({ reply: { text }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: turnId });
    logTurn(actor, "chat", "first", value("turn-choose-first", "first answer"));
    logTurn(actor, "chat", "edit", value("turn-choose-edit", "edited answer"), { supersedes: "turn-choose-first" });
    insertProvisionalTurn(actor, "chat", conv.value.id, "turn-choose-running", "still in flight");

    const chosen = chooseConversationTurn(actor, "turn-choose-first");
    expect(chosen.ok).toBe(true);
    const running = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-choose-running")).get()!;
    expect(running.status).toBe("running");
    expect(running.branchChosen).toBe(true); // insertProvisionalTurn()'s own schema default, untouched
  });

  // getmaipai/home#131 (the same review): a repair signal's own
  // "mark the previous turn corrected" write must skip a genuinely
  // concurrent turn's still-running row - it would otherwise sort as
  // the newest OTHER turn by createdAt and get marked corrected instead
  // of the real, already-finished previous one.
  test("marking the previous turn corrected skips a still-running row on the same conversation", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "first", { reply: { text: "first answer" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-corrected-real-previous" });
    insertProvisionalTurn(actor, "chat", conv.value.id, "turn-corrected-running", "still in flight");
    const corrected = markPreviousTurnCorrected(conv.value.id, "turn-corrected-current");
    expect(corrected).toBe("turn-corrected-real-previous");
    const running = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-corrected-running")).get()!;
    expect(running.correctedNextTurn).toBeNull();
  });

  // A code review (2026-09-13) found `supersedes` reached the DB straight
  // from POST /api/turn(/stream)'s own request body with nothing actually
  // checking it names a real, same-conversation turn - the exact gap a
  // buggy or malicious client could exploit to plant a row that points at
  // an unrelated or nonexistent turn.
  test("a supersedes value naming a turn from a DIFFERENT conversation is dropped, not stored", async () => {
    const { actor } = await owner();
    const convA = resolveOrCreateConversation(actor, "chat");
    const convB = resolveOrCreateConversation(actor, "tv");
    if (!convA.ok || !convB.ok) throw new Error("setup failed");

    logTurn(actor, "chat", "hi", { reply: { text: "hello" }, source: "model", safety: SAFE, conversation_id: convA.value.id, turn_id: "turn-conv-a" });
    logTurn(
      actor,
      "tv",
      "play something",
      { reply: { text: "ok" }, source: "model", safety: SAFE, conversation_id: convB.value.id, turn_id: "turn-conv-b" },
      { supersedes: "turn-conv-a" }, // cross-conversation - not this turn's own history
    );

    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-conv-b")).get()!;
    expect(row.supersedes).toBeNull();
  });

  test("a supersedes value naming a turn that doesn't exist is dropped, not stored", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);

    logTurn(
      actor,
      "chat",
      "hi",
      { reply: { text: "hello" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-real" },
      { supersedes: "turn-does-not-exist" },
    );

    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-real")).get()!;
    expect(row.supersedes).toBeNull();
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
        { pluginId: "remember", count: 1, tier: { pattern: 1, embedding: 0, keyword: 0, tool: 0 }, avgScore: 1 },
        { pluginId: "recall", count: 1, tier: { pattern: 1, embedding: 0, keyword: 0, tool: 0 }, avgScore: 1 },
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

  // REASONING-03 (owner's ruling, 2026-09-22, a privacy invariant, not
  // a setting): retires this test's own old contract ("an owner may
  // read a child's stored reasoning") - the write side
  // (conversationHistory.ts's buildTurnRow()) never stores a child's
  // reasoning at all now, so there is nothing left for even an
  // owner/admin's read to surface. Parental oversight keeps the
  // question, the answer, the sources, the executed tools and the
  // policy decisions (unaffected here). Adult reasoning is unchanged:
  // still stored, still readable by the speaker, and still invisible
  // to a second adult (canAccessPerson()'s existing "owner/admin see
  // nothing of an adult's turns" rule, the test right below this one).
  test("a child's turn with thinking forced on by a test budget writes an empty reasoning column and no reasoning in stats; an adult's turn still stores it and a second adult cannot read it", async () => {
    const { client, actor: ownerActor } = await owner();
    const child = await addPerson(client, "Bramble", "child");
    const conv = resolveOrCreateConversation(child, "chat");
    if (!conv.ok) throw new Error(conv.error);
    // "Thinking forced on by a test budget" stands in for here: a
    // reasoning string reaching logTurn() at all for a minor's turn,
    // whatever budget or path put it there - buildTurnRow()'s own
    // `minorSpeaker` gate (computed from the actor, not a client claim)
    // is what must refuse to store it regardless.
    logTurn(child, "chat", "remember Friday is pizza night", {
      reply: { text: "Got it, I'll remember that." },
      source: "plugin",
      plugin_id: "remember",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-reasoning-1",
      reasoning: "the household wants this remembered, so I should call remember",
    });

    const asChild = list(child, child.id);
    expect(asChild).toHaveLength(1);
    expect(asChild[0]!.reasoning).toBeUndefined();

    const asOwner = list(ownerActor, child.id);
    expect(asOwner).toHaveLength(1);
    expect(asOwner[0]!.reasoning).toBeUndefined();

    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-reasoning-1")).get();
    expect(row?.reasoning).toBeNull();
    // No reasoning in stats either: NodeExecution/GenerationInput carry
    // no raw reasoning text field at all (contract.ts's own shape) -
    // this row wrote no stats at all, so the check is that nothing
    // reintroduces the household's words there either.
    expect(row?.stats ? String(row.stats) : "").not.toContain("household wants this remembered");

    // An adult's own turn still stores its reasoning...
    const conv2 = resolveOrCreateConversation(ownerActor, "chat");
    if (!conv2.ok) throw new Error(conv2.error);
    logTurn(ownerActor, "chat", "remember trash day is Tuesday", {
      reply: { text: "Got it, I'll remember that." },
      source: "plugin",
      plugin_id: "remember",
      safety: SAFE,
      conversation_id: conv2.value.id,
      turn_id: "turn-reasoning-adult",
      reasoning: "the household wants this remembered, so I should call remember",
    });
    const row2 = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-reasoning-adult")).get();
    expect(row2?.reasoning).toBe("the household wants this remembered, so I should call remember");
    const asSelf = list(ownerActor, ownerActor.id).find((t) => t.id === "turn-reasoning-adult");
    expect(asSelf?.reasoning).toBe("the household wants this remembered, so I should call remember");

    // ...but a second adult cannot read it at all (canAccessPerson()'s
    // own "owner/admin see nothing of an adult's turns" rule).
    const secondAdult = await addPerson(client, "Marlow", "adult");
    expect(list(secondAdult, ownerActor.id)).toHaveLength(0);
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
    delete process.env.MAIPAI_BACKGROUND_URL;
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
    process.env.MAIPAI_BACKGROUND_URL = stub.url;
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
    process.env.MAIPAI_BACKGROUND_URL = "http://127.0.0.1:1"; // never reachable
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
    // gets a chance to point MAIPAI_BACKGROUND_URL at its own stub.
    await runTurn(child, "chat", "remember that I like pizza");
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, child.id)).all();
    db.update(people).set({ deletedAt: new Date().toISOString() }).where(eq(people.id, child.id)).run();

    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    process.env.MAIPAI_BACKGROUND_URL = stub.url;
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
    process.env.MAIPAI_BACKGROUND_URL = stub.url;
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
      delete process.env.MAIPAI_BACKGROUND_URL;
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
    const body = (await res.json()) as Array<{ id: string; surface: string; turn_count: number; pinned: boolean }>;
    expect(body.length).toBe(1);
    expect(body[0]!.surface).toBe("chat");
    expect(body[0]!.turn_count).toBe(1);
    expect(body[0]!.pinned).toBe(false);
  });

  test("searches titles and turn text without crossing person boundaries", async () => {
    const { client, actor } = await owner();
    const own = resolveOrCreateConversation(actor, "chat");
    if (!own.ok) throw new Error(own.error);
    logTurn(actor, "chat", "our garden plans", { reply: { text: "herbs for dinner" }, source: "model", safety: SAFE, conversation_id: own.value.id, turn_id: "turn-search-own" });
    const titled = updateConversationTitle(actor, own.value.id, "Garden plans");
    expect(titled.ok).toBe(true);
    const other = await addPerson(client, "Bramble", "adult");
    const otherConversation = resolveOrCreateConversation(other, "chat");
    if (!otherConversation.ok) throw new Error(otherConversation.error);
    logTurn(other, "chat", "private garden plans", { reply: { text: "private answer" }, source: "model", safety: SAFE, conversation_id: otherConversation.value.id, turn_id: "turn-search-other" });

    const titleResults = await client.get("/api/conversations?q=Garden");
    expect(titleResults.status).toBe(200);
    expect(((await titleResults.json()) as Array<{ id: string }>).map((row) => row.id)).toEqual([own.value.id]);
    const textResults = await client.get("/api/conversations?q=herbs");
    expect(((await textResults.json()) as Array<{ id: string }>).map((row) => row.id)).toEqual([own.value.id]);
    const privateResults = await client.get("/api/conversations?q=private");
    expect(await privateResults.json()).toEqual([]);
  });

  test("pins through PATCH and keeps pinned conversations first", async () => {
    const { client, actor } = await owner();
    const first = resolveOrCreateConversation(actor, "chat");
    if (!first.ok) throw new Error(first.error);
    logTurn(actor, "chat", "first", { reply: { text: "first" }, source: "model", safety: SAFE, conversation_id: first.value.id, turn_id: "turn-pin-first" });
    const titled = updateConversationTitle(actor, first.value.id, "First conversation");
    expect(titled.ok).toBe(true);
    const second = createConversation(actor, { surface: "chat" });
    if (!second.ok) throw new Error(second.error);
    logTurn(actor, "chat", "second", { reply: { text: "second" }, source: "model", safety: SAFE, conversation_id: second.value.id, turn_id: "turn-pin-second" });
    const pin = await client.request(`/api/conversations/${first.value.id}`, { method: "PATCH", body: { pinned: true } });
    expect(pin.status).toBe(200);
    const listResult = await client.get("/api/conversations");
    const rows = (await listResult.json()) as Array<{ id: string; pinned: boolean; title: string | null }>;
    expect(rows.map((row) => row.id)).toEqual([first.value.id, second.value.id]);
    expect(rows[0]!.pinned).toBe(true);
    expect(rows[0]!.title).toBe("First conversation");
  });

  // HOME-UI-02e: the route used to read `query ? undefined : person`,
  // silently dropping whichever person was being viewed the moment a
  // search query was present - an admin viewing a child's own thread
  // list who then searched would have gotten back their OWN matching
  // conversations instead, with nothing on screen saying the view had
  // switched. Both params are independent (conversationHistory.ts's own
  // `listConversations` already scopes a query to whichever `personId`
  // it's given); the route just needed to stop discarding one.
  test("combines person and search: an admin's query searches the viewed child's own conversations, not the admin's", async () => {
    const { client, actor } = await owner();
    const ownMatching = resolveOrCreateConversation(actor, "chat");
    if (!ownMatching.ok) throw new Error(ownMatching.error);
    logTurn(actor, "chat", "garden notes for me", { reply: { text: "compost tips" }, source: "model", safety: SAFE, conversation_id: ownMatching.value.id, turn_id: "turn-combo-own" });

    const child = await addPerson(client, "Bramble", "child");
    const childMatching = resolveOrCreateConversation(child, "chat");
    if (!childMatching.ok) throw new Error(childMatching.error);
    logTurn(child, "chat", "garden notes for Bramble", { reply: { text: "compost tips" }, source: "model", safety: SAFE, conversation_id: childMatching.value.id, turn_id: "turn-combo-child" });

    const res = await client.get(`/api/conversations?person=${child.id}&q=garden`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).toEqual([childMatching.value.id]);
  });

  // HOME-UI-02e's own search box is the first real, user-reachable
  // caller of this LIKE query since ConversationsPage was deleted -
  // `%`/`_` are LIKE wildcards, so a literal search for "50% off"
  // matching anything shaped "50<any char> off" instead of the actual
  // substring typed is a correctness bug, not just a theoretical one,
  // once a person can actually type it into a box.
  test("a literal percent or underscore in the query matches literally, not as a SQL wildcard", async () => {
    const { client, actor } = await owner();
    const discount = resolveOrCreateConversation(actor, "chat");
    if (!discount.ok) throw new Error(discount.error);
    logTurn(actor, "chat", "found a 50% off coupon", { reply: { text: "nice find" }, source: "model", safety: SAFE, conversation_id: discount.value.id, turn_id: "turn-escape-percent" });
    const unrelated = createConversation(actor, { surface: "chat" });
    if (!unrelated.ok) throw new Error(unrelated.error);
    logTurn(actor, "chat", "50x off the mark", { reply: { text: "way off" }, source: "model", safety: SAFE, conversation_id: unrelated.value.id, turn_id: "turn-escape-unrelated" });

    const literalPercent = await client.get(`/api/conversations?q=${encodeURIComponent("50%")}`);
    const literalRows = (await literalPercent.json()) as Array<{ id: string }>;
    expect(literalRows.map((row) => row.id)).toEqual([discount.value.id]);

    const wildcardAttempt = await client.get(`/api/conversations?q=${encodeURIComponent("50_off")}`);
    expect(await wildcardAttempt.json()).toEqual([]);
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

describe("POST /api/conversations/turns/:id/choose (persisted branch selection)", () => {
  test("chooses a sibling through the API and returns its persisted branch fields", async () => {
    const { client, actor } = await owner();
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error(conversation.error);
    const value = (turnId: string, text: string): TurnValue => ({ reply: { text }, source: "model", safety: SAFE, conversation_id: conversation.value.id, turn_id: turnId });
    logTurn(actor, "chat", "first", value("turn-api-first", "first answer"));
    logTurn(actor, "chat", "edited", value("turn-api-edited", "edited answer"), { supersedes: "turn-api-first" });

    const response = await client.post("/api/conversations/turns/turn-api-first/choose");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ turn_id: "turn-api-first", parent_turn_id: null, branch_chosen: true });
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-api-edited")).get()!.branchChosen).toBe(false);
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

// CHAT-03: a row from before the policy is redacted on the way into the
// model's window and the summary transcript, never rewritten in place.
describe("CHAT-03: the window and summary read historical credentials redacted", () => {
  test("a pre-policy row's user and reply text reach the window with the value replaced, and the row itself is untouched", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const value = `Jun${"i".repeat(2)}per${20}26`;
    logTurn(actor, "chat", "hi", { reply: { text: "hello" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-plain" });
    // Written past logTurn()'s redaction, straight into the table, the way a row from before this item sits.
    // The reply repeats it with its label (an unlabeled repeat is the policy's stated limit).
    db.update(conversationTurns).set({ userText: `the wifi password is ${value}`, replyText: `Got it, your wifi password is ${value}.` }).where(eq(conversationTurns.id, "turn-plain")).run();
    const window = buildConversationWindow(conv.value);
    expect(JSON.stringify(window.messages)).not.toContain(value);
    expect(window.messages.some((m) => m.content.includes("[credential redacted]"))).toBe(true);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-plain")).get()?.userText).toContain(value); // not rewritten
  });
});

describe("#88: retention never summarizes a replaced turn into a durable memory", () => {
  test("the expiring batch handed to summarizeBeforeDelete() carries the edited turn and not the one it superseded", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "the dentist is on the fourteenth", { reply: { text: "Noted." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-old-date" });
    logTurn(actor, "chat", "the dentist is on the fifteenth", { reply: { text: "Noted." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-new-date" }, { supersedes: "turn-old-date" });
    // The replaced turn crosses the retention cutoff first; its replacement is still young (the normal case, a review).
    const ancient = new Date(Date.now() - 200 * 86_400_000).toISOString();
    db.update(conversationTurns).set({ createdAt: ancient }).where(eq(conversationTurns.id, "turn-old-date")).run();
    logTurn(actor, "chat", "and the fifteenth is a Tuesday", { reply: { text: "It is." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-old-other" });
    db.update(conversationTurns).set({ createdAt: ancient }).where(eq(conversationTurns.id, "turn-old-other")).run();
    const seen: string[] = [];
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        seen.push(JSON.stringify(request.messages));
        return "They discussed a dentist appointment.";
      },
    });
    process.env.MAIPAI_BACKGROUND_URL = stub.url;
    try {
      runRetention();
      await new Promise((r) => setTimeout(r, 300)); // the summary batch is fire-and-forget
    } finally {
      stub.stop();
      delete process.env.MAIPAI_BACKGROUND_URL;
    }
    expect(seen.join("")).toContain("Tuesday"); // the batch was summarized
    expect(seen.join("")).not.toContain("fourteenth"); // without the replaced turn
  });
});

describe("CHAT-03: the reply side is redacted at write too", () => {
  test("a reply that repeats a labeled credential lands in reply_text with the marker", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const value = `Jun${"i".repeat(2)}per${20}26`;
    logTurn(actor, "chat", "what did I say the wifi password was", { reply: { text: `You said the wifi password is ${value}.` }, source: "plugin", plugin_id: "recall", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-echo" });
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-echo")).get()!;
    expect(row.replyText).toBe("You said the wifi password is [credential redacted].");
    expect(row.userText).toBe("what did I say the wifi password was"); // a question, nothing to redact
  });
});

describe("CHAT-03 (#89): a stored summary is redacted on every read", () => {
  test("a summary holding a credential reaches the window's summary line and the refresh prompt's prior summary redacted, and the stored summary is untouched", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const value = `Jun${"i".repeat(2)}per${20}26`;
    // Enough turns that older ones fall out of the verbatim window, so the summary line is used.
    const longText = "x".repeat(1200);
    for (let i = 0; i < 8; i++) {
      logTurn(actor, "chat", `${longText} turn ${i}`, { reply: { text: `reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-sum${i}` });
    }
    db.update(conversations).set({ summary: `Earlier they set the wifi password to ${value} and planned a trip.`, summaryThroughTurn: "turn-sum1" }).where(eq(conversations.id, conv.value.id)).run();
    const fresh = db.select().from(conversations).where(eq(conversations.id, conv.value.id)).get()!;
    const window = buildConversationWindow({ ...conv.value, summary: fresh.summary, summaryThroughTurn: fresh.summaryThroughTurn } as typeof conv.value);
    expect(window.summaryLine).toBeDefined();
    expect(window.summaryLine).not.toContain(value);
    expect(window.summaryLine).toContain("[credential redacted]");
    expect(fresh.summary).toContain(value); // never rewritten in place

    // The refresh prompt: the prior summary line it sends carries the marker, not the value.
    const seen: string[] = [];
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        seen.push(JSON.stringify(request.messages));
        return "A short summary.";
      },
    });
    process.env.MAIPAI_BACKGROUND_URL = stub.url;
    try {
      await maybeRefreshConversationSummary(conv.value.id);
    } finally {
      stub.stop();
      delete process.env.MAIPAI_BACKGROUND_URL;
    }
    expect(seen.join("")).not.toContain(value);
  });
});

describe("buildConversationWindow() (step 3)", () => {
  // Item 1b (#67): a guard's own honest line, stored as the reply of a
  // replaced model turn, must never come back to the model as its own
  // past words (it recited "nobody's told me" four times about one
  // film after one such turn). It enters the window as a system note.
  test("a guard-replaced model turn enters the window as a system note, never as the assistant's words", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "have you seen it", { reply: { text: "I don't actually have that - nobody's told me." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-guarded" }, { guardReasons: ["invention"] });
    logTurn(actor, "chat", "what's it about", { reply: { text: "A clownfish looking for his son." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-plain" });
    const window = buildConversationWindow(conv.value);
    const assistantLines = window.messages.filter((m) => m.role === "assistant").map((m) => m.content);
    expect(assistantLines).toEqual(["A clownfish looking for his son."]);
    expect(window.messages.some((m) => m.role === "system" && m.content === "[No reply was given to this.]")).toBe(true);
    expect(window.messages.some((m) => m.content.includes("nobody's told me"))).toBe(false);
    // A replaced line that carries a fact the next turn needs becomes a typed note, in nobody's voice.
    logTurn(actor, "chat", "add milk to the list", { reply: { text: "I haven't added anything to your list." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-narrated" }, { guardReasons: ["unsupported_action"] });
    const again = buildConversationWindow(conv.value);
    expect(again.messages.some((m) => m.role === "system" && m.content === "[Nothing was added to the list.]")).toBe(true);
    expect(again.messages.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual(["A clownfish looking for his son."]);
    // The streaming path can store a spoken sentence beside the honesty
    // line (a later sentence tripped a non-cuttable guard): the spoken
    // sentence is quoted, the line is not (a review).
    logTurn(actor, "chat", "what kind of film is it", { reply: { text: "It's a Pixar film. I don't know, sorry." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-partial" }, { guardReasons: ["example_parrot"] });
    const partial = buildConversationWindow(conv.value);
    expect(partial.messages.some((m) => m.role === "system" && m.content === '[The reply given was: "It\'s a Pixar film."]')).toBe(true);
    expect(partial.messages.some((m) => m.content.includes("I don't know, sorry"))).toBe(false);
    // A save-family pending line renders a waiting note in the family's own
    // words, not a "nothing saved" note (a review).
    logTurn(actor, "chat", "remember this recipe", { reply: { text: "That save is waiting on your confirmation." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-pending" }, { guardReasons: ["unsupported_action"] });
    const pending = buildConversationWindow(conv.value);
    expect(pending.messages.some((m) => m.role === "system" && m.content === "[The save is waiting on your confirmation.]")).toBe(true);
    expect(pending.messages.some((m) => m.content.includes("No memory was saved"))).toBe(false);
  });

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

  // CHAT-15: the row keeps a bounded outcome: a result's actions never
  // go on it, a result whose data would swell it loses the data, and
  // the reply text is cut past that; a row that fails to parse is
  // skipped by the reader, never thrown on.
  test("a retained outcome is trimmed to the row budget, and an unparsable row is skipped", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const big = "x".repeat(20_000);
    logTurn(actor, "chat", "what is the weather", {
      reply: { text: "Sunny." },
      source: "plugin",
      plugin_id: "weather",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-15-big",
    }, { outcomes: [{ callId: "c1", packageId: "weather", status: "succeeded", via: "tool_call", at: "2026-09-13T12:00:00.000Z", result: { reply: { text: "Sunny." }, actions: [{ kind: "noise", payload: big }], data: { blob: big } } }] });
    const { outcomesForConversation } = await import("@/lib/conversationHistory");
    const [kept] = outcomesForConversation(conv.value.id);
    expect(kept?.outcomes[0]?.result?.actions).toEqual([]);
    expect(kept?.outcomes[0]?.result?.data).toBeUndefined();
    expect(kept?.outcomes[0]?.result?.reply?.text).toBe("Sunny.");
    const { sqlite } = await import("@/db");
    expect((sqlite.query("SELECT length(outcomes) AS n FROM conversation_turns WHERE id = ?").get("turn-15-big") as { n: number }).n).toBeLessThan(8_192);
    sqlite.query("UPDATE conversation_turns SET outcomes = 'not json' WHERE id = ?").run("turn-15-big");
    expect(outcomesForConversation(conv.value.id)).toEqual([]);
  });

  // Item 4b: the forget command is the engine's own, not a household
  // command row; the note says what happened instead of "unknown".
  test("a forget turn enters the window as a note quoting the hub's answer, never as an unknown command", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "forget what I told you about Marlow's birthday", {
      reply: { text: "Forgotten: Marlow's birthday is in June." },
      source: "command",
      command_id: "forget",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-4b-forget",
    });
    const window = buildConversationWindow(conv.value);
    const note = window.messages.find((m) => m.role === "system" && m.content.includes("asked to forget"));
    expect(note?.content).toContain("Forgotten: Marlow's birthday is in June.");
    expect(window.messages.some((m) => m.content.includes("unknown"))).toBe(false);
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

  // A code review (2026-09-13) found a superseded row still fed the
  // model's own context window: an edited-and-resent message put the
  // stale, user-discarded exchange right back in front of the model
  // alongside the real one, defeating the entire point of an edit.
  test("a superseded turn never enters the model's own context window - only the edit does", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);

    logTurn(actor, "chat", "whats the weather", { reply: { text: "sunny" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-original" });
    logTurn(
      actor,
      "chat",
      "what's the weather tomorrow",
      { reply: { text: "rainy" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-edited" },
      { supersedes: "turn-original" },
    );

    const window = buildConversationWindow(conv.value);
    expect(window.messages.some((m) => m.content.includes("whats the weather") && !m.content.includes("tomorrow"))).toBe(false);
    expect(window.messages.some((m) => m.role === "assistant" && m.content === "sunny")).toBe(false);
    expect(window.messages.some((m) => m.content === "what's the weather tomorrow")).toBe(true);
    expect(window.messages.some((m) => m.role === "assistant" && m.content === "rainy")).toBe(true);
  });
});

describe("maybeRefreshConversationSummary() (step 3: runs when due, not before)", () => {
  afterEach(() => {
    delete process.env.MAIPAI_BACKGROUND_URL;
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
    process.env.MAIPAI_BACKGROUND_URL = stub.url;
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

  // A code review (2026-09-13) found that editing the exact turn named by
  // `summary_through_turn` made this function lose its place:
  // excludeSupersededRows() drops that row, an id lookup against the
  // filtered list then misses it, and the WHOLE older-than-window range -
  // already-summarized turns included - gets treated as new again.
  test("editing the turn that marks summary_through_turn doesn't reset progress - only the real new increment gets summarized again", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);

    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    process.env.MAIPAI_BACKGROUND_URL = stub.url;
    try {
      // First batch: 8 turns triggers a first summary covering the 4
      // oldest (turn-anchor0..3); summary_through_turn lands on turn-anchor3.
      for (let i = 0; i < 8; i++) {
        logTurn(actor, "chat", `first batch msg ${i}`, { reply: { text: `first batch reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-anchor${i}` });
      }
      await maybeRefreshConversationSummary(conv.value.id);
      const afterFirst = getConversation(actor, conv.value.id);
      if (!afterFirst.ok) throw new Error(afterFirst.error);
      expect(afterFirst.value.summary_through_turn).toBe("turn-anchor3");

      // Edit the EXACT turn the summary's own progress marker names - a
      // real edit-and-resend, not a hypothetical.
      logTurn(
        actor,
        "chat",
        "edited anchor message",
        { reply: { text: "edited anchor reply" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-anchor3-edited" },
        { supersedes: "turn-anchor3" },
      );
      // Four more turns fall out of the window past the (still-valid) anchor point.
      for (let i = 0; i < 4; i++) {
        logTurn(actor, "chat", `second batch msg ${i}`, { reply: { text: `second batch reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-second${i}` });
      }

      await maybeRefreshConversationSummary(conv.value.id);
      const afterSecond = getConversation(actor, conv.value.id);
      if (!afterSecond.ok) throw new Error(afterSecond.error);
      // The stub echoes the whole prompt back as the summary text, and
      // the prompt itself carries the FIRST summary forward verbatim as
      // "Prior summary: ..." - so "first batch msg 0" legitimately
      // appears once, carried from that prior summary. What must NOT
      // happen is a SECOND occurrence: that would mean the second call's
      // own transcript re-included an already-summarized turn, exactly
      // the bug (summary_through_turn's own turn getting superseded and
      // losing its place) this test exists to catch.
      const summary = afterSecond.value.summary ?? "";
      expect(summary.split("first batch msg 0").length - 1).toBe(1);
      expect(summary.split("first batch msg 1").length - 1).toBe(1);
      expect(summary.split("first batch msg 2").length - 1).toBe(1);
      expect(summary).toContain("edited anchor message");
    } finally {
      stub.stop();
    }
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

    __resetBackgroundSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    process.env.MAIPAI_BACKGROUND_URL = stub.url;
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
    const body = (await res.json()) as { id: string; surface: string; status: string; mode: string };
    expect(body.surface).toBe("chat");
    expect(body.status).toBe("open");
    expect(body.mode).toBe("chat");
  });

  test("switches a conversation to research mode and persists it", async () => {
    const { client } = await owner();
    const created = await client.post("/api/conversations", {});
    const id = ((await created.json()) as { id: string }).id;
    const changed = await client.request(`/api/conversations/${id}`, { method: "PATCH", body: { mode: "research" } });
    expect(changed.status).toBe(200);
    const changedBody = (await changed.json()) as { id: string; mode: string };
    expect(changedBody.id).toBe(id);
    expect(changedBody.mode).toBe("research");
    const loaded = await client.get(`/api/conversations/${id}`);
    expect(((await loaded.json()) as { mode: string }).mode).toBe("research");
  });

  test("refuses an unknown conversation mode without changing the stored mode", async () => {
    const { client, actor } = await owner();
    const created = await client.post("/api/conversations", {});
    const id = ((await created.json()) as { id: string }).id;
    const response = await client.request(`/api/conversations/${id}`, { method: "PATCH", body: { mode: "article" } });
    expect(response.status).toBe(400);
    const loaded = getConversation(actor, id);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.value.mode).toBe("chat");
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

describe("updateConversationMode()", () => {
  test("returns a validated research record and leaves the conversation id unchanged", async () => {
    const { actor } = await owner();
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error(conversation.error);
    const changed = updateConversationMode(actor, conversation.value.id, "research");
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.id).toBe(conversation.value.id);
    expect(changed.value.mode).toBe("research");
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

  // REASONING-03: listConversationTurns()'s own twin of list()'s
  // retired reasoning test above - same reason, same fix.
  test("a child's turn with thinking forced on by a test budget writes an empty reasoning column and no reasoning in stats; an adult's turn still stores it and a second adult cannot read it", async () => {
    const { client, actor: ownerActor } = await owner();
    const child = await addPerson(client, "Bramble", "child");
    const conv = resolveOrCreateConversation(child, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(child, "chat", "remember Friday is pizza night", {
      reply: { text: "Got it, I'll remember that." },
      source: "plugin",
      plugin_id: "remember",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: "turn-reasoning-2",
      reasoning: "the household wants this remembered, so I should call remember",
    });

    const asChild = listConversationTurns(child, conv.value.id);
    expect(asChild.ok).toBe(true);
    if (asChild.ok) expect(asChild.value[0]?.reasoning).toBeUndefined();

    const asOwner = listConversationTurns(ownerActor, conv.value.id);
    expect(asOwner.ok).toBe(true);
    if (asOwner.ok) expect(asOwner.value[0]?.reasoning).toBeUndefined();

    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-reasoning-2")).get();
    expect(row?.reasoning).toBeNull();
    expect(row?.stats ? String(row.stats) : "").not.toContain("household wants this remembered");

    // An adult's own turn still stores its reasoning, readable through
    // this same function by the speaker...
    const conv2 = resolveOrCreateConversation(ownerActor, "chat");
    if (!conv2.ok) throw new Error(conv2.error);
    logTurn(ownerActor, "chat", "remember trash day is Tuesday", {
      reply: { text: "Got it, I'll remember that." },
      source: "plugin",
      plugin_id: "remember",
      safety: SAFE,
      conversation_id: conv2.value.id,
      turn_id: "turn-reasoning-adult-2",
      reasoning: "the household wants this remembered, so I should call remember",
    });
    const asSelf = listConversationTurns(ownerActor, conv2.value.id);
    expect(asSelf.ok).toBe(true);
    if (asSelf.ok) expect(asSelf.value[0]?.reasoning).toBe("the household wants this remembered, so I should call remember");

    // ...but a second adult cannot read the conversation at all.
    const secondAdult = await addPerson(client, "Marlow", "adult");
    const asSecondAdult = listConversationTurns(secondAdult, conv2.value.id);
    expect(asSecondAdult.ok).toBe(false);
  });

  // SHELL-02 slice 4: canvas-split's own acceptance ("this slice must
  // survive reload") - the live `done` event's `TurnValue.artifact`
  // ({id, version}) has a reload-path twin here, read from the
  // `artifacts` table by `turn_id` rather than stored a second time on
  // the turn row itself.
  test("a turn that minted an artifact carries its id and version on reload", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const turnId = newConversationTurnId();
    logTurn(actor, "chat", "write me a short note about pizza night", { reply: { text: "Wrote it." }, source: "plugin", plugin_id: "write_document", safety: SAFE, conversation_id: conv.value.id, turn_id: turnId });
    const v1 = createArtifact({ conversationId: conv.value.id, turnId, kind: "markdown", title: "Pizza night", body: "Every Friday.", createdBy: actor.id, provenance: `artifact-tool:${turnId}` });

    const result = listConversationTurns(actor, conv.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.artifact).toEqual({ id: v1.id, version: 1 });
  });

  test("a turn with no artifact carries no artifact field", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "hi", { reply: { text: "hello" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-no-artifact" });

    const result = listConversationTurns(actor, conv.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.artifact).toBeUndefined();
  });

  test("a child never sees an artifact from their own safety-refused turn, but an owner/admin still does", async () => {
    const { client, actor: ownerActor } = await owner();
    const child = await addPerson(client, "Bramble", "child");
    const conv = resolveOrCreateConversation(child, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const turnId = newConversationTurnId();
    logTurn(child, "chat", "write something", { reply: { text: "I can't help with that." }, source: "safety_refuse", safety: { ...SAFE, action: "refuse" }, conversation_id: conv.value.id, turn_id: turnId });
    db.update(conversationTurns).set({ safetyAction: "refuse" }).where(eq(conversationTurns.id, turnId)).run();
    const v1 = createArtifact({ conversationId: conv.value.id, turnId, kind: "markdown", title: "Should not be visible", body: "x", createdBy: child.id, provenance: `artifact-tool:${turnId}` });

    const asChild = listConversationTurns(child, conv.value.id);
    expect(asChild.ok).toBe(true);
    if (asChild.ok) expect(asChild.value[0]?.artifact).toBeUndefined();

    const asOwner = listConversationTurns(ownerActor, conv.value.id);
    expect(asOwner.ok).toBe(true);
    if (asOwner.ok) expect(asOwner.value[0]?.artifact).toEqual({ id: v1.id, version: 1 });
  });

  // getmaipai/home#130: the weather/almanac card on /next/chat
  // disappeared after a reload because `structured_part` was computed
  // fresh on every live `done` event (turnEngine.ts's logTurnSafely())
  // but never written to the row - in these exact words, a turn with a
  // structured part is read back with it after a fresh load.
  test("a turn with a structured part is read back with it after a fresh load of the conversation", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const structuredPart = { kind: "spec_sheet" as const, tool_id: "weather", title: "Seattle", rows: [{ label: "Now", value: "57°F, partly cloudy" }] };
    logTurn(actor, "chat", "what's the weather in seattle", { reply: { text: "It's 57 and partly cloudy." }, source: "plugin", plugin_id: "weather", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-structured-part", structured_part: structuredPart });

    const result = listConversationTurns(actor, conv.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.structured_part).toEqual(structuredPart);
  });

  test("a turn with no structured part carries no structured_part field", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(actor, "chat", "hi", { reply: { text: "hello" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-no-structured-part" });

    const result = listConversationTurns(actor, conv.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.structured_part).toBeUndefined();
  });

  // A minor's own turn keeps its structured part: REASONING-03's age
  // gate is specific to `reasoning` (a privacy invariant about the
  // model's own thinking), never extended to `structured_part` - the
  // card is the reply itself, the same reasoning listConversationTurns()'s
  // own comment above the read-side spread gives.
  test("a minor's own structured part survives reload too - no age gate", async () => {
    const { client } = await owner();
    const child = await addPerson(client, "Sprout", "child");
    const conv = resolveOrCreateConversation(child, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const structuredPart = { kind: "spec_sheet" as const, tool_id: "almanac-date", title: "Today", rows: [{ label: "Date", value: "September 23" }] };
    logTurn(child, "chat", "what's today's date", { reply: { text: "It's September 23rd." }, source: "plugin", plugin_id: "almanac-date", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-structured-part-minor", structured_part: structuredPart });

    const result = listConversationTurns(child, conv.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.structured_part).toEqual(structuredPart);
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
