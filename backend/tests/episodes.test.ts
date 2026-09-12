import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { resolveOrCreateConversation, logTurn, deleteConversationById } from "@/lib/conversationHistory";
import { recordEpisodes, deleteEpisodesForTurns, deleteEpisodesForPerson, listEpisodes } from "@/lib/episodes";
import { forget } from "@/lib/memory";
import { newPersonId } from "@/lib/id";
import { db, sqlite } from "@/db";
import { people, conversationTurns, episodes, pendingEpisodeEmbeddings } from "@/db/schema";
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
