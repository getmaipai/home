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

export interface EpisodeMatch {
  episode: Episode;
  pairedText: string;
  score: number;
}

export function recallEpisodes(
  actor: PersonRow,
  query: string,
  queryVector: number[],
  opts?: { limit?: number; excludeConversationId?: string; now?: string }
): EpisodeMatch[] {
  const limit = opts?.limit ?? 5;
  const now = opts?.now ?? new Date().toISOString();

  // Parse date from query using chrono-node
  const { chrono } = require("chrono-node");
  const parseResult = chrono.parse(query, new Date(now));
  let dateFilter: { start?: Date; end?: Date } | null = null;

  if (parseResult.length > 0) {
    const result = parseResult[0];
    if (result.start) {
      const startDate = result.start.date();
      if (result.end) {
        // Range: use as-is
        dateFilter = {
          start: startDate,
          end: result.end.date(),
        };
      } else {
        // Single date: parse relative like "last week"
        const text = result.text.toLowerCase();
        if (text.includes("last week")) {
          const weekAgo = new Date(startDate);
          weekAgo.setDate(weekAgo.getDate() - 7);
          dateFilter = { start: weekAgo, end: startDate };
        } else if (text.includes("this week")) {
          const weekStart = new Date(startDate);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          dateFilter = { start: weekStart, end: startDate };
        } else {
          // Single day
          dateFilter = {
            start: startDate,
            end: new Date(startDate.getTime() + 24 * 60 * 60 * 1000),
          };
        }
      }
    }
  }

  // Lexical: FTS5 BM25 ranking
  const lexicalRows = db
    .select({
      id: episodes.id,
      turnId: episodes.turnId,
      speaker: episodes.speaker,
      text: episodes.text,
      createdAt: episodes.createdAt,
      conversationId: episodes.conversationId,
    })
    .from(episodes)
    .where(eq(episodes.personId, actor.id))
    .all();

  // Filter lexical results by FTS5 (simple substring match as fallback)
  const queryTerms = query.toLowerCase().split(/\s+/);
  const lexicalMatches = lexicalRows.filter((ep) =>
    queryTerms.some((term) => ep.text.toLowerCase().includes(term))
  );

  // Vector: cosine similarity
  const vectorMatches = lexicalRows.map((ep) => {
    if (!ep.text) return { ...ep, score: 0 };
    // Placeholder: reuse cosineSimilarity from memory.ts if available
    // For now, approximate with a simple heuristic
    const commonWords = queryTerms.filter((term) => ep.text.toLowerCase().includes(term)).length;
    const score = commonWords / Math.max(queryTerms.length, 1);
    return { ...ep, score };
  });

  // Reciprocal rank fusion (k=60)
  const k = 60;
  const rrfScores = new Map<string, number>();

  lexicalMatches.forEach((ep, rank) => {
    const rrf = 1 / (k + rank + 1);
    rrfScores.set(ep.id, (rrfScores.get(ep.id) ?? 0) + rrf);
  });

  vectorMatches.forEach((ep, rank) => {
    const rrf = 1 / (k + rank + 1);
    rrfScores.set(ep.id, (rrfScores.get(ep.id) ?? 0) + rrf);
  });

  // Build final results
  const results: EpisodeMatch[] = [];
  const seenTurns = new Set<string>();
  const excludedTurns = opts?.excludeConversationId
    ? db
        .select({ id: episodes.turnId })
        .from(episodes)
        .where(eq(episodes.conversationId, opts.excludeConversationId))
        .limit(4)
        .all()
        .map((r) => r.id)
    : [];

  for (const [episodeId, score] of Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 2)) {
    const ep = lexicalRows.find((e) => e.id === episodeId);
    if (!ep || seenTurns.has(ep.turnId) || excludedTurns.includes(ep.turnId)) continue;

    // Date filter
    if (dateFilter) {
      const epDate = new Date(ep.createdAt);
      if (dateFilter.start && epDate < dateFilter.start) continue;
      if (dateFilter.end && epDate > dateFilter.end) continue;
    }

    // Find paired text from same turn
    const pairedEp = lexicalRows.find(
      (e) => e.turnId === ep.turnId && e.speaker !== ep.speaker
    );

    results.push({
      episode: {
        id: ep.id,
        turnId: ep.turnId,
        speaker: ep.speaker,
        text: ep.text,
        createdAt: ep.createdAt,
      },
      pairedText: pairedEp?.text ?? "",
      score,
    });

    seenTurns.add(ep.turnId);
    if (results.length >= limit) break;
  }

  return results;
}

export function formatEpisodesForPrompt(
  matches: EpisodeMatch[],
  displayName: string,
  locale: string,
  now?: string
): string {
  if (matches.length === 0) return "";

  const timestamp = now ?? new Date().toISOString();
  const lines = ["From earlier conversations (what was said, not necessarily true):"];

  for (const match of matches) {
    const date = new Date(match.episode.createdAt);
    const nowDate = new Date(timestamp);
    const daysAgo = Math.floor((nowDate.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
    const dateStr = date.toLocaleDateString(locale ?? "en-US", { month: "short", day: "numeric" });
    const daysLabel = daysAgo === 0 ? "today" : `${daysAgo} days ago`;

    const speaker =
      match.episode.speaker === "user" ? displayName : "you";
    const verb = match.episode.speaker === "user" ? "said" : "replied";

    // Truncate quote at 200 chars on word boundary
    let quote = match.episode.text;
    if (quote.length > 200) {
      quote = quote.substring(0, 200);
      const lastSpace = quote.lastIndexOf(" ");
      if (lastSpace > 150) quote = quote.substring(0, lastSpace);
      quote += "...";
    }

    lines.push(`- ${dateStr} (${daysLabel}), ${speaker} ${verb}: "${quote}"`);
  }

  // Cap at 600 characters total
  let block = lines.join("\n");
  if (block.length > 600) {
    // Trim from the end, preserving the header
    const header = lines[0];
    let truncated = block.substring(0, 600);
    const lastNewline = truncated.lastIndexOf("\n");
    if (lastNewline > header.length) {
      block = truncated.substring(0, lastNewline);
    }
  }

  return block;
}
