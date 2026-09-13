import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { resolveOrCreateConversation, logTurn, deleteConversationById } from "@/lib/conversationHistory";
import { recordEpisodes, deleteEpisodesForTurns, deleteEpisodesForPerson, listEpisodes, recallEpisodes, formatEpisodesForPrompt, dateWindowForQuery, ftsQueryFor, embedPendingEpisodes } from "@/lib/episodes";
import { forget, vectorToBuffer } from "@/lib/memory";
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
    const matches = recallEpisodes(actor, "what recipe did you suggest last week", undefined, { now: NOW });
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
    const matches = recallEpisodes(actor, "what did you say", new Float32Array([0.95, 0.05, 0]), { now: NOW });
    expect(matches[0]!.episode.turnId).toBe("t-dessert");
    // Below the cosine floor nothing comes back: a question about something
    // never said is empty, not the nearest unrelated turn.
    expect(recallEpisodes(actor, "what did you say", new Float32Array([0, 0, 0]), { now: NOW })).toEqual([]);
    expect(recallEpisodes(actor, "kayak rental", new Float32Array([-1, -1, -1]), { now: NOW })).toEqual([]);
  });

  test("with the real embed path (stub engine), pending episodes get vectors and recall still answers", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    const embedded = await embedPendingEpisodes();
    expect(embedded).toBeGreaterThan(0);
    expect(db.select().from(pendingEpisodeEmbeddings).all()).toHaveLength(0);
    const matches = recallEpisodes(actor, "risotto", new Float32Array(768), { now: NOW });
    expect(matches.map((m) => m.episode.turnId)).toContain("t-risotto");
  });
});

describe("MEM-04 formatEpisodesForPrompt()", () => {
  test("labels each side, dates each line, and stays under the cap", async () => {
    const { actor } = await setupOwner();
    seedThreeWeeks(actor);
    const matches = recallEpisodes(actor, "recipe dessert cilantro trip", undefined, { now: NOW, limit: 5 });
    const block = formatEpisodesForPrompt(matches, "Marlow", "en-US", NOW);
    expect(block.startsWith("From earlier conversations (what was said, not necessarily true):")).toBe(true);
    expect(block).toMatch(/\(7 days ago\), you replied: "Try a mushroom risotto recipe/);
    expect(block.length).toBeLessThanOrEqual(600);
    expect(formatEpisodesForPrompt([], "Marlow", "en-US", NOW)).toBe("");
  });

  test("a long quote is cut at a word boundary at 200 characters, and lines that would breach the cap are dropped whole", () => {
    const long = "word ".repeat(80).trim();
    const match = (i: number) => ({ episode: { id: `e${i}`, turnId: `t${i}`, conversationId: null, speaker: "user" as const, text: long, createdAt: daysAgo(3) }, pairedText: "", score: 1 });
    const block = formatEpisodesForPrompt([match(1), match(2), match(3), match(4)], "Marlow", "en-US", NOW);
    expect(block.length).toBeLessThanOrEqual(600);
    const firstLine = block.split("\n")[1]!;
    expect(firstLine).toContain('..."');
    expect(firstLine.length).toBeLessThan(260);
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
