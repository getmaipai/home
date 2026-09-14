// Episodes: every turn verbatim as one or two searchable records (user and
// assistant sides), indexed by full-text and vector for hybrid recall
// ("what recipe did you suggest last week"). Mirrored after memory embeddings.
import { eq, and, inArray, notInArray, isNull, isNotNull, desc, gte, lt } from "drizzle-orm";
import { detectCredential } from "@/lib/memoryContentPolicy";
import { db, sqlite } from "@/db";
import { episodes, episodeEmbeddings, pendingEpisodeEmbeddings, conversationTurns } from "@/db/schema";
import { embed } from "@/lib/llm";
import { getEmbedClient } from "@/lib/embedSupervisor";
import { nextHlc } from "@/lib/hlc";
import { newEpisodeId } from "@/lib/id";
import { vectorToBuffer, bufferToVector, cosineSimilarity } from "@/lib/memory";
import { FORGET_COMMAND_ID } from "@/lib/forgetCommand";
import * as chrono from "chrono-node";
import type { ConversationTurnRow } from "@/wire";
import type { PersonRow } from "@/types";
import { asksWhatHubSaid, asksAboutEarlierTalk } from "@/lib/recallShapes";
import { isBareSocialTurn } from "@/lib/guards";
export { asksWhatHubSaid, asksAboutEarlierTalk };

/** getmaipai/home#78: whether a turn's reply text is something MaiPai
 * actually answered, read from the row's own fields, never from the
 * text. Only the model's own uncut reply (source "model" with no guard
 * reason) or a package's successful reply (source "plugin") qualify. A
 * guard's honest replacement line, a plugin or command error, a
 * confirm question and a household command's canned text are never
 * stored as "you replied", so a later conversation cannot recall "Sorry,
 * I couldn't do that." as a position MaiPai once took. The person's own
 * side is still recorded for every non-refused turn. */
export function replyIsAnAnswer(turn: Pick<ConversationTurnRow, "source" | "guardReason">): boolean {
  if (turn.source === "plugin") return true;
  return turn.source === "model" && !turn.guardReason;
}

/** Record both sides of a turn as episodes and queue for embedding.
 * Skips a safety_refuse turn entirely, skips empty sides, and skips the
 * assistant side unless replyIsAnAnswer(). */
export function recordEpisodes(turn: ConversationTurnRow): void {
  if (turn.source === "safety_refuse") return;
  // Item 4b: the forget request names the topic it asked to forget
  // ("...about Marlow's birthday"); an episode of it would keep that
  // wording recallable after the remembered turn's episodes are gone.
  if (turn.commandId === FORGET_COMMAND_ID) return;

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

  if (turn.replyText && turn.replyText.trim() && replyIsAnAnswer(turn)) {
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
  /** #88: the explicit history view (the conversations search) keeps a
   * replaced turn findable; a prompt never sees one. Default false. */
  includeSuperseded?: boolean;
  /** JOIN-01: exclude every turn of `excludeConversationId`, not only the
   * newest four. The prompt block is headed "From earlier conversations",
   * and buildConversationWindow() keeps up to its token budget of older
   * turns of the current one verbatim, so a turn from this conversation
   * recalled here would be both a duplicate and mislabelled (a code
   * review on JOIN-01). */
  excludeWholeConversation?: boolean;
  now?: Date;
  /** RECALL-02: which side of a turn may be recalled. The prompt
   * (prepareTurn) asks for the person's own side unless the utterance
   * asks what the hub said (asksWhatHubSaid()): the hub's prose is
   * output, not evidence, and a recalled first-person sentence was
   * being copied into new replies; when it does enter, it is rendered
   * as a reported note beside its paired user side, never as a line.
   * The conversations search reads both sides, the default. */
  sides?: "user" | "both";
  /** RECALL-02, the prompt's "what did you say" turn: a turn found by
   * the person's words ("what did you suggest for the six visitors"
   * shares nothing with the recipe itself) is shown from the hub's
   * side (the reported note carries the person's paired words). Never
   * the conversations search's, which returns the side that matched,
   * verbatim. */
  preferHubSide?: boolean;
}

/** RECALL-02: a turn about this conversation itself, whose evidence is
 * the window already in the messages: recalls no episodes. */
const ABOUT_THIS_CONVERSATION_RE = /\bwhat\s+(?:were|are)\s+we\s+(?:talking|discussing|saying)\b|\bwhat\s+(?:did|do)\s+you\s+mean\b|\bsay\s+that\s+again\b|\bcome\s+again\b|\bwhat\s+was\s+(?:i|that)\s+(?:saying|talking about)\b|\bwhere\s+were\s+we\b|\bwhat\s+were\s+you\s+saying\b/i;
/** Two, by the coordinator's decision on the first measurement (the
 * design said three): the lexical floor already demands both words of
 * a two-word query, so a two-word question that clears it is a real
 * match, and "when is my dentist appointment" is exactly the recall
 * question the block exists for. */
const MIN_CONTENT_WORDS = 2;

/** RECALL-02: whether an utterance earns an episode lookup at all. Fewer
 * than two content words (after stopwords) is a query with almost no
 * content, whose nearest episode is noise; a question about this
 * conversation is answered by the window. Until CHAT-13's resolved
 * subject becomes the query, this is the gate. */
export function episodeQueryEligible(utterance: string): boolean {
  if (ABOUT_THIS_CONVERSATION_RE.test(utterance)) return false;
  // A bare greeting or acknowledgment has two content words ("good
  // morning", "sounds good") and an earlier one every day: the lexical
  // floor would admit last week's greeting, so it recalls nothing.
  if (isBareSocialTurn(utterance)) return false;
  return contentTerms(utterance).length >= MIN_CONTENT_WORDS;
}

/** The content terms the lexical half searches for: the FTS tokenizer's
 * own split, stopwords out, deduplicated. */
export function contentTerms(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).flatMap((t) => t.split("'")))].filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const RRF_K = 60;
/** getmaipai/home#79: how many of a person's newest embedded episodes the
 * vector half reads and scores per turn (or, for a dated question, up to
 * this many inside its window). 2,000 is about a thousand turns, or a
 * few months of daily use, kept in the hot path; at ten thousand stored
 * episodes the scan still reads 2,000 rows (about 6 MB of
 * 768-dimensional float32 blobs at 3,072 bytes each, decoded and dotted
 * in JavaScript), where an unbounded scan would read all ten thousand
 * (about 30 MB). Older episodes stay reachable through the lexical half
 * (BM25 over the whole index) and through a dated question ("three
 * weeks ago"), which reads its own window instead. */
export const VECTOR_SCAN_RECENT_EPISODES = 2000;

let __vectorRowsScanned = 0;
/** Test seam: how many episode vectors recallEpisodes() has read since
 * the last reset, so a test can prove the bound. */
export function __vectorRowsScannedForTests(): number {
  return __vectorRowsScanned;
}
export function __resetVectorRowsScannedForTests(): void {
  __vectorRowsScanned = 0;
}
/** Below it a vector match is noise, and a query about something never
 * said must come back empty rather than with the nearest unrelated
 * turn. RECALL-02 measured it on the recall-floor bench's episode rows
 * (docs/dev/session-a.md): with memory.ts's episodic-record floor of
 * 0.55, a sentence sharing one word with an earlier exchange ("a Tempo
 * treadmill for the office" against "listening to Tempo all morning")
 * sat at 0.59 to 0.68 and every one leaked; the exchanges a question
 * was really about sat at 0.79 and up. 0.72 is between them. */
export const EPISODE_MIN_COSINE = 0.72;
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
  const terms = contentTerms(query);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(" OR ");
}

/** RECALL-02, the lexical floor: a lexical candidate needs two content
 * words in common with the query, or one and a vector cosine at or
 * above EPISODE_MIN_COSINE. Before it, one shared word (an adjective, a
 * genre word, a band's name inside a product's name) admitted an
 * episode from any conversation and rank fusion then ranked it as if it
 * were relevant. Measured on scripts/bench/recall-floor.ts's episode
 * rows (docs/dev/session-a.md, RECALL-02). */
export const LEXICAL_MIN_SHARED_TERMS = 2;
export function sharedContentTerms(queryTerms: readonly string[], text: string): number {
  const have = new Set(contentTerms(text));
  return queryTerms.filter((t) => have.has(t)).length;
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
/** #88: the turns off the current branch, as a subquery for both halves. */
function supersededTurnIdsQuery() {
  return db.select({ id: conversationTurns.supersedes }).from(conversationTurns).where(isNotNull(conversationTurns.supersedes));
}

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
          .limit(opts.excludeWholeConversation ? Number.MAX_SAFE_INTEGER : WINDOW_TURNS_EXCLUDED)
          .all()
          .map((r) => r.id)
      : [],
  );

  // Lexical: BM25 over the person's own rows (bm25() is lower-is-better).
  // The date window and the excluded turns are part of the SQL, so a
  // word the household has said hundreds of times still finds its dated
  // mention instead of losing it below a candidate cap.
  // #88: a turn that another turn in its conversation names in
  // `supersedes` (an edited-and-resent message) is off the current
  // branch; its episodes stay stored and are never recalled. Read at
  // query time, so an edit after the episode was recorded takes effect
  // on the next recall with nothing rewritten.
  const sides = opts.sides ?? "both";
  const queryTerms = contentTerms(query);
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
           ${opts.includeSuperseded ? "" : "AND e.turn_id NOT IN (SELECT supersedes FROM conversation_turns WHERE supersedes IS NOT NULL)"}
           ${excluded.length ? `AND e.turn_id NOT IN (${placeholders})` : ""}
           ${sides === "user" ? "AND e.speaker = 'user'" : ""}
         ORDER BY bm25(episodes_fts) LIMIT ?`,
      )
      .all(fts, actor.id, window?.start.toISOString() ?? null, window?.start.toISOString() ?? null, window?.end.toISOString() ?? null, window?.end.toISOString() ?? null, ...excluded, CANDIDATES_PER_SOURCE) as CandidateRow[];
    lexical.push(...rows);
  }

  // Vector: brute-force cosine over the person's embedded episodes, the
  // same scan memory.ts's similarByVector() does for memory records,
  // but bounded (getmaipai/home#79): episodes grow two rows per turn for
  // ever, so the scan reads the newest VECTOR_SCAN_RECENT_EPISODES rows,
  // or, when the question named a date, up to the same number inside
  // that window instead (every row outside the window is dropped anyway,
  // so reading the recent set too would be waste, a code review's
  // finding), and scores only those. The FTS half is bounded by SQL
  // already.
  const vector: CandidateRow[] = [];
  if (queryVector) {
    const columns = {
      id: episodes.id,
      turnId: episodes.turnId,
      conversationId: episodes.conversationId,
      speaker: episodes.speaker,
      text: episodes.text,
      createdAt: episodes.createdAt,
      vector: episodeEmbeddings.vector,
    };
    const scope = window
      ? and(eq(episodes.personId, actor.id), gte(episodes.createdAt, window.start.toISOString()), lt(episodes.createdAt, window.end.toISOString()))
      : eq(episodes.personId, actor.id);
    const rows = db
      .select(columns)
      .from(episodeEmbeddings)
      .innerJoin(episodes, eq(episodeEmbeddings.episodeId, episodes.id))
      .where(opts.includeSuperseded ? scope : and(scope, notInArray(episodes.turnId, supersededTurnIdsQuery())))
      .orderBy(desc(episodes.createdAt))
      .limit(VECTOR_SCAN_RECENT_EPISODES)
      .all();
    __vectorRowsScanned += rows.length;
    const scored = rows
      .filter((r) => inWindow(r, window) && !excludedTurnIds.has(r.turnId) && (sides === "both" || r.speaker === "user"))
      .map((r) => ({ row: r as CandidateRow & { vector: Buffer }, cosine: cosineSimilarity(queryVector, bufferToVector(r.vector as Buffer)) }))
      .filter((s) => s.cosine >= EPISODE_MIN_COSINE)
      .sort((a, b) => b.cosine - a.cosine)
      .slice(0, CANDIDATES_PER_SOURCE);
    vector.push(...scored.map((s) => s.row));
  }

  // RECALL-02: each half clears its own floor before fusion, so a
  // candidate that survives only one half is never ranked as if both
  // agreed. The vector half's floor is the cosine above; the lexical
  // half's is two shared content words, or one when the vector half
  // also admitted the row.
  // A one-word query (the conversations search's own lookup; the
  // prompt never sends fewer than two content words) can share at
  // most one, and does. The turn is the unit: the shared words are
  // counted over the candidate side and its paired side together, since
  // "did we decide on the trip" / "the coast in October" is one exchange
  // about the trip to the coast.
  const needed = Math.min(LEXICAL_MIN_SHARED_TERMS, queryTerms.length);
  const vectorIds = new Set(vector.map((r) => r.id));
  const lexicalPairs = lexical.length
    ? db
        .select({ turnId: episodes.turnId, speaker: episodes.speaker, text: episodes.text })
        .from(episodes)
        .where(inArray(episodes.turnId, [...new Set(lexical.map((r) => r.turnId))]))
        .all()
    : [];
  const lexicalSurvivors = lexical.filter((r) => {
    const paired = lexicalPairs.find((p) => p.turnId === r.turnId && p.speaker !== r.speaker)?.text ?? "";
    const shared = sharedContentTerms(queryTerms, `${r.text} ${paired}`);
    return shared >= needed || (shared >= 1 && vectorIds.has(r.id));
  });

  // Reciprocal rank fusion, then one match per turn (its best side).
  const fused = new Map<string, { row: CandidateRow; score: number }>();
  const add = (list: CandidateRow[]) =>
    list.forEach((row, rank) => {
      const prev = fused.get(row.id);
      const score = (prev?.score ?? 0) + 1 / (RRF_K + rank + 1);
      fused.set(row.id, { row, score });
    });
  add(lexicalSurvivors);
  add(vector);

  const byTurn = new Map<string, { row: CandidateRow; score: number }>();
  for (const entry of [...fused.values()].sort((a, b) => b.score - a.score)) {
    const held = byTurn.get(entry.row.turnId);
    if (!held || held.score < entry.score) byTurn.set(entry.row.turnId, entry);
  }
  // CHAT-03, the read side: an episode carrying a credential (recorded
  // before the policy existed; a new one is recorded redacted) is never
  // recalled into a prompt, and never deleted here. RECALL-02: the
  // paired side reaches the prompt too (quoted beside the hub's note,
  // or shown in its place), so the whole turn is checked.
  const ranked = [...byTurn.values()].sort((a, b) => b.score - a.score);
  const pairs = ranked.length
    ? db
        .select({ id: episodes.id, turnId: episodes.turnId, speaker: episodes.speaker, text: episodes.text })
        .from(episodes)
        .where(inArray(episodes.turnId, [...new Set(ranked.map((t) => t.row.turnId))]))
        .all()
    : [];
  const top = ranked.filter((e) => !pairs.some((p) => p.turnId === e.row.turnId && detectCredential(p.text).detected)).slice(0, limit);
  if (top.length === 0) return [];
  return top.map(({ row, score }) => {
    // RECALL-02: when both sides are wanted, the question asked what the
    // hub said, and the turn was usually found by the person's words
    // ("what did you suggest for the visitors" shares nothing with the
    // recipe itself); the hub's side of that turn is the answer, its
    // note carrying the person's paired words.
    const hubSide = opts.preferHubSide && sides === "both" && row.speaker === "user" ? pairs.find((p) => p.turnId === row.turnId && p.speaker === "assistant") : undefined;
    const shown = hubSide ? { ...row, id: hubSide.id, speaker: "assistant" as const, text: hubSide.text } : row;
    return {
      episode: { id: shown.id, turnId: shown.turnId, conversationId: shown.conversationId, speaker: shown.speaker, text: shown.text, createdAt: shown.createdAt },
      pairedText: pairs.find((p) => p.turnId === shown.turnId && p.speaker !== shown.speaker)?.text ?? "",
      score,
    };
  });
}

/** RECALL-02: three lines and 400 characters (from five and 600): fewer
 * lines, each earned. */
export const PROMPT_BLOCK_MAX_LINES = 3;
const PROMPT_BLOCK_MAX_CHARS = 400;
const QUOTE_MAX_CHARS = 200;
const NOTE_TERMS_MAX = 12;
export const EPISODES_HEADER = "From earlier conversations (what was said, not necessarily true):";

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
  const lines = [EPISODES_HEADER];
  for (const m of matches) {
    if (lines.length > PROMPT_BLOCK_MAX_LINES) break;
    const line = formatEpisodeLine(m, displayName, locale, now);
    if ([...lines, line].join("\n").length > PROMPT_BLOCK_MAX_CHARS) break;
    lines.push(line);
  }
  return lines.length === 1 ? "" : lines.join("\n");
}

/** One episode's own line, as the block above renders it (CHAT-01: the
 * turn context records this exact text per episode so inclusion in the
 * prompt can be checked, and the guard grounds on the quoted text as
 * shown, cut where the prompt cut it). */
export function formatEpisodeLine(m: EpisodeMatch, displayName: string, locale: string, now: Date = new Date()): string {
  const dateFmt = shortDateFormat(locale || "en-US");
  const when = new Date(m.episode.createdAt);
  const days = Math.max(0, Math.floor((now.getTime() - when.getTime()) / DAY_MS));
  const ago = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  if (m.episode.speaker === "user") return `- ${dateFmt.format(when)} (${ago}), ${displayName} said: "${episodeQuote(m)}"`;
  // RECALL-02: the hub's own side is reported, never quoted: the
  // person's paired words in quotes (what caused the answer), and the
  // answer as the words it covered, not a sentence in the hub's voice
  // that a short turn would copy back.
  const asked = m.pairedText ? `when ${displayName} said "${cutAtWord(m.pairedText, QUOTE_MAX_CHARS / 2)}", ` : "";
  return `- ${dateFmt.format(when)} (${ago}), ${asked}your answer covered: ${answerTerms(m.episode.text)}`;
}

/** The words an answer covered, in their order, stopwords out, capped:
 * evidence of what was said, not a line to say again. */
export function answerTerms(text: string): string {
  const terms = contentTerms(text).slice(0, NOTE_TERMS_MAX);
  return terms.length > 0 ? terms.join(", ") : "(nothing of substance)";
}

// One formatter per locale (a code review: this ran per episode and now
// runs twice per episode, once for the block and once for the turn
// context's evidence; turnEngine.ts caches its own for the same reason).
const shortDateFormats = new Map<string, Intl.DateTimeFormat>();
function shortDateFormat(locale: string): Intl.DateTimeFormat {
  let fmt = shortDateFormats.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    shortDateFormats.set(locale, fmt);
  }
  return fmt;
}

/** The text the prompt shows for an episode, the guard's evidence: the
 * person's side quoted as cut; the hub's side as the paired words and
 * the answer's terms (RECALL-02), the same content the line carries. */
export function episodeQuote(m: EpisodeMatch): string {
  if (m.episode.speaker === "user") return cutAtWord(m.episode.text, QUOTE_MAX_CHARS);
  return `${m.pairedText ? cutAtWord(m.pairedText, QUOTE_MAX_CHARS / 2) + " " : ""}${answerTerms(m.episode.text)}`;
}
