// Episodes: every turn verbatim as one or two searchable records (user and
// assistant sides), indexed by full-text and vector for hybrid recall
// ("what recipe did you suggest last week"). Mirrored after memory embeddings.
import { eq, and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, episodeEmbeddings, pendingEpisodeEmbeddings, conversationTurns } from "@/db/schema";
import { embed } from "@/lib/llm";
import { getEmbedClient } from "@/lib/embedSupervisor";
import { nextHlc } from "@/lib/hlc";
import { newEpisodeId } from "@/lib/id";
import { vectorToBuffer } from "@/lib/memory";
import type { ConversationTurnRow } from "@/wire";
import type { PersonRow } from "@/types";

/** Record both sides of a turn as episodes and queue for embedding.
 * Skips a safety_refuse turn entirely and skips empty sides. */
export function recordEpisodes(turn: ConversationTurnRow): void {
  if (turn.source === "safety_refuse") return;

  const now = new Date().toISOString();
  const hlc = nextHlc();
  const rows: (typeof episodes.$inferInsert)[] = [];

  if (turn.userText && turn.userText.trim()) {
    rows.push({
      id: newEpisodeId(),
      turnId: turn.id,
      conversationId: turn.conversationId,
      personId: turn.personId,
      speaker: "user",
      text: turn.userText,
      createdAt: turn.createdAt,
      hlc,
    });
  }

  if (turn.replyText && turn.replyText.trim()) {
    rows.push({
      id: newEpisodeId(),
      turnId: turn.id,
      conversationId: turn.conversationId,
      personId: turn.personId,
      speaker: "assistant",
      text: turn.replyText,
      createdAt: turn.createdAt,
      hlc,
    });
  }

  if (rows.length === 0) return;

  db.insert(episodes).values(rows).run();

  db.insert(pendingEpisodeEmbeddings)
    .values(rows.map((r) => ({ episodeId: r.id, queuedAt: now })))
    .run();
}

/** Embeds up to 32 queued episodes and removes them from the queue. */
export async function embedPendingEpisodes(): Promise<number> {
  const pending = db
    .select()
    .from(pendingEpisodeEmbeddings)
    .innerJoin(episodes, eq(pendingEpisodeEmbeddings.episodeId, episodes.id))
    .limit(32)
    .all();

  if (pending.length === 0) return 0;

  const texts = pending.map((p) => p.episodes.text);
  const result = await embed(texts);
  if (!result.ok) return 0;

  const rows = pending.map((p, i) => {
    const vector = result.value.vectors[i]!;
    return {
      episodeId: p.episodes.id,
      space: "default",
      dims: vector.length,
      vector: vectorToBuffer(vector),
      hlc: nextHlc(),
    };
  });

  db.insert(episodeEmbeddings).values(rows).run();
  db.delete(pendingEpisodeEmbeddings)
    .where(
      inArray(
        pendingEpisodeEmbeddings.episodeId,
        pending.map((p) => p.episodes.id)
      )
    )
    .run();

  return pending.length;
}

export function deleteEpisodesForTurns(turnIds: string[]): void {
  if (turnIds.length === 0) return;
  const episodeIds = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(inArray(episodes.turnId, turnIds))
    .all()
    .map((e) => e.id);

  if (episodeIds.length === 0) return;

  db.delete(pendingEpisodeEmbeddings).where(inArray(pendingEpisodeEmbeddings.episodeId, episodeIds)).run();
  db.delete(episodeEmbeddings).where(inArray(episodeEmbeddings.episodeId, episodeIds)).run();
  db.delete(episodes).where(inArray(episodes.id, episodeIds)).run();
}

export function deleteEpisodesForPerson(personId: string): void {
  const episodesToDelete = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.personId, personId))
    .all();

  if (episodesToDelete.length === 0) return;

  const ids = episodesToDelete.map((e) => e.id);
  db.delete(pendingEpisodeEmbeddings).where(inArray(pendingEpisodeEmbeddings.episodeId, ids)).run();
  db.delete(episodeEmbeddings).where(inArray(episodeEmbeddings.episodeId, ids)).run();
  db.delete(episodes).where(inArray(episodes.id, ids)).run();
}

export interface Episode {
  id: string;
  turnId: string;
  speaker: "user" | "assistant";
  text: string;
  createdAt: string;
}

export function listEpisodes(actor: PersonRow, opts?: { limit?: number }): Episode[] {
  return db
    .select({
      id: episodes.id,
      turnId: episodes.turnId,
      speaker: episodes.speaker,
      text: episodes.text,
      createdAt: episodes.createdAt,
    })
    .from(episodes)
    .where(eq(episodes.personId, actor.id))
    .limit(opts?.limit ?? 100)
    .all() as Episode[];
}
