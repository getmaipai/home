import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { resolveOrCreateConversation, logTurn, deleteConversationById } from "@/lib/conversationHistory";
import {
  recordEpisodes,
  deleteEpisodesForTurns,
  deleteEpisodesForPerson,
  listEpisodes,
  recallEpisodes,
  formatEpisodesForPrompt,
  dateWindowForQuery,
  ftsQueryFor,
  embedPendingEpisodes,
  VECTOR_SCAN_RECENT_EPISODES,
  __vectorRowsScannedForTests,
  __resetVectorRowsScannedForTests,
  asksWhatHubSaid,
  episodeQueryEligible,
  contentTerms,
  formatEpisodeLine,
  answerTerms,
} from "@/lib/episodes";
import { forget, vectorToBuffer, type QueryVector } from "@/lib/memory";
import { TestClient } from "./client";
import { newPersonId } from "@/lib/id";
import { db, sqlite } from "@/db";
import { people, conversationTurns, episodes, pendingEpisodeEmbeddings, episodeEmbeddings } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
});

async function setupOwner(): Promise<{ actor: PersonRow; actor2: PersonRow }> {
  const now = new Date().toISOString();
  const hlc = `${Date.now()}:0:testfix`;
  const actorId = newPersonId();
  const actor2Id = newPersonId();

  const actor = db
    .insert(people)
    .values({
      id: actorId,
      displayName: "Marlow",
      role: "adult",
      avatarSeed: actorId,
      source: "hub",
      createdAt: now,
      updatedAt: now,
      hlc,
    })
    .returning()
    .get()!;

  const actor2 = db
    .insert(people)
    .values({
      id: actor2Id,
      displayName: "Iris",
      role: "adult",
      avatarSeed: actor2Id,
      source: "hub",
      createdAt: now,
      updatedAt: now,
      hlc,
    })
    .returning()
    .get()!;

  return { actor, actor2 };
}

const SAFE = {
  flagged: false,
  categories: [],
  action: "allow" as const,
  notify_parent: false,
  matched_signals: [],
  checked_at: new Date().toISOString(),
};

function makeTurn(actor: PersonRow, userText: string, replyText: string, source: "model" | "safety_refuse" = "model") {
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("setup failed");
  const turnId = `turn-${Math.random().toString(36).slice(2, 12)}`;
  logTurn(actor, "chat", userText, {
    reply: { text: replyText },
    source,
    safety: SAFE,
    conversation_id: conv.value.id,
    turn_id: turnId,
  });
  return db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!;
}

describe("episodes", () => {
  test("logTurn records 2 episodes and 2 queue rows for a model turn", async () => {
    const { actor } = await setupOwner();
    const turn = makeTurn(actor, "What's for dinner?", "How about pasta?");

    const episodeRows = db.select().from(episodes).where(eq(episodes.turnId, turn.id)).all();
    expect(episodeRows.length).toBe(2);
    expect(episodeRows.find((e) => e.speaker === "user")?.text).toBe("What's for dinner?");
    expect(episodeRows.find((e) => e.speaker === "assistant")?.text).toBe("How about pasta?");

    const queuedRows = db.select().from(pendingEpisodeEmbeddings).all();
    expect(queuedRows.length).toBe(2);
  });

  test("safety_refuse turns record no episodes", async () => {
    const { actor } = await setupOwner();
    const turn = makeTurn(actor, "something bad", "", "safety_refuse");

    const episodeRows = db.select().from(episodes).where(eq(episodes.turnId, turn.id)).all();
    expect(episodeRows.length).toBe(0);

    const queuedRows = db.select().from(pendingEpisodeEmbeddings).all();
    expect(queuedRows.length).toBe(0);
  });

  test("empty text on either side is skipped", async () => {
    const { actor } = await setupOwner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const turnId = `turn-${Math.random().toString(36).slice(2, 12)}`;

    logTurn(actor, "chat", "", {
      reply: { text: "Response without user input" },
      source: "model",
      safety: SAFE,
      conversation_id: conv.value.id,
      turn_id: turnId,
    });

    const turn = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!;

    const episodeRows = db.select().from(episodes).where(eq(episodes.turnId, turn.id)).all();
    expect(episodeRows.length).toBe(1); // only the assistant side
    expect(episodeRows[0]?.speaker).toBe("assistant");
  });

  test("FTS5 search finds episodes by text", async () => {
    const { actor } = await setupOwner();
    const turn1 = makeTurn(actor, "I love chocolate cake", "Delicious choice!");
    const turn2 = makeTurn(actor, "What about pizza?", "Pizza is great too");

    const result = sqlite.query("SELECT rowid FROM episodes_fts WHERE text MATCH 'chocolate' LIMIT 10").all() as Array<{ rowid: number }>;
    expect(result.length).toBeGreaterThan(0);

    const result2 = sqlite.query("SELECT rowid FROM episodes_fts WHERE text MATCH 'pizza' LIMIT 10").all() as Array<{ rowid: number }>;
    expect(result2.length).toBeGreaterThan(0);
  });

  test("listEpisodes returns only the actor's episodes", async () => {
    const { actor, actor2 } = await setupOwner();
    const turn1 = makeTurn(actor, "Marlow's question", "Marlow's answer");
    const turn2 = makeTurn(actor2, "Iris's question", "Iris's answer");

    const marlow = listEpisodes(actor);
    expect(marlow.length).toBe(2);
    expect(marlow.some((e) => e.text.includes("Marlow"))).toBe(true);
    expect(marlow.some((e) => e.text.includes("Iris"))).toBe(false);

    const iris = listEpisodes(actor2);
    expect(iris.length).toBe(2);
    expect(iris.some((e) => e.text.includes("Iris"))).toBe(true);
    expect(iris.some((e) => e.text.includes("Marlow"))).toBe(false);
  });

  test("deleteEpisodesForTurns removes episodes and pending queue rows", async () => {
    const { actor } = await setupOwner();
    const turn1 = makeTurn(actor, "First question", "First answer");
    const turn2 = makeTurn(actor, "Second question", "Second answer");

    let episodeRows = db.select().from(episodes).all();
    expect(episodeRows.length).toBe(4); // 2 turns × 2 sides

    deleteEpisodesForTurns([turn1.id]);

    episodeRows = db.select().from(episodes).all();
    expect(episodeRows.length).toBe(2); // only turn2's 2 sides remain

    const queuedRows = db.select().from(pendingEpisodeEmbeddings).all();
    expect(queuedRows.length).toBe(2); // only turn2's queue rows remain
  });

  test("deleteEpisodesForPerson removes all episodes for that person", async () => {
    const { actor, actor2 } = await setupOwner();
    const turn1 = makeTurn(actor, "Actor's turn", "Reply");
    const turn2 = makeTurn(actor2, "Actor2's turn", "Reply");

    let episodeRows = db.select().from(episodes).all();
    expect(episodeRows.length).toBe(4);

    deleteEpisodesForPerson(actor.id);

    episodeRows = db.select().from(episodes).all();
    expect(episodeRows.length).toBe(2); // only actor2's 2 sides remain
    expect(episodeRows.every((e) => e.personId === actor2.id)).toBe(true);

    const queuedRows = db.select().from(pendingEpisodeEmbeddings).all();
    expect(queuedRows.length).toBe(2); // only actor2's queue rows remain
  });

  test("forget() cleans up episodes via deleteEpisodesForPerson", async () => {
    const { actor } = await setupOwner();
    const turn = makeTurn(actor, "Something memorable", "I'll remember that");

    let episodeRows = db.select().from(episodes).where(eq(episodes.personId, actor.id)).all();
    expect(episodeRows.length).toBe(2);

    const result = forget(actor, actor.id);
    expect(result.ok).toBe(true);

    episodeRows = db.select().from(episodes).where(eq(episodes.personId, actor.id)).all();
    expect(episodeRows.length).toBe(0);

    const queuedRows = db.select().from(pendingEpisodeEmbeddings).all();
    expect(queuedRows.length).toBe(0);
  });

  test("deleteConversationById removes episodes for those turns", async () => {
    const { actor } = await setupOwner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");

    const turn1 = makeTurn(actor, "Turn 1", "Reply 1");
    const turn2 = makeTurn(actor, "Turn 2", "Reply 2");

    let episodeRows = db.select().from(episodes).all();
    expect(episodeRows.length).toBe(4);

    deleteConversationById(actor, conv.value.id);

    episodeRows = db.select().from(episodes).all();
    expect(episodeRows.length).toBe(0);

    const queuedRows = db.select().from(pendingEpisodeEmbeddings).all();
    expect(queuedRows.length).toBe(0);
  });
});

// ==== MEM-04: hybrid, time-aware recall ====

const NOW = new Date("2026-09-12T15:00:00.000Z");
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

/** One turn, backdated: logTurn() stamps created_at from the safety
 * check's own timestamp, and recordEpisodes() copies it onto both rows. */
function say(actor: PersonRow, conversationId: string, ageDays: number, userText: string, replyText: string, turnId: string) {
  logTurn(actor, "chat", userText, {
    reply: { text: replyText },
    source: "model",
    safety: { ...SAFE, checked_at: daysAgo(ageDays) },
    conversation_id: conversationId,
    turn_id: turnId,
  });
}

function newConversation(actor: PersonRow): string {
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error(conv.error);
  // Close it so the next call opens a fresh thread (one open per person and surface).
  sqlite.query("UPDATE conversations SET status = 'closed' WHERE id = ?").run(conv.value.id);
  return conv.value.id;
}

/** Three conversations over three weeks, the fixture the work order names. */
function qv(v: number | number[], preprocess: string = "v1"): QueryVector {
  const vector = typeof v === "number" ? new Float32Array(v) : new Float32Array(v);
  return { vector, space: "test", dims: vector.length, preprocess };
}

function seedThreeWeeks(actor: PersonRow): { threeWeeksAgo: string; lastWeek: string; yesterday: string } {
  const threeWeeksAgo = newConversation(actor);
  say(actor, threeWeeksAgo, 21, "any ideas for a picnic recipe", "A tomato tart travels well, and you could bring lemonade.", "t-old-recipe");
  say(actor, threeWeeksAgo, 21, "what about cilantro in the salad", "Skip the cilantro, half the table dislikes it.", "t-old-cilantro");
  const lastWeek = newConversation(actor);
  say(actor, lastWeek, 7, "what should we cook for the visitors", "Try a mushroom risotto recipe, it feeds six and reheats well.", "t-risotto");
  say(actor, lastWeek, 7, "and dessert", "Baked apples, they take twenty minutes.", "t-dessert");
  const yesterday = newConversation(actor);
  say(actor, yesterday, 1, "did we decide on the trip", "Yes, the coast on the first weekend of October.", "t-trip");
  return { threeWeeksAgo, lastWeek, yesterday };
}

describe("MEM-04 date windows and lexical queries", () => {
  test("a date phrase becomes a created_at window, and a plain question has none", () => {
    const lastWeek = dateWindowForQuery("what recipe did you suggest last week", NOW)!;
    expect(lastWeek).not.toBeNull();
    expect(lastWeek.end.getTime() - lastWeek.start.getTime()).toBe(7 * 86_400_000);
    expect(lastWeek.end.getTime()).toBeLessThanOrEqual(NOW.getTime());
    const yesterday = dateWindowForQuery("what did we decide yesterday", NOW)!;
    expect(yesterday.end.getTime() - yesterday.start.getTime()).toBe(86_400_000);
    expect(dateWindowForQuery("what is cilantro", NOW)).toBeNull();
    // A month named in September means last March, never next March.
    const march = dateWindowForQuery("what did we decide in March", NOW)!;
    expect(march.start.getFullYear()).toBe(2026);
    expect(march.end.getTime()).toBeLessThan(NOW.getTime());
    // Bare times, durations, and short words chrono reads as weekdays never narrow recall.
    expect(dateWindowForQuery("what did I tell you at 5pm", NOW)).toBeNull();
    expect(dateWindowForQuery("for 2 hours", NOW)).toBeNull();
    expect(dateWindowForQuery("did we talk about the sun", NOW)).toBeNull();
    // A month still ahead this year means last year's: "the October trip" in September is last October.
    const october = dateWindowForQuery("the October trip", NOW)!;
    expect(october.start.getFullYear()).toBe(2025);
    expect(october.start.getMonth()).toBe(9);
  });

  test("a possessive matches its subject: the query splits on the apostrophe the way the index does", () => {
    expect(ftsQueryFor("what did you say about Rover's paw")).toBe('"rover" OR "paw"');
  });

  test("the FTS query quotes every content term, drops stopwords and operators, and is null when nothing is left", () => {
    expect(ftsQueryFor("what recipe did you suggest last week")).toBe('"recipe"');
    expect(ftsQueryFor('cilantro OR "salad" NOT tart')).toBe('"cilantro" OR "salad" OR "not" OR "tart"');
    expect(ftsQueryFor("what did you say")).toBeNull();
  });
});

describe("MEM-04 recallEpisodes()", () => {
  test("\"what recipe did you suggest last week\" ranks the assistant turn from seven days ago first, not the three-week-old recipe", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    // RECALL-02b: the person's side is the default; a question about what
    // the hub suggested asks for both sides, as prepareTurn() does.
    const matches = recallEpisodes(actor, "what recipe did you suggest last week", undefined, { now: NOW, sides: "both", preferHubSide: true });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.episode.turnId).toBe("t-risotto");
    expect(matches[0]!.episode.speaker).toBe("assistant");
    expect(matches[0]!.pairedText).toBe("what should we cook for the visitors");
    expect(matches.some((m) => m.episode.turnId === "t-old-recipe")).toBe(false);
  });

  test("an exact word matches with no vectors stored at all", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    expect(db.select().from(episodeEmbeddings).all()).toHaveLength(0);
    const matches = recallEpisodes(actor, "cilantro", undefined, { now: NOW });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.episode.turnId).toBe("t-old-cilantro");
  });

  test("\"last week\" excludes a three-week-old mention of the same word", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    const matches = recallEpisodes(actor, "the tart recipe from last week", undefined, { now: NOW });
    expect(matches.map((m) => m.episode.turnId)).not.toContain("t-old-recipe");
  });

  test("the current conversation's newest four turns are never recalled (they are already in the window)", async () => {
    const { actor } = await setupOwner();
    const { yesterday } = seedThreeWeeks(actor);
    const withExclusion = recallEpisodes(actor, "the trip to the coast", undefined, { now: NOW, excludeConversationId: yesterday });
    expect(withExclusion.map((m) => m.episode.turnId)).not.toContain("t-trip");
    const without = recallEpisodes(actor, "the trip to the coast", undefined, { now: NOW });
    expect(without.map((m) => m.episode.turnId)).toContain("t-trip");
  });

  test("another person's episodes never appear, even for an owner", async () => {
    const { actor, actor2 } = await setupOwner();
    seedThreeWeeks(actor);
    const conv2 = newConversation(actor2);
    say(actor2, conv2, 2, "remember my cilantro allergy", "Noted.", "t-iris-cilantro");
    const forMarlow = recallEpisodes(actor, "cilantro", undefined, { now: NOW });
    expect(forMarlow.map((m) => m.episode.turnId)).toEqual(["t-old-cilantro"]);
    const forIris = recallEpisodes(actor2, "cilantro", undefined, { now: NOW });
    expect(forIris.map((m) => m.episode.turnId)).toEqual(["t-iris-cilantro"]);
  });

  test("the vector half ranks by cosine against the turn's own query vector, and fuses with the lexical half", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    // Hand-placed vectors, so the ranking is arithmetic, not a stub's
    // hashing: the dessert turn points where the query points.
    const hlc = `${Date.now()}:0:testfix`;
    const rows = db.select().from(episodes).all();
    const place = (turnId: string, speaker: "user" | "assistant", v: number[]) => {
      const ep = rows.find((r) => r.turnId === turnId && r.speaker === speaker)!;
      db.insert(episodeEmbeddings).values({ episodeId: ep.id, space: "test", dims: 3, vector: vectorToBuffer(v), hlc }).run();
    };
    place("t-dessert", "assistant", [1, 0, 0]);
    place("t-risotto", "assistant", [0, 1, 0]);
    place("t-trip", "assistant", [0, 0, 1]);
    const matches = recallEpisodes(actor, "what did you say", qv([0.95, 0.05, 0]), { now: NOW, sides: "both" });
    expect(matches[0]!.episode.turnId).toBe("t-dessert");
    // Below the cosine floor nothing comes back: a question about something
    // never said is empty, not the nearest unrelated turn.
    expect(recallEpisodes(actor, "what did you say", qv([0, 0, 0]), { now: NOW })).toEqual([]);
    expect(recallEpisodes(actor, "kayak rental", qv([-1, -1, -1]), { now: NOW })).toEqual([]);
  });

  test("with the real embed path (stub engine), pending episodes get vectors and recall still answers", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    const embedded = await embedPendingEpisodes();
    expect(embedded).toBeGreaterThan(0);
    expect(db.select().from(pendingEpisodeEmbeddings).all()).toHaveLength(0);
    const matches = recallEpisodes(actor, "risotto", qv(768), { now: NOW, sides: "both" }); // "risotto" is in the hub's side of t-risotto
    expect(matches.map((m) => m.episode.turnId)).toContain("t-risotto");
  });
});

// getmaipai/home#79: the vector half used to read every embedded episode
// the person has, on every turn, and episodes grow two rows per turn for
// ever. Now it reads the newest VECTOR_SCAN_RECENT_EPISODES (plus a
// dated query's own window, itself capped the same way).
describe("getmaipai/home#79: the vector scan is bounded", () => {
  /** N + 500 embedded episodes, one per turn (user side only, to keep the
   * seeding quick), inserted directly the way the vector test above
   * places its hand-made vectors, spread one minute apart. */
  function seedEmbedded(actor: PersonRow, count: number, conversationId: string, opts: { oldestInWindow?: { count: number; daysAgo: number; vector: number[] } } = {}): void {
    const hlc = `${Date.now()}:0:testfix`;
    const base = NOW.getTime() - count * 60_000;
    const turnRows: (typeof conversationTurns.$inferInsert)[] = [];
    const episodeRows: (typeof episodes.$inferInsert)[] = [];
    const vectorRows: (typeof episodeEmbeddings.$inferInsert)[] = [];
    for (let i = 0; i < count; i++) {
      const old = opts.oldestInWindow && i < opts.oldestInWindow.count ? opts.oldestInWindow : null;
      const createdAt = old ? new Date(new Date(daysAgo(old.daysAgo)).getTime() + i * 60_000).toISOString() : new Date(base + i * 60_000).toISOString();
      const turnId = `t-bulk-${i}`;
      turnRows.push({ id: turnId, conversationId, personId: actor.id, surface: "chat", userText: `bulk fact number ${i}`, replyText: "Okay.", source: "model", safetyAction: "allow", createdAt, hlc } as never);
      episodeRows.push({ id: `ep-bulk-${i}`, turnId, conversationId, personId: actor.id, speaker: "user", text: `bulk fact number ${i}`, createdAt, hlc } as never);
      vectorRows.push({ episodeId: `ep-bulk-${i}`, space: "test", dims: 3, vector: vectorToBuffer(old ? old.vector : [1, 0, 0]), hlc });
    }
    sqlite.transaction(() => {
      for (let i = 0; i < turnRows.length; i += 200) db.insert(conversationTurns).values(turnRows.slice(i, i + 200)).run();
      for (let i = 0; i < episodeRows.length; i += 200) db.insert(episodes).values(episodeRows.slice(i, i + 200)).run();
      for (let i = 0; i < vectorRows.length; i += 200) db.insert(episodeEmbeddings).values(vectorRows.slice(i, i + 200)).run();
    })();
  }

  test(`with ${VECTOR_SCAN_RECENT_EPISODES} + 500 embedded episodes, a turn reads at most ${VECTOR_SCAN_RECENT_EPISODES} vectors, the newest ones`, async () => {
    const { actor } = await setupOwner();
    const conversationId = newConversation(actor);
    seedEmbedded(actor, VECTOR_SCAN_RECENT_EPISODES + 500, conversationId);
    expect(db.select({ id: episodeEmbeddings.episodeId }).from(episodeEmbeddings).all()).toHaveLength(VECTOR_SCAN_RECENT_EPISODES + 500);
    __resetVectorRowsScannedForTests();
    const matches = recallEpisodes(actor, "what did I say", qv([1, 0, 0]), { now: NOW });
    expect(__vectorRowsScannedForTests()).toBe(VECTOR_SCAN_RECENT_EPISODES);
    expect(matches.length).toBeGreaterThan(0);
    // The newest rows are the ones read: the oldest 500 can never win.
    const newestTurn = `t-bulk-${VECTOR_SCAN_RECENT_EPISODES + 499}`;
    expect(matches.some((m) => m.episode.turnId === newestTurn)).toBe(true);
    expect(matches.some((m) => Number(m.episode.turnId.replace("t-bulk-", "")) < 500)).toBe(false);
  });

  test("a dated question reads its own window instead: the oldest 500, outside the recent scan, become reachable", async () => {
    const { actor } = await setupOwner();
    const conversationId = newConversation(actor);
    // The oldest 500 sit three weeks back with a distinguishable vector;
    // the newest N sit within the last two days and point elsewhere.
    seedEmbedded(actor, VECTOR_SCAN_RECENT_EPISODES + 500, conversationId, { oldestInWindow: { count: 500, daysAgo: 21, vector: [0, 1, 0] } });
    __resetVectorRowsScannedForTests();
    const undated = recallEpisodes(actor, "what did I say", qv([0, 1, 0]), { now: NOW });
    expect(__vectorRowsScannedForTests()).toBe(VECTOR_SCAN_RECENT_EPISODES);
    expect(undated).toEqual([]); // the recent scan never sees the old rows, and the recent vectors are orthogonal
    __resetVectorRowsScannedForTests();
    const dated = recallEpisodes(actor, "what did I say three weeks ago", qv([0, 1, 0]), { now: NOW });
    expect(__vectorRowsScannedForTests()).toBe(500); // the window's own rows, not the recent set
    expect(dated.length).toBeGreaterThan(0);
    expect(dated.every((m) => Number(m.episode.turnId.replace("t-bulk-", "")) < 500)).toBe(true);
  });
});

// getmaipai/home#78: episodes stored every reply verbatim, so a guard's
// honest replacement line or a package's error text came back in a
// later conversation as "you replied: ...", a position MaiPai never
// took. The assistant side is now recorded only for the model's own
// uncut reply or a package's successful one, read from the turn row's
// source and guard_reason, never from the text.
describe("getmaipai/home#78: guard lines and plugin errors are never recalled as MaiPai's own answer", () => {
  test("a guard-cut model reply and a failed plugin in conversation one leave no assistant episode; the person's words still do", async () => {
    const { actor } = await setupOwner();
    const { runTurn } = await import("@/lib/turnEngine");
    const { __resetLlmSupervisorForTests } = await import("@/lib/llmSupervisor");
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    // An attributed quote grounded nowhere: the invention guard replaces it.
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "Your brother said he would be late." });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const cut = await runTurn(actor, "chat", "any news from my brother");
      expect(cut.ok).toBe(true);
      if (!cut.ok) return;
      expect(cut.value.source).toBe("model");
      expect(cut.value.reply.text).not.toContain("late"); // the guard replaced it
      const cutRow = db.select().from(conversationTurns).where(eq(conversationTurns.id, cut.value.turn_id)).get()!;
      expect(cutRow.guardReason).toBe("invention"); // the row itself says so
      // A real package that fails: math cannot evaluate spoken words.
      const failed = await runTurn(actor, "chat", "calculate twelve times twelve");
      expect(failed.ok).toBe(true);
      if (!failed.ok) return;
      expect(failed.value.source).toBe("plugin_error");

      const rows = db.select().from(episodes).where(eq(episodes.personId, actor.id)).all();
      expect(rows.filter((r) => r.speaker === "user").map((r) => r.text).sort()).toEqual(["any news from my brother", "calculate twelve times twelve"]);
      expect(rows.filter((r) => r.speaker === "assistant")).toEqual([]);

      // A later conversation recalling either finds only the person's side.
      const later = recallEpisodes(actor, "what did you say about my brother", undefined, { now: new Date(), sides: "both" });
      expect(later.every((m) => m.episode.speaker === "user")).toBe(true);
      const block = formatEpisodesForPrompt(later, "Sage", "en-US", new Date());
      expect(block).not.toContain("you replied");
      expect(block).not.toContain(cut.value.reply.text);
      expect(block).not.toContain(failed.value.reply.text);
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
    }
  });

  test("a cut that keeps the model's own first sentence is still an answer: recorded, with no guard reason on the row", async () => {
    const { actor } = await setupOwner();
    const { runTurn } = await import("@/lib/turnEngine");
    const { __resetLlmSupervisorForTests } = await import("@/lib/llmSupervisor");
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    // Sentence one is a real answer; sentence two is an attributed quote
    // grounded nowhere, a cuttable invention, so guardReply() keeps the
    // prefix and drops the tail without an honest line.
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "Try a mushroom risotto, it feeds six. Your brother said he loves it." });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = await runTurn(actor, "chat", "any ideas for dinner");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.reply.text).toBe("Try a mushroom risotto, it feeds six.");
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get()!;
      expect(row.guardReason).toBeNull(); // cut, not replaced: the row holds the model's own words
      const assistantSides = db.select().from(episodes).where(eq(episodes.personId, actor.id)).all().filter((r) => r.speaker === "assistant");
      expect(assistantSides.map((r) => r.text)).toEqual(["Try a mushroom risotto, it feeds six."]);
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
    }
  });

  test("a package's successful reply and the model's own uncut reply are still recorded", async () => {
    const { actor } = await setupOwner();
    const { runTurn } = await import("@/lib/turnEngine");
    const { __resetLlmSupervisorForTests } = await import("@/lib/llmSupervisor");
    __resetLlmSupervisorForTests(); // back to the in-process stub after the test above's own URL stub
    const ok = await runTurn(actor, "chat", "remember that I like tea"); // the remember package answers
    expect(ok.ok && ok.value.source).toBe("plugin");
    const model = await runTurn(actor, "chat", "good morning, how is it going"); // the stub echoes, uncut
    expect(model.ok && model.value.source).toBe("model");
    const assistantSides = db.select().from(episodes).where(eq(episodes.personId, actor.id)).all().filter((r) => r.speaker === "assistant");
    expect(assistantSides).toHaveLength(2);
  });
});

describe("MEM-04 formatEpisodesForPrompt()", () => {
  test("labels each side, dates each line, and stays under the cap", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    // RECALL-02: a bag of one word per turn clears no lexical floor; the
    // query shares two words with the risotto turn and one plus its pair
    // with the tart turn.
    const matches = recallEpisodes(actor, "the mushroom risotto recipe for the picnic", undefined, { now: NOW, limit: 5, sides: "both" });
    const block = formatEpisodesForPrompt(matches, "Marlow", "en-US", NOW);
    expect(block.startsWith("From earlier conversations (what was said, not necessarily true):")).toBe(true);
    // RECALL-02: the hub's side is reported (the person's paired words
    // quoted, the answer as the words it covered), never "you replied".
    expect(block).not.toContain("you replied");
    expect(block).toMatch(/\(7 days ago\), when Marlow said ".*", your answer touched on .*risotto/);
    expect(block.length).toBeLessThanOrEqual(400);
    expect(block.split("\n").length).toBeLessThanOrEqual(4);
    expect(formatEpisodesForPrompt([], "Marlow", "en-US", NOW)).toBe("");
  });

  test("a long quote is cut at a word boundary at 200 characters, and lines that would breach the cap are dropped whole", () => {
    const long = "word ".repeat(80).trim();
    const match = (i: number) => ({ episode: { id: `e${i}`, turnId: `t${i}`, conversationId: null, speaker: "user" as const, text: long, createdAt: daysAgo(3) }, pairedText: "", score: 1 });
    const block = formatEpisodesForPrompt([match(1), match(2), match(3), match(4)], "Marlow", "en-US", NOW);
    expect(block.length).toBeLessThanOrEqual(400);
    const firstLine = block.split("\n")[1]!;
    expect(firstLine).toContain('..."');
    expect(firstLine.length).toBeLessThan(260);
  });
});

describe("RECALL-02: episodes are evidence, never lines", () => {
  test("the hub's side enters only on a question about what the hub said, and then as a reported note, never a quoted line", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    const userOnly = recallEpisodes(actor, "the mushroom risotto recipe for the visitors", undefined, { now: NOW, sides: "user" });
    expect(userOnly.length).toBeGreaterThan(0);
    expect(userOnly.every((m) => m.episode.speaker === "user")).toBe(true);
    // The search's own reading (both sides, no preference) keeps the
    // side that matched, verbatim.
    const search = recallEpisodes(actor, "what did you suggest we cook for the visitors", undefined, { now: NOW, sides: "both" });
    expect(search[0]!.episode.speaker).toBe("user");
    expect(search[0]!.episode.text).toBe("what should we cook for the visitors");
    const both = recallEpisodes(actor, "what did you suggest we cook for the visitors", undefined, { now: NOW, sides: "both", preferHubSide: true });
    const reply = both.find((m) => m.episode.speaker === "assistant")!;
    expect(reply).toBeDefined();
    const line = formatEpisodeLine(reply, "Marlow", "en-US", NOW);
    expect(line).not.toContain("you replied");
    expect(line).toContain('when Marlow said "what should we cook for the visitors"');
    expect(line).toContain("your answer touched on try, mushroom, risotto, recipe");
    expect(line).toContain("(topics, not its words)");
    expect(line).not.toContain("Try a mushroom risotto recipe, it feeds six");
  });

  test("a credential on either side of a turn keeps the whole turn out of the prompt", async () => {
    const { actor } = await setupOwner();
    const conv = newConversation(actor);
    say(actor, conv, 5, "the wifi password is hunter2hunter2 by the way", "Got it, I will remember the wifi password.", "t-wifi");
    expect(recallEpisodes(actor, "what did you say about the wifi password", undefined, { now: NOW, sides: "both", preferHubSide: true })).toEqual([]);
    expect(recallEpisodes(actor, "the wifi password we talked about", undefined, { now: NOW, sides: "user" })).toEqual([]);
  });

  test("the answer's topics drop a leading acknowledgment and read as a phrase, not a list to quote", () => {
    expect(answerTerms("Cool, a Tempo treadmill could help Sage stay active during work hours.")).toBe("tempo, treadmill, could, help, sage, stay, active, during, work and hours");
    expect(answerTerms("Okay.")).toBe("nothing of substance");
    expect(answerTerms("Oh, nice! A Tempo treadmill for the office.")).toBe("tempo, treadmill and office");
    expect(answerTerms("Baked apples.")).toBe("baked and apples");
  });

  test("the shapes that ask what the hub said, and the ones that do not", () => {
    for (const q of ["what did you say about Tempo the other day", "what did you suggest for dinner", "remind me what you recommended", "what was your advice on the desk", "did you mention a deadline"]) {
      expect(asksWhatHubSaid(q)).toBe(true);
    }
    for (const q of ["what did I say about the trip", "is a standing desk worth it", "Sage is getting a Tempo treadmill", "what were we talking about"]) {
      expect(asksWhatHubSaid(q)).toBe(false);
    }
  });

  test("a turn with fewer than two content words, or one about this conversation, earns no lookup", () => {
    expect(episodeQueryEligible("what were we talking about")).toBe(false);
    expect(episodeQueryEligible("say that again")).toBe(false);
    expect(episodeQueryEligible("what did you mean")).toBe(false);
    expect(episodeQueryEligible("thanks")).toBe(false);
    expect(episodeQueryEligible("okay")).toBe(false);
    // Two content words, but a bare greeting or acknowledgment: last
    // week's greeting would clear the lexical floor otherwise.
    expect(episodeQueryEligible("good morning")).toBe(false);
    expect(episodeQueryEligible("Good morning!")).toBe(false);
    expect(episodeQueryEligible("sounds good")).toBe(false);
    expect(episodeQueryEligible("thanks a lot")).toBe(false);
    expect(episodeQueryEligible("good morning MaiPai")).toBe(false);
    expect(episodeQueryEligible("hi Marlow!")).toBe(false);
    expect(episodeQueryEligible("morning everyone")).toBe(false);
    // A bare word plus a content word is not a social turn.
    expect(episodeQueryEligible("nice car")).toBe(true);
    expect(episodeQueryEligible("no dentist")).toBe(true);
    expect(episodeQueryEligible("good morning, is the dentist tomorrow")).toBe(true);
    // RECALL-02b: a thank-you with its object, and the other ways of
    // asking about this conversation.
    for (const q of ["thanks for the update", "thank you for the reminder!", "Thanks for the heads up, MaiPai", "what did we discuss", "what were we covering", "what have we covered so far", "what did we just talk about", "what was that about"]) {
      expect([q, episodeQueryEligible(q)]).toEqual([q, false]);
    }
    expect(episodeQueryEligible("thanks for the recipe, what was the oven temperature")).toBe(true);
    // With a subject after it, a past-tense form is about earlier talk.
    expect(episodeQueryEligible("what did we discuss about the coast trip")).toBe(true);
    expect(episodeQueryEligible("what did we talk about regarding Marsh's training")).toBe(true);
    expect(episodeQueryEligible("is a standing desk worth it")).toBe(true);
    expect(episodeQueryEligible("when is my dentist appointment")).toBe(true);
    expect(episodeQueryEligible("what day is my dentist appointment")).toBe(true);
    expect(contentTerms("Sage is getting a Tempo treadmill for the office")).toEqual(["sage", "getting", "tempo", "treadmill", "office"]);
  });

  test("RECALL-02b: the person's side is the default for every caller; the hub's side is opt-in", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    // "risotto" is only in the hub's side of t-risotto: the default finds nothing.
    expect(recallEpisodes(actor, "risotto", undefined, { now: NOW })).toEqual([]);
    expect(recallEpisodes(actor, "risotto", undefined, { now: NOW, sides: "both" }).map((m) => m.episode.turnId)).toEqual(["t-risotto"]);
  });

  test("the lexical floor: one shared word admits nothing, two admit the turn, one plus the vector floor admits it", async () => {
    const { actor } = await setupOwner();
    const band = newConversation(actor);
    say(actor, band, 9, "I have been listening to Tempo all morning", "Tempo's second album is the one to start with, the drumming is unreal.", "t-band");
    say(actor, band, 9, "any review of the new record", "Critics called it their tightest set, and the closing track is a standout.", "t-review");
    // One shared word ("tempo"), no vector: nothing.
    expect(recallEpisodes(actor, "Sage is getting a Tempo treadmill for the office", undefined, { now: NOW })).toEqual([]);
    // Two shared words: the turn.
    expect(recallEpisodes(actor, "the Tempo album from this morning", undefined, { now: NOW }).map((m) => m.episode.turnId)).toEqual(["t-band"]);
    // One shared word and a vector at the floor: the turn.
    const { sqlite } = await import("@/db");
    const row = db.select({ id: episodes.id }).from(episodes).where(eq(episodes.turnId, "t-band")).all()[0]!;
    sqlite.query("INSERT INTO episode_embeddings (episode_id, space, dims, vector, hlc) VALUES (?, 'test', 3, ?, 'test-hlc')").run(row.id, Buffer.from(new Float32Array([1, 0, 0]).buffer));
    expect(recallEpisodes(actor, "Sage is getting a Tempo treadmill for the office", qv([1, 0, 0]), { now: NOW }).map((m) => m.episode.turnId)).toEqual(["t-band"]);
  });

  test("a hub-side line at its longest fits the cap, and a line that would breach it is skipped, not the block", () => {
    const paired = "word ".repeat(40).trim();
    const answer = "consideration ".repeat(30).trim();
    const hub = { episode: { id: "e-hub", turnId: "t-hub", conversationId: null, speaker: "assistant" as const, text: answer, createdAt: daysAgo(3) }, pairedText: paired, score: 2 };
    const short = { episode: { id: "e-short", turnId: "t-short", conversationId: null, speaker: "user" as const, text: "a short thing", createdAt: daysAgo(3) }, pairedText: "", score: 1 };
    const one = formatEpisodesForPrompt([hub], "Marlow", "en-US", NOW);
    expect(one.length).toBeLessThanOrEqual(400);
    expect(one).toContain("touched on");
    const long = { ...hub, pairedText: "word ".repeat(120).trim() };
    const block = formatEpisodesForPrompt([long, short], "Marlow", "en-US", NOW);
    expect(block).toContain("a short thing");
  });

  test("at most three lines and 400 characters", () => {
    const match = (i: number) => ({ episode: { id: `e${i}`, turnId: `t${i}`, conversationId: null, speaker: "user" as const, text: `line number ${i} about a short thing`, createdAt: daysAgo(3) }, pairedText: "", score: 1 });
    const block = formatEpisodesForPrompt([match(1), match(2), match(3), match(4), match(5)], "Marlow", "en-US", NOW);
    expect(block.split("\n").length).toBe(4);
    expect(block.length).toBeLessThanOrEqual(400);
  });
});

describe("GET /api/conversations/search", () => {
  test("requires a signed-in person and returns only their own turns", async () => {
    const anon = new TestClient();
    expect((await anon.get("/api/conversations/search?q=cilantro")).status).toBe(401);

    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Marlow", secret: "correcthorse" });
    const me = (await (await client.get("/api/auth/me")).json()) as { id: string };
    const actor = db.select().from(people).where(eq(people.id, me.id)).get()!;
    const { actor2 } = await setupOwner();
    seedThreeWeeks(actor);
    const conv2 = newConversation(actor2);
    say(actor2, conv2, 2, "my cilantro allergy", "Noted.", "t-other-cilantro");

    const res = await client.get("/api/conversations/search?q=cilantro");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ turn_id: string; speaker: string; text: string; paired_text: string }>;
    expect(body.map((r) => r.turn_id)).toEqual(["t-old-cilantro"]);
    expect(body[0]!.paired_text.length).toBeGreaterThan(0);
  });
});

// #88 (docs/dev/session-a.md): a turn another turn in its conversation
// names in `supersedes` (edited and resent) is off the current branch;
// its episodes stay stored and are never recalled.
describe("#88: an edited turn's episodes are never recalled", () => {
  test("a recall from another conversation returns the edited statement, not the replaced one, while both rows stay", async () => {
    const { actor } = await setupOwner();
    const earlier = newConversation(actor);
    say(actor, earlier, 7, "the dentist appointment is on the fourteenth", "Noted, the fourteenth.", "t-dentist-old");
    // The edit: the person resends the corrected statement, superseding the old turn.
    logTurn(
      actor,
      "chat",
      "the dentist appointment is on the fifteenth",
      { reply: { text: "Noted, the fifteenth." }, source: "model", safety: { ...SAFE, checked_at: daysAgo(7) }, conversation_id: earlier, turn_id: "t-dentist-new" },
      { supersedes: "t-dentist-old" },
    );
    sqlite.query("UPDATE episodes SET created_at = ? WHERE turn_id = ?").run(daysAgo(7), "t-dentist-new");
    newConversation(actor);
    const matches = recallEpisodes(actor, "when is the dentist appointment", undefined, { now: NOW });
    expect(matches.some((m) => m.episode.turnId === "t-dentist-old")).toBe(false);
    expect(matches.some((m) => m.episode.turnId === "t-dentist-new")).toBe(true);
    expect(db.select().from(episodes).where(eq(episodes.turnId, "t-dentist-old")).all().length).toBeGreaterThan(0); // stored, for the history view
    // The explicit history view keeps what was said: the search still finds the replaced turn.
    const history = recallEpisodes(actor, "when is the dentist appointment", undefined, { now: NOW, includeSuperseded: true });
    expect(history.some((m) => m.episode.turnId === "t-dentist-old")).toBe(true);
  });
});
