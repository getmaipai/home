// Episodes: every turn verbatim as one or two searchable records (user and
// assistant sides), indexed by full-text and vector for hybrid recall
// ("what recipe did you suggest last week"). Mirrored after memory embeddings.
import { eq, and, inArray, isNull, desc } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { episodes, episodeEmbeddings, pendingEpisodeEmbeddings, conversationTurns } from "@/db/schema";
import { embed } from "@/lib/llm";
import { getEmbedClient } from "@/lib/embedSupervisor";
import { nextHlc } from "@/lib/hlc";
import { newEpisodeId } from "@/lib/id";
import { vectorToBuffer, bufferToVector, cosineSimilarity } from "@/lib/memory";
import * as chrono from "chrono-node";
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
  conversationId: string | null;
  speaker: "user" | "assistant";
  text: string;
  createdAt: string;
}

export function listEpisodes(actor: PersonRow, opts?: { limit?: number }): Episode[] {
  return db
    .select({
      id: episodes.id,
      turnId: episodes.turnId,
      conversationId: episodes.conversationId,
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
  /** The other side of the same turn (the reply to what they said, or
   * what they said before the reply), so a match is never a lone half. */
  pairedText: string;
  score: number;
}

export interface RecallEpisodesOptions {
  limit?: number;
  /** The conversation currently in progress: its newest four turns are
   * already in the model's window, so they are never recalled here too. */
  excludeConversationId?: string;
  now?: Date;
}

const RRF_K = 60;
/** The same floor memory.ts's recall() applies to episodic records: below
 * it a vector match is noise, and a query about something never said
 * must come back empty rather than with the nearest unrelated turn. */
const EPISODE_MIN_COSINE = 0.55;
const CANDIDATES_PER_SOURCE = 20;
const WINDOW_TURNS_EXCLUDED = 4;
const DAY_MS = 86_400_000;
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "about", "did", "do", "does", "you", "your",
  "i", "me", "my", "we", "our", "us", "it", "is", "was", "were", "be", "been", "what", "which", "who", "when", "where", "how",
  "that", "this", "these", "those", "there", "here", "last", "next", "week", "month", "year", "yesterday", "today", "ago",
  "again", "tell", "say", "said", "suggest", "suggested", "decide", "decided", "talk", "talked", "remember", "recall",
]);

interface DateWindow {
  start: Date;
  end: Date;
}

/** "last week", "yesterday", "on Monday", "in June" become a created_at
 * window through chrono-node, never a model. The library returns one
 * moment for most phrases, so the window is widened by what the phrase
 * named: a week phrase covers that whole week (Sunday to Sunday), a
 * month phrase that whole month, anything else that whole day. A weekday
 * chrono resolved into the future is read as the most recent one, since
 * a recall question is always about the past. */
export function dateWindowForQuery(query: string, now: Date): DateWindow | null {
  const parsed = chrono.parse(query, now);
  // Only a hit that names a day, a weekday, or a month is a date. A bare
  // clock time ("at 5pm"), a duration ("for 2 hours"), or a short word
  // chrono reads as a weekday ("the sun") must not narrow recall.
  const hit = parsed.find((h) => h.text.trim().length >= 4 && (h.start.isCertain("day") || h.start.isCertain("weekday") || h.start.isCertain("month")));
  if (!hit) return null;
  const text = hit.text.toLowerCase();
  let start = hit.start.date();
  if (hit.end) return { start, end: hit.end.date() };
  if (/\bweek/.test(text)) {
    const weekStart = new Date(start);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return { start: weekStart, end: new Date(weekStart.getTime() + 7 * DAY_MS) };
  }
  if (/\bmonth/.test(text) || (!hit.start.isCertain("day") && hit.start.isCertain("month"))) {
    let year = start.getFullYear();
    // A recall question is about the past: "in March" said in September
    // means last March, never next March.
    if (new Date(year, start.getMonth(), 1).getTime() > now.getTime()) year -= 1;
    return { start: new Date(year, start.getMonth(), 1), end: new Date(year, start.getMonth() + 1, 1) };
  }
  if (start.getTime() > now.getTime() && hit.start.isCertain("weekday") && !hit.start.isCertain("day")) start = new Date(start.getTime() - 7 * DAY_MS);
  if (start.getTime() > now.getTime()) return null; // a future date cannot narrow a recall of the past
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  return { start: dayStart, end: new Date(dayStart.getTime() + DAY_MS) };
}

/** The FTS5 query for a person's words: each content term quoted (so
 * punctuation and FTS operators in what they typed can never change the
 * query's meaning), joined with OR, stopwords dropped. Null when nothing
 * is left to search for. */
export function ftsQueryFor(query: string): string | null {
  // Split on apostrophes rather than deleting them: the index's default
  // unicode61 tokenizer splits "Rover's" into "rover" and "s", so the
  // query must too or a possessive never matches its own subject.
  const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).flatMap((t) => t.split("'")))]
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(" OR ");
}

interface CandidateRow {
  id: string;
  turnId: string;
  conversationId: string | null;
  speaker: "user" | "assistant";
  text: string;
  createdAt: string;
}

function inWindow(row: { createdAt: string }, window: DateWindow | null): boolean {
  if (!window) return true;
  const t = new Date(row.createdAt).getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}

/** Hybrid recall over a person's own episodes: BM25 over the FTS5 index
 * and cosine over the stored embeddings, fused by reciprocal rank, with a
 * date window from the query and the current conversation's newest turns
 * excluded. `queryVector` is the turn's own utterance vector (the caller
 * already has it; this never embeds), or undefined when the embed engine
 * is down, in which case lexical recall alone answers. Synchronous, like
 * memory.ts's recall(). */
export function recallEpisodes(actor: PersonRow, query: string, queryVector: Float32Array | undefined, opts: RecallEpisodesOptions = {}): EpisodeMatch[] {
  const limit = opts.limit ?? 5;
  const now = opts.now ?? new Date();
  const window = dateWindowForQuery(query, now);

  const excludedTurnIds = new Set<string>(
    opts.excludeConversationId
      ? db
          .select({ id: conversationTurns.id })
          .from(conversationTurns)
          .where(eq(conversationTurns.conversationId, opts.excludeConversationId))
          .orderBy(desc(conversationTurns.createdAt))
          .limit(WINDOW_TURNS_EXCLUDED)
          .all()
          .map((r) => r.id)
      : [],
  );

  // Lexical: BM25 over the person's own rows (bm25() is lower-is-better).
  // The date window and the excluded turns are part of the SQL, so a
  // word the household has said hundreds of times still finds its dated
  // mention instead of losing it below a candidate cap.
  const lexical: CandidateRow[] = [];
  const fts = ftsQueryFor(query);
  if (fts) {
    const excluded = [...excludedTurnIds];
    const placeholders = excluded.map(() => "?").join(",");
    const rows = sqlite
      .query(
        `SELECT e.id, e.turn_id AS turnId, e.conversation_id AS conversationId, e.speaker, e.text, e.created_at AS createdAt
         FROM episodes_fts f JOIN episodes e ON e.rowid = f.rowid
         WHERE episodes_fts MATCH ? AND e.person_id = ?
           AND (? IS NULL OR e.created_at >= ?) AND (? IS NULL OR e.created_at < ?)
           ${excluded.length ? `AND e.turn_id NOT IN (${placeholders})` : ""}
         ORDER BY bm25(episodes_fts) LIMIT ?`,
      )
      .all(fts, actor.id, window?.start.toISOString() ?? null, window?.start.toISOString() ?? null, window?.end.toISOString() ?? null, window?.end.toISOString() ?? null, ...excluded, CANDIDATES_PER_SOURCE) as CandidateRow[];
    lexical.push(...rows);
  }

  // Vector: brute-force cosine over the person's embedded episodes, the
  // same scan memory.ts's similarByVector() does for memory records.
  const vector: CandidateRow[] = [];
  if (queryVector) {
    const rows = db
      .select({
        id: episodes.id,
        turnId: episodes.turnId,
        conversationId: episodes.conversationId,
        speaker: episodes.speaker,
        text: episodes.text,
        createdAt: episodes.createdAt,
        vector: episodeEmbeddings.vector,
      })
      .from(episodeEmbeddings)
      .innerJoin(episodes, eq(episodeEmbeddings.episodeId, episodes.id))
      .where(eq(episodes.personId, actor.id))
      .all();
    const scored = rows
      .filter((r) => inWindow(r, window) && !excludedTurnIds.has(r.turnId))
      .map((r) => ({ row: r as CandidateRow & { vector: Buffer }, cosine: cosineSimilarity(queryVector, bufferToVector(r.vector as Buffer)) }))
      .filter((s) => s.cosine >= EPISODE_MIN_COSINE)
      .sort((a, b) => b.cosine - a.cosine)
      .slice(0, CANDIDATES_PER_SOURCE);
    vector.push(...scored.map((s) => s.row));
  }

  // Reciprocal rank fusion, then one match per turn (its best side).
  const fused = new Map<string, { row: CandidateRow; score: number }>();
  const add = (list: CandidateRow[]) =>
    list.forEach((row, rank) => {
      const prev = fused.get(row.id);
      const score = (prev?.score ?? 0) + 1 / (RRF_K + rank + 1);
      fused.set(row.id, { row, score });
    });
  add(lexical);
  add(vector);

  const byTurn = new Map<string, { row: CandidateRow; score: number }>();
  for (const entry of [...fused.values()].sort((a, b) => b.score - a.score)) {
    const held = byTurn.get(entry.row.turnId);
    if (!held || held.score < entry.score) byTurn.set(entry.row.turnId, entry);
  }
  const top = [...byTurn.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  if (top.length === 0) return [];

  const pairs = db
    .select({ turnId: episodes.turnId, speaker: episodes.speaker, text: episodes.text })
    .from(episodes)
    .where(inArray(episodes.turnId, top.map((t) => t.row.turnId)))
    .all();
  return top.map(({ row, score }) => ({
    episode: { id: row.id, turnId: row.turnId, conversationId: row.conversationId, speaker: row.speaker, text: row.text, createdAt: row.createdAt },
    pairedText: pairs.find((p) => p.turnId === row.turnId && p.speaker !== row.speaker)?.text ?? "",
    score,
  }));
}

const PROMPT_BLOCK_MAX_CHARS = 600;
const QUOTE_MAX_CHARS = 200;
const EPISODES_HEADER = "From earlier conversations (what was said, not necessarily true):";

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}...`;
}

/** The block the turn engine appends after the memory bullets (JOIN-01):
 * one line per match, dated, labeled by who said it, quotes cut at a word
 * boundary, the whole block capped. Empty string for no matches. */
export function formatEpisodesForPrompt(matches: EpisodeMatch[], displayName: string, locale: string, now: Date = new Date()): string {
  if (matches.length === 0) return "";
  const dateFmt = new Intl.DateTimeFormat(locale || "en-US", { month: "short", day: "numeric" });
  const lines = [EPISODES_HEADER];
  for (const m of matches) {
    const when = new Date(m.episode.createdAt);
    const days = Math.max(0, Math.floor((now.getTime() - when.getTime()) / DAY_MS));
    const ago = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
    const who = m.episode.speaker === "user" ? `${displayName} said` : "you replied";
    const line = `- ${dateFmt.format(when)} (${ago}), ${who}: "${cutAtWord(m.episode.text, QUOTE_MAX_CHARS)}"`;
    if ([...lines, line].join("\n").length > PROMPT_BLOCK_MAX_CHARS) break;
    lines.push(line);
  }
  return lines.length === 1 ? "" : lines.join("\n");
}
