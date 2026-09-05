// Conversation history (platform plan 4.14, split): "conversations are
// per person and per surface... retention defaults: conversations ninety
// days then summarised... each is a household setting with a floor for
// kid safety logs." This is the store: every real turnEngine.runTurn()
// path (safety refusals included) writes one row, kept per person,
// visible per the exact rule memory.ts and settings.ts already share
// (lib/access.ts's canAccessPerson, whose own comment names this file's
// rule as the reason it was extracted, before this file existed).
//
// Full 4.14 is bigger than this: household search across content types
// (needs the shell palette, chapter 6, and content types like notes/media
// that don't exist), an audit of who viewed what, and full robot parity
// (needs the link, 7.3, and `bot` to exist as real content) are all out
// of scope, most documented at the point they matter below.
//
// The conversation THREAD is a real spec-shaped record as of step 3
// (spec/schemas/conversation.schema.json, with a real hlc, specifically
// because it's meant to sync); the individual TURNS
// (conversation_turns, ConversationTurnRow below) remain hub-internal,
// the same "revisit for robot parity later" call lib/scheduler.ts's Job
// made - a robot's own conversation records sync, its raw utterance log
// never does (4.14).
//
// 90-day summarization instead of a hard delete (2026-09-04) is real
// now: runRetention() best-effort summarizes each person's about-to-
// expire turns into one real `record_kind: "episode"` memory record
// (3.1's shape has always had this kind; nothing had ever created one
// until now) via the `chat` role, before deleting the raw turns. Never
// gates the actual deletion on it succeeding - a household's retention
// promise ("gone after N days") is the hard guarantee; a summary is a
// best-effort upgrade on top of it, not a precondition. See
// summarizeBeforeDelete()'s own comment for exactly what that means
// when no real model is running yet.
import { eq, and, or, not, lt, gt, isNull, inArray, desc } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { conversationTurns, conversations, people, memoryRecords } from "@/db/schema";
import { newConversationTurnId, newConversationId } from "@/lib/id";
import { canAccessPerson } from "@/lib/access";
import { isMinorRole } from "@/lib/safety";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { complete, type LlmMessage } from "@/lib/llm";
import { getEngineStatus } from "@/lib/llmSupervisor";
import { remember } from "@/lib/memory";
import { nextHlc } from "@/lib/hlc";
import { Conversation } from "@maipai/spec/gen/ts/conversation.js";
import type { Role } from "@/middleware/auth";
import type { TurnValue, Surface } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";
import type { ConversationRow, ConversationSummary, ConversationTurnWithMemoryIds } from "@/wire";
export type { ConversationSummary, ConversationTurnWithMemoryIds } from "@/wire";
export type { Conversation } from "@maipai/spec/gen/ts/conversation.js";

// Defined in @/wire (alias-free, typeof conversationTurns.$inferSelect
// via a relative import) so a frontend client can import the real row
// shape through the @maipai/home-backend workspace dependency; re-exported
// here since this is where callers already look for it.
import type { ConversationTurnRow } from "@/wire";
export type { ConversationTurnRow } from "@/wire";

export type ConversationOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string };

/** Writes one row for a completed turn, any source, refusals included: a
 * parent reviewing a child's history should be able to see that a request
 * was made and refused, the same oversight motive `notify_parent` serves.
 * Called once per real runTurn() call; never for a TurnOpResult that
 * failed before producing a reply (unsupported_surface, invalid_input,
 * the model being unavailable) since nothing was actually said.
 *
 * `value.turn_id`/`value.conversation_id` (step 3): turnEngine.ts's
 * prepareTurn() resolves the conversation and mints this turn's own id
 * up front now, before the reply is generated (step 2's provenance
 * carrier too), so this row uses those exact ids rather than minting a
 * second, different turn id - the two would otherwise silently diverge,
 * breaking "provenance equals the turn id". Also bumps the conversation's
 * own `updated_at` so `listConversations()`'s "newest first" ordering
 * reflects real activity, not just creation time. */
// Both writes commit together or not at all - lib/secret.ts's
// recordFailedAttempt() and lib/memoryId.ts's nextSeq already use this
// same bun:sqlite transaction() wrapper (a code review, 2026-09-05,
// found this function's own insert-then-update pair had no such
// protection: a crash between the two would log a turn whose parent
// conversation's own updated_at/hlc never advanced, silently going
// stale in listConversations()'s "newest first" ordering).
const insertTurnAndBumpConversation = sqlite.transaction((row: ConversationTurnRow, conversationId: string) => {
  db.insert(conversationTurns).values(row).run();
  db.update(conversations).set({ updatedAt: row.createdAt, hlc: nextHlc() }).where(eq(conversations.id, conversationId)).run();
});

export function logTurn(actor: PersonRow, surface: Surface, userText: string, value: TurnValue): ConversationTurnRow {
  // Built and returned directly from the caller's own values, not
  // re-selected after the insert: a review (2026-09-04) pointed out every
  // field is already known here, the same "don't round-trip the database
  // to read back what you just validated and wrote" precedent
  // lib/memory.ts's remember() already set. This runs once per completed
  // turn, the app's hottest path.
  const row: ConversationTurnRow = {
    id: value.turn_id,
    personId: actor.id,
    surface,
    conversationId: value.conversation_id,
    userText,
    replyText: value.reply.text,
    source: value.source,
    pluginId: value.plugin_id ?? null,
    commandId: value.command_id ?? null,
    safetyFlagged: value.safety.flagged,
    safetyAction: value.safety.action,
    minorSpeaker: isMinorRole(actor.role as Role),
    createdAt: value.safety.checked_at,
  };
  insertTurnAndBumpConversation(row, value.conversation_id);
  return row;
}

// ==== Conversations: the thread record (step 3) ====
//
// One open conversation per (person, surface) at a time in practice:
// resolveOrCreateConversation() (the implicit, turn-time path) reuses
// whichever is already open; createConversation() (the explicit "start a
// new one" path, POST /) closes any other open one for the same pair
// first. Neither is a DB constraint - a closed or deleted conversation
// for the same pair coexists freely, the same append-only posture
// conversation_turns already has.

// The same discipline lib/personShape.ts and lib/memoryShape.ts already
// apply: every conversation this file hands back to a caller is parsed
// through the generated Zod schema first, snake_case, so the API can't
// silently drift from spec/schemas/conversation.schema.json. Internal-
// only DB access (maybeRefreshConversationSummary(), the LIST endpoint's
// own aggregation query) reads the raw camelCase row directly instead -
// there's no reason to round-trip a full record validation for a value
// nothing outside this file ever sees.
function toConversationRecord(row: ConversationRow): Conversation {
  return Conversation.parse({
    id: row.id,
    person: row.personId,
    surface: row.surface,
    companion_id: row.companionId,
    title: row.title,
    status: row.status,
    summary: row.summary,
    summary_through_turn: row.summaryThroughTurn,
    source: row.source,
    hlc: row.hlc,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

function conversationToDbValues(c: Conversation) {
  return {
    id: c.id,
    personId: c.person,
    surface: c.surface,
    companionId: c.companion_id,
    title: c.title,
    status: c.status,
    summary: c.summary,
    summaryThroughTurn: c.summary_through_turn,
    source: c.source,
    hlc: c.hlc,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function insertNewConversation(actor: PersonRow, surface: Surface, companionId?: string | null): Conversation {
  const now = new Date().toISOString();
  // Set at creation from the person's own persona pick (the contract:
  // "A conversation's companion_id is set at creation from that
  // setting"), not from a companion package (5.4/step 8 don't exist
  // yet) - persona.active_id always resolves to a real string (the
  // registry default when nobody's ever picked one), never undefined.
  const personaSetting = getPersonSettingValue(actor, "persona.active_id");
  const resolvedCompanionId =
    companionId !== undefined ? companionId : typeof personaSetting === "string" ? personaSetting : null;
  // Validated against the spec BEFORE writing (memory.ts's remember()
  // precedent): the single source of truth for what a valid conversation
  // looks like is the generated Zod schema, not a hand-kept second copy
  // of its rules here.
  const record = Conversation.parse({
    id: newConversationId(),
    person: actor.id,
    surface,
    companion_id: resolvedCompanionId,
    title: null,
    status: "open",
    summary: null,
    summary_through_turn: null,
    source: "hub",
    hlc: nextHlc(),
    created_at: now,
    updated_at: now,
  });
  try {
    db.insert(conversations).values(conversationToDbValues(record)).run();
  } catch (err) {
    // Never lets an unexpected persistence failure (an actor whose row
    // vanished between session validation and this call, a lock) block
    // the turn itself - the exact "logging must never turn a successful
    // generation into a reported failure" contract logTurn() already
    // holds (see logTurnSafely()'s own comment in turnEngine.ts),
    // extended here since conversation resolution now runs before a
    // reply is even generated (step 3), not only after. The in-memory
    // record is returned anyway so the turn can still proceed - a real
    // answer, just with no persisted history for it this time.
    console.error(`[conversationHistory] failed to persist a new conversation, continuing unpersisted: ${(err as Error).message}`);
  }
  return record;
}

/** The implicit path every real turn goes through (turnEngine.ts's
 * prepareTurn()): `conversationId` absent resolves to the actor's own
 * currently open conversation for this surface, creating one if none
 * exists yet; given, it must be a real, non-deleted conversation
 * belonging to this actor - never someone else's, and never a stale id
 * from before a delete. Multiple open ones for the same (person,
 * surface) shouldn't normally exist (createConversation() closes the
 * old one), but if one somehow does, the most recently active wins
 * rather than an arbitrary row. */
export function resolveOrCreateConversation(
  actor: PersonRow,
  surface: Surface,
  conversationId?: string,
): ConversationOpResult<Conversation> {
  if (conversationId) {
    const row = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    // A code review (2026-09-05) found the surface check missing: a
    // conversation_id from this actor's own "chat" conversation passed
    // for a "tv" turn, silently attaching a tv-surface turn under a
    // chat-surface conversation and desyncing the two.
    if (!row || row.personId !== actor.id || row.status === "deleted" || row.surface !== surface) {
      return { ok: false, status: 400, error: `conversation not found: ${conversationId}` };
    }
    return { ok: true, value: toConversationRecord(row) };
  }

  const openOnes = db
    .select()
    .from(conversations)
    .where(and(eq(conversations.personId, actor.id), eq(conversations.surface, surface), eq(conversations.status, "open")))
    .all();
  if (openOnes.length > 0) {
    openOnes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, value: toConversationRecord(openOnes[0]!) };
  }

  return { ok: true, value: insertNewConversation(actor, surface) };
}

/** POST /api/conversations: an explicit "start a new conversation"
 * action, distinct from the implicit resolve-or-create above - always
 * creates, closing (never deleting) whichever conversation was
 * previously open for the same (person, surface) pair so the "one open
 * at a time" invariant stays meaningful for the next bare turn. */
// The spec's own enum (Conversation.shape.surface.options), not a
// hand-copied second list: one definition, reused for real runtime
// validation of a value that - unlike turnEngine.ts's own Surface
// parameter - arrives here straight from an unchecked request body.
const VALID_SURFACES = new Set(Conversation.shape.surface.options as readonly string[]);

export function createConversation(
  actor: PersonRow,
  opts: { surface?: Surface; companionId?: string | null } = {},
): ConversationOpResult<Conversation> {
  const surface = opts.surface ?? "chat";
  // A code review (2026-09-05) found no validation here at all: a bogus
  // surface reached insertNewConversation()'s Conversation.parse() and
  // threw an uncaught ZodError (an unhandled 500) instead of the clean
  // 400 invalid_input POST /api/turn already gives for the identical
  // bad input. Checked BEFORE the close-the-old-one write below, so a
  // rejected request never has a side effect to explain.
  if (!VALID_SURFACES.has(surface)) {
    return { ok: false, status: 400, error: `invalid surface: ${surface}` };
  }
  db.update(conversations)
    .set({ status: "closed", updatedAt: new Date().toISOString(), hlc: nextHlc() })
    .where(and(eq(conversations.personId, actor.id), eq(conversations.surface, surface), eq(conversations.status, "open")))
    .run();
  return { ok: true, value: insertNewConversation(actor, surface, opts.companionId) };
}

function toConversationSummary(row: ConversationRow, turnCount: number, lastTurnAt: string | null): ConversationSummary {
  return {
    id: row.id,
    surface: row.surface,
    companion_id: row.companionId,
    title: row.title,
    turn_count: turnCount,
    last_turn_at: lastTurnAt,
    created_at: row.createdAt,
  };
}

/** GET /api/conversations (step 3's contract): the actor's own
 * conversations, or (owner/admin only) a child's - the exact same
 * visibility rule list()/exportPerson() below already apply. A deleted
 * conversation never appears (its own tombstone, not just hidden from
 * this one listing). Newest-active-first (updated_at, bumped by every
 * real logTurn() and by createConversation()'s own close-the-old-one
 * step), not creation order. */
export function listConversations(actor: PersonRow, personId?: string): ConversationSummary[] {
  const target = personId ?? actor.id;
  if (!canAccessPerson(actor, target)) return [];
  const rows = db
    .select()
    .from(conversations)
    .where(and(eq(conversations.personId, target), not(eq(conversations.status, "deleted"))))
    .all();
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const turnRows = db
    .select({ conversationId: conversationTurns.conversationId, createdAt: conversationTurns.createdAt })
    .from(conversationTurns)
    .where(inArray(conversationTurns.conversationId, ids))
    .all();
  const byConversation = new Map<string, { count: number; last: string | null }>();
  for (const t of turnRows) {
    if (!t.conversationId) continue;
    const entry = byConversation.get(t.conversationId) ?? { count: 0, last: null };
    entry.count++;
    if (!entry.last || t.createdAt > entry.last) entry.last = t.createdAt;
    byConversation.set(t.conversationId, entry);
  }

  return rows.map((r) => {
    const agg = byConversation.get(r.id) ?? { count: 0, last: null };
    return toConversationSummary(r, agg.count, agg.last);
  });
}

/** GET /api/conversations/:id: a real 404 for anyone else's, deleted, or
 * nonexistent - never distinguishing "not yours" from "doesn't exist"
 * (the same information-hiding posture a 404 always gives). */
export function getConversation(actor: PersonRow, id: string): ConversationOpResult<Conversation> {
  const row = db.select().from(conversations).where(eq(conversations.id, id)).get();
  if (!row || row.status === "deleted" || !canAccessPerson(actor, row.personId)) {
    return { ok: false, status: 404, error: "conversation not found" };
  }
  return { ok: true, value: toConversationRecord(row) };
}

/** GET /api/conversations/:id/turns?since=<turn_id> (step 3's contract):
 * oldest first, each with `memory_ids` - every memory record whose
 * provenance (step 2's `source` field) names this exact turn, batched in
 * one query rather than one per turn. `since` filters to turns strictly
 * after the named one (resolved to its timestamp, since turn ids are
 * random and carry no ordering of their own). */
export function listConversationTurns(
  actor: PersonRow,
  id: string,
  opts: { since?: string } = {},
): ConversationOpResult<ConversationTurnWithMemoryIds[]> {
  const found = getConversation(actor, id);
  if (!found.ok) return found;

  // Scoped to THIS conversation (a code review, 2026-09-05, found the
  // original version looked the turn up by id alone with no check it
  // belongs here - a turn id from a different conversation, or leaked
  // from a different person's, silently supplied a valid-looking
  // cutoff).
  let sinceId: string | undefined;
  if (opts.since) {
    const sinceRow = db
      .select({ id: conversationTurns.id })
      .from(conversationTurns)
      .where(and(eq(conversationTurns.id, opts.since), eq(conversationTurns.conversationId, id)))
      .get();
    sinceId = sinceRow?.id;
  }

  let rows = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, id)).all();
  // Stable sort (Array.prototype.sort's own guarantee): rows sharing a
  // createdAt millisecond keep the order SQLite returned them in (its
  // default is rowid/insertion order for an insert-only table), so
  // `since` can be resolved to a real POSITION rather than re-comparing
  // timestamps. A code review (2026-09-05) found the original
  // timestamp-based tie-break ("same millisecond, different id") could
  // still re-include an earlier same-millisecond turn a client had
  // already seen - slicing by index instead makes "everything after
  // `since`" exact, not an approximation.
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (sinceId) {
    const idx = rows.findIndex((r) => r.id === sinceId);
    if (idx >= 0) rows = rows.slice(idx + 1);
  }

  const turnIds = rows.map((r) => r.id);
  const memRows =
    turnIds.length > 0
      ? db.select({ id: memoryRecords.id, source: memoryRecords.source }).from(memoryRecords).where(inArray(memoryRecords.source, turnIds)).all()
      : [];
  const byTurn = new Map<string, string[]>();
  for (const m of memRows) {
    const ids = byTurn.get(m.source) ?? [];
    ids.push(m.id);
    byTurn.set(m.source, ids);
  }

  return { ok: true, value: rows.map((r) => ({ ...r, memory_ids: byTurn.get(r.id) ?? [] })) };
}

/** PATCH /api/conversations/:id: title only (step 3's contract). Same
 * access rule as getConversation() - an owner/admin may rename a
 * child's the same way they can already view it. */
export function updateConversationTitle(actor: PersonRow, id: string, title: string | null): ConversationOpResult<Conversation> {
  const found = getConversation(actor, id);
  if (!found.ok) return found;
  const now = new Date().toISOString();
  const newHlc = nextHlc();
  // Validated through the spec before writing (a code review, 2026-09-05,
  // found this was the one write path in the file that skipped it, so a
  // title over the schema's own 200-char maxLength was accepted here and
  // rejected by anything else that later validates the row for real).
  // safeParse, not parse: a bad title (too long) is a real 400 from the
  // caller's own input, not an internal bug worth throwing over.
  const parsed = Conversation.safeParse({ ...found.value, title, updated_at: now, hlc: newHlc });
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  db.update(conversations).set({ title, updatedAt: now, hlc: newHlc }).where(eq(conversations.id, id)).run();
  return { ok: true, value: parsed.data };
}

/** DELETE /api/conversations/:id (step 3's contract): "A deleted
 * conversation deletes its turns; memories written from them stay."
 * `status` becomes a tombstone (`deleted`, never a hard-deleted row -
 * this record carries a real hlc specifically because it's meant to
 * sync, the same "a row that vanishes looks unheard-of to a later sync"
 * reasoning step 10 formalizes for memory records), with its own content
 * wiped (title, summary): a summary is transcript-derived, so a
 * conversation that's genuinely deleted shouldn't leave one sitting
 * under the tombstone. The turns themselves - the real transcript - are
 * a genuine hard delete. Memories the turns produced are untouched: they
 * carry the turn id as provenance and outlive the chat by design. */
export function deleteConversationById(actor: PersonRow, id: string): ConversationOpResult<true> {
  const found = getConversation(actor, id);
  if (!found.ok) return found;
  const now = new Date().toISOString();
  db.update(conversations)
    .set({ status: "deleted", title: null, summary: null, summaryThroughTurn: null, updatedAt: now, hlc: nextHlc() })
    .where(eq(conversations.id, id))
    .run();
  sqlite.query("DELETE FROM conversation_turns WHERE conversation_id = ?").run(id);
  return { ok: true, value: true };
}

/** POST /api/conversations/batch-delete: the batch-actions standing rule
 * (docs/UI.md, 2026-09-05). Each id goes through the identical single
 * access-checked delete above; one denied or missing id doesn't fail the
 * whole batch, it just doesn't count. */
export function batchDeleteConversations(actor: PersonRow, ids: string[]): { deleted: number } {
  let deleted = 0;
  for (const id of ids) {
    if (deleteConversationById(actor, id).ok) deleted++;
  }
  return { deleted };
}

/** POST /api/conversations/clear: every one of the actor's OWN
 * conversations (never a target person - "clear" is a personal action,
 * unlike list()'s parental-view read), reusing the identical delete. */
export function clearConversations(actor: PersonRow): { deleted: number } {
  const rows = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.personId, actor.id), not(eq(conversations.status, "deleted"))))
    .all();
  return batchDeleteConversations(actor, rows.map((r) => r.id));
}

// ==== The prompt window (step 3) ====
//
// Numbers copied from legacy `routes/chat.ts` (`trimHistory`), per the
// plan's own instruction: 1,200-token estimate (chars/4, not a real
// tokenizer - the same "close enough" approximation this codebase
// already uses nowhere else because nothing needed one until now), the
// newest 4 turns always kept whole regardless of size. Recorded here,
// not just in dev.md, because these are exactly the numbers a future
// pass would otherwise have no reason to trust: legacy found "800 tokens
// dropped 4-turn back-references" empirically, and a stale summary "is
// real amnesia" - the summary refresh job below exists because of that
// second finding.
const WINDOW_NEWEST_TURNS_KEPT = 4;
const WINDOW_TOKEN_BUDGET = 1200;
// Bounds buildConversationWindow()/maybeRefreshConversationSummary()'s
// own per-conversation query (a code review, 2026-09-05): even at an
// unrealistic one word per turn, 200 turns is already far past the
// 1,200-token budget, so this never changes which turns end up in a
// real window - it only stops the query and its JS sort from growing
// with a long-lived conversation's entire history.
const WINDOW_ROW_FETCH_LIMIT = 200;
const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export interface ConversationWindow {
  messages: LlmMessage[];
  /** One system-side line covering everything older than the window,
   * only when older turns actually exist AND a summary already covers
   * them - never a placeholder for "there's more but no summary yet". */
  summaryLine?: string;
}

/** The follow-up-turn context (step 3: "and tomorrow?" needs the prior
 * exchange in the prompt to mean anything, `turnEngine.ts` sends
 * `[system, user]` and nothing else today). The newest
 * WINDOW_NEWEST_TURNS_KEPT turns are always included verbatim, whatever
 * their size; older turns are added back to front (most-recent-of-the-
 * older first) while the running chars/4 estimate stays under
 * WINDOW_TOKEN_BUDGET, stopping - "oldest dropped first" - the moment one
 * more would exceed it. Whatever's older than what fit is represented by
 * the conversation's own rolling `summary` as one line instead, when one
 * exists. */
export function buildConversationWindow(conversation: Conversation): ConversationWindow {
  // Bounded, not the full history (a code review, 2026-09-05, found this
  // fetching and re-sorting every turn ever logged, on every model-
  // routed turn): WINDOW_ROW_FETCH_LIMIT is far more than the token
  // budget could ever actually use even in the extreme case of
  // one-word turns, so this never changes which turns end up in the
  // window for any real conversation - it only stops the query (and the
  // JS sort) from growing with the conversation's entire lifetime.
  const rows = db
    .select()
    .from(conversationTurns)
    .where(eq(conversationTurns.conversationId, conversation.id))
    .orderBy(desc(conversationTurns.createdAt))
    .limit(WINDOW_ROW_FETCH_LIMIT)
    .all();
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (rows.length === 0) return { messages: [] };

  const newest = rows.slice(-WINDOW_NEWEST_TURNS_KEPT);
  const older = rows.slice(0, Math.max(0, rows.length - WINDOW_NEWEST_TURNS_KEPT));

  let tokenTotal = newest.reduce((sum, t) => sum + estimateTokens(t.userText) + estimateTokens(t.replyText), 0);
  const includedOlder: ConversationTurnRow[] = [];
  for (let i = older.length - 1; i >= 0; i--) {
    const t = older[i]!;
    const cost = estimateTokens(t.userText) + estimateTokens(t.replyText);
    if (tokenTotal + cost > WINDOW_TOKEN_BUDGET) break;
    tokenTotal += cost;
    includedOlder.unshift(t);
  }

  const windowTurns = [...includedOlder, ...newest];
  const messages: LlmMessage[] = [];
  for (const t of windowTurns) {
    messages.push({ role: "user", content: t.userText });
    messages.push({ role: "assistant", content: t.replyText });
  }

  const hasUncoveredOlder = older.length - includedOlder.length > 0;
  const summaryLine =
    hasUncoveredOlder && conversation.summary ? `Summary of earlier conversation: ${conversation.summary}` : undefined;

  return { messages, summaryLine };
}

// ==== The rolling summary refresh (step 3) ====

// "at least 4 turns have fallen out of the window since summary_through_
// turn" (the plan's own words) - the same WINDOW_NEWEST_TURNS_KEPT
// number, not a separate tuning: the window and the refresh trigger are
// two views of the identical boundary (what's still verbatim vs. what
// needs a summary to be reachable at all).
const SUMMARY_REFRESH_THRESHOLD_TURNS = WINDOW_NEWEST_TURNS_KEPT;

/** Post-turn, never in the request path (step 3 is explicit: "it never
 * runs in the request path"). Refreshes a conversation's rolling
 * `summary` once at least SUMMARY_REFRESH_THRESHOLD_TURNS turns have
 * fallen out of the live window since `summary_through_turn`. Best
 * effort, the same posture summarizeBeforeDelete() (4.14) already
 * takes: skipped entirely on the stub model (a canned reply is worse
 * than no summary), and any failure is logged, never thrown - a summary
 * is a quality upgrade on the window, never something a turn's own
 * success depends on. */
export async function maybeRefreshConversationSummary(conversationId: string): Promise<void> {
  const conversation = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  if (!conversation || conversation.status === "deleted") return;

  // Same bound as buildConversationWindow() above, for the identical
  // reason: this job runs after every turn, so summary_through_turn is
  // always recent in practice - WINDOW_ROW_FETCH_LIMIT is generous
  // headroom, not a tight fit.
  const rows = db
    .select()
    .from(conversationTurns)
    .where(eq(conversationTurns.conversationId, conversationId))
    .orderBy(desc(conversationTurns.createdAt))
    .limit(WINDOW_ROW_FETCH_LIMIT)
    .all();
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (rows.length <= WINDOW_NEWEST_TURNS_KEPT) return; // nothing has fallen out of the window yet

  const olderThanWindow = rows.slice(0, rows.length - WINDOW_NEWEST_TURNS_KEPT);
  const throughIndex = conversation.summaryThroughTurn
    ? olderThanWindow.findIndex((t) => t.id === conversation.summaryThroughTurn)
    : -1;
  const newSinceLastSummary = olderThanWindow.slice(throughIndex + 1);
  if (newSinceLastSummary.length < SUMMARY_REFRESH_THRESHOLD_TURNS) return;
  if (getEngineStatus().kind === "stub") return;

  let transcript = newSinceLastSummary.map((r) => `User: ${r.userText}\nReply: ${r.replyText}`).join("\n\n");
  if (transcript.length > MAX_SUMMARY_INPUT_CHARS) {
    transcript = transcript.slice(transcript.length - MAX_SUMMARY_INPUT_CHARS);
  }
  const priorSummary = conversation.summary ? `Prior summary: ${conversation.summary}\n\n` : "";

  try {
    const result = await complete("chat", [
      {
        role: "user",
        content:
          `${priorSummary}Update the summary of this conversation with the new exchanges below, ` +
          "in 2-4 sentences, for future reference. Do not quote exact wording, just the substance.\n\n" +
          transcript,
      },
    ]);
    if (!result.ok) {
      console.log(`[conversationHistory] summary refresh skipped for ${conversationId}: ${result.error}`);
      return;
    }
    if (getEngineStatus().kind === "stub") return; // resolved to the stub only just now (this process's first completion ever)
    db.update(conversations)
      .set({
        summary: result.value.text,
        summaryThroughTurn: newSinceLastSummary[newSinceLastSummary.length - 1]!.id,
        updatedAt: new Date().toISOString(),
        hlc: nextHlc(),
      })
      .where(eq(conversations.id, conversationId))
      .run();
  } catch (err) {
    console.log(`[conversationHistory] summary refresh failed for ${conversationId}: ${(err as Error).message}`);
  }
}

const LIST_CAP = 200;

/** A person's own turns, or (owner/admin only) a child's: the exact same
 * visibility rule memory.ts and settings.ts already apply. Nothing of a
 * teen's or an adult's is visible to anyone but themself: 4.14 asks for "a
 * summary and safety flags for a teen's," but there's no summarization
 * mechanism to safely implement that yet, the identical judgment call
 * memory.ts's scope:person visibility already made and documented (and
 * canAccessPerson's own comment already named as this file's rule),
 * applied here for the same reason. An actor with no access gets an empty
 * list, not an error: matches how a caller would ask "show me this
 * person's conversations" and simply see nothing, not be told why. */
export function list(actor: PersonRow, personId?: string): ConversationTurnRow[] {
  const target = personId ?? actor.id;
  if (!canAccessPerson(actor, target)) return [];
  const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, target)).all();
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.slice(0, LIST_CAP);
}

/** The full per-person archive (4.14: "export per person is one
 * archive"), no cap, same visibility rule as list(). Unlike list()'s
 * silent empty-list-on-denial (browsing), export is a privileged,
 * single-target action, the same distinction memory.ts's list() vs
 * exportPerson() already draws: a real 403, matching memory's
 * exportPerson() precedent, not a result indistinguishable from "this
 * person just has no history yet." */
export function exportPerson(actor: PersonRow, personId: string): ConversationOpResult<ConversationTurnRow[]> {
  if (!canAccessPerson(actor, personId)) {
    return { ok: false, status: 403, error: "cannot export another person's conversation history" };
  }
  const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, personId)).all();
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { ok: true, value: rows };
}

const DEFAULT_RETENTION_DAYS = 90;
// 4.14: "a household setting with a floor for kid safety logs." No exact
// number is given in the plan; 90 days is this pass's own judgment call,
// matching the retention default itself so a household that never touches
// the setting sees no floor effect at all (the floor only ever binds when
// someone shortens retention below it).
const SAFETY_FLAGGED_MINOR_FLOOR_DAYS = 90;
const DAY_MS = 86_400_000;

const MAX_SUMMARY_INPUT_CHARS = 8_000;

/** Turns a batch of one person's about-to-expire turns into one real
 * `record_kind: "episode"` memory record (household 3.1's shape already
 * had this kind; nothing had ever created one before this). Best effort,
 * on purpose: skipped entirely (returns without writing anything, and
 * without throwing) whenever there's no REAL model to ask - storing the
 * stub's own canned "[stub model: no real model loaded]" text as a
 * permanent memory record would be worse than no summary at all. Checked
 * both BEFORE calling complete() (a cheap bulk skip once a process
 * already knows it's on the stub, the common case on every retention
 * tick after the first) and AFTER each call (the only way to know for a
 * process's very first completion ever, since getChatClient() resolves
 * lazily - `getEngineStatus()` only reports "none" beforehand, and
 * complete() itself is what decides real-vs-stub). A real model that's
 * merely slow, or a completion that fails for any other reason, is
 * treated the same way: logged, not thrown, since runRetention()'s own
 * deletion must never wait on or be blocked by this. The most recent
 * `MAX_SUMMARY_INPUT_CHARS` of transcript (not the oldest) is what gets
 * summarized when a person's batch is large - recency is more useful to
 * a future reader than completeness, and this keeps the prompt well
 * inside even a modest context window. */
// Exported for a real test (a real completion round trip against a real
// stub-shaped server, not a mock of complete()) - the same "prove the
// real mechanism, not a simulation of it" standard this session's other
// supervisor tests already hold to. runRetention() calls this the same
// way, fire-and-forget.
export async function summarizeBeforeDelete(rows: ConversationTurnRow[]): Promise<void> {
  const byPerson = new Map<string, ConversationTurnRow[]>();
  for (const row of rows) {
    if (!byPerson.has(row.personId)) byPerson.set(row.personId, []);
    byPerson.get(row.personId)!.push(row);
  }
  if (byPerson.size === 0) return;
  if (getEngineStatus().kind === "stub") return;

  for (const [personId, personRows] of byPerson) {
    // isNull(deletedAt), not a bare id match: a code review (2026-09-04)
    // found the original version still found a SOFT-deleted person (the
    // household removed them since these turns were written) and wrote
    // them a brand-new episode memory anyway - the same pattern
    // scheduler.ts's own core-job person lookup already guards against
    // for the identical reason.
    const person = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get();
    if (!person) continue; // deleted since these turns were written; nothing to attribute a summary to

    personRows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let transcript = personRows.map((r) => `User: ${r.userText}\nReply: ${r.replyText}`).join("\n\n");
    if (transcript.length > MAX_SUMMARY_INPUT_CHARS) {
      transcript = transcript.slice(transcript.length - MAX_SUMMARY_INPUT_CHARS);
    }

    try {
      const result = await complete("chat", [
        {
          role: "user",
          content:
            "Summarize the key facts, requests, and events from this conversation history in 2-4 sentences, " +
            "for future reference. Do not quote exact wording, just the substance.\n\n" +
            transcript,
        },
      ]);
      if (!result.ok) {
        console.log(`[conversationHistory] retention summary skipped for ${personId}: ${result.error}`);
        continue;
      }
      if (getEngineStatus().kind === "stub") {
        // Resolved to the stub for the first time just now (this
        // process's very first completion ever) - a canned reply is
        // worse than no summary; skip the rest of this batch too.
        return;
      }
      const written = remember(person, {
        record_kind: "episode",
        text: result.value.text,
        category: "event",
        tier: "durable",
        scope: "person",
        person: personId,
        source: "conversation-retention-summary",
        importance: 0.3,
      });
      if (!written.ok) {
        console.log(`[conversationHistory] retention summary for ${personId} failed to save: ${written.error}`);
      }
    } catch (err) {
      console.log(`[conversationHistory] retention summary failed for ${personId}: ${(err as Error).message}`);
    }
  }
}

/** Best-effort summarizes (see summarizeBeforeDelete()), then hard-
 * deletes, turns past the household's retention window (4.6's
 * `household.conversation_retention_days`, default 90). A safety-flagged
 * turn from a minor speaker is never deleted before it's at least
 * `SAFETY_FLAGGED_MINOR_FLOOR_DAYS` old, regardless of how short the
 * household sets retention: the floor only ever *extends* the effective
 * window (a household that sets retention longer than the floor is
 * unaffected; the general rule already keeps those turns longer). The
 * summary step never gates or delays the delete: retention's "gone
 * after N days" is the hard privacy guarantee this function exists to
 * keep, a summary is a best-effort upgrade on top of it, never a
 * precondition - so the delete always proceeds this same tick whether
 * or not summarization succeeded, and callers don't need to await the
 * summarization to get an accurate `deleted` count back. Wired as a
 * real daily core job (lib/scheduler.ts), not a manual-only trigger:
 * unlike memory.ts's runMaintenance() when it first shipped, the
 * scheduler (4.7) already exists by the time this was built. */
export function runRetention(): { deleted: number } {
  const retentionDays = getHouseholdSettingValue("household.conversation_retention_days") as number | undefined;
  const days = typeof retentionDays === "number" && retentionDays > 0 ? retentionDays : DEFAULT_RETENTION_DAYS;
  const now = Date.now();
  const generalCutoff = new Date(now - days * DAY_MS).toISOString();
  // The effective cutoff for a flagged-minor row is whichever of the two
  // dates is *older* (requires more age before deletion is allowed): if
  // the household's own retention is already longer than the floor, the
  // general cutoff alone is already stricter and the floor never binds.
  const floorCutoff = new Date(now - SAFETY_FLAGGED_MINOR_FLOOR_DAYS * DAY_MS).toISOString();
  const flaggedMinorCutoff = generalCutoff < floorCutoff ? generalCutoff : floorCutoff;

  // Read what's about to be deleted BEFORE deleting it, so there's real
  // text left to summarize - the exact same two cohorts the DELETE
  // statements below select, combined. Fired without awaiting: see
  // runRetention()'s own doc comment for why the delete must never wait
  // on this.
  const isFlaggedMinor = and(eq(conversationTurns.safetyFlagged, true), eq(conversationTurns.minorSpeaker, true));
  const expiring = db
    .select()
    .from(conversationTurns)
    .where(
      or(
        and(not(isFlaggedMinor!), lt(conversationTurns.createdAt, generalCutoff))!,
        and(isFlaggedMinor!, lt(conversationTurns.createdAt, flaggedMinorCutoff))!,
      ),
    )
    .all();
  void summarizeBeforeDelete(expiring).catch((err: Error) =>
    console.log(`[conversationHistory] retention summarization batch failed: ${err.message}`),
  );

  // Raw sqlite for a real affected-row count, not db.delete().run(): the
  // same escape hatch lib/memory.ts's forget() uses (Drizzle's bun-sqlite
  // .run() types its result void even though it returns {changes} at
  // runtime). Two statements, not one with an OR, so each cutoff date
  // only ever applies to the rows it's meant for.
  const normal = sqlite
    .query("DELETE FROM conversation_turns WHERE NOT (safety_flagged = 1 AND minor_speaker = 1) AND created_at < ?")
    .run(generalCutoff);
  const flaggedMinor = sqlite
    .query("DELETE FROM conversation_turns WHERE safety_flagged = 1 AND minor_speaker = 1 AND created_at < ?")
    .run(flaggedMinorCutoff);

  return { deleted: normal.changes + flaggedMinor.changes };
}

export interface RoutingStats {
  total: number;
  plugin: number;
  pluginError: number;
  /** A command primitive fires before the plugin floor even runs
   * (turnEngine.ts's prepareTurn(), "checked before the plugin floor"),
   * but for this metric's purposes it's the same kind of thing plugin/
   * pluginError are: a deterministic match that never reached the model.
   * A code review (2026-09-05) found the original version of this
   * function had no case for "command"/"command_error" at all, so a
   * command turn silently vanished from every bucket while still
   * counting toward `total` - undercounting the routable denominator and
   * making `fallthroughRate` read higher than reality the moment any
   * command ever fired. */
  command: number;
  commandError: number;
  model: number;
  safetyRefuse: number;
  /** model / (plugin + pluginError + command + commandError + model) -
   * the exact number 4.5's own plan names as the decision input ("count
   * fall-throughs... and decide on tier 2 from the eval number").
   * `safety_refuse` never reaches routing at all (prepareTurn() checks
   * safety before the deterministic floor even runs), so it's excluded
   * from both sides of this ratio - counting it would understate the
   * real fall-through rate against everything routing actually had a
   * chance to match. Null with zero routable turns, never a division by
   * zero silently reading as 0%. */
  fallthroughRate: number | null;
  /** Which plugins are actually firing, most first - the plan's own "add
   * a row before it is fixed" eval-set idea needs to know not just THAT
   * routing falls through, but which utterances it should have matched
   * and didn't; this is the "did match" half of that picture. */
  byPlugin: { pluginId: string; count: number }[];
  /** The same "did match" picture as byPlugin, for commands. */
  byCommand: { commandId: string; count: number }[];
}

/** Household-wide, not per-person (unlike list()/exportPerson() above):
 * aggregate counts carry no turn text and no per-person breakdown, the
 * same "a systems metric, not personal history" posture engine status
 * and hardware detection already take - gated by the route's own
 * requireRole("owner", "admin"), not an actor param here, matching
 * lib/hardware.ts's detectHardware() precedent for the identical shape. */
export function routingStats(): RoutingStats {
  const rows = db
    .select({ source: conversationTurns.source, pluginId: conversationTurns.pluginId, commandId: conversationTurns.commandId })
    .from(conversationTurns)
    .all();

  let plugin = 0;
  let pluginError = 0;
  let command = 0;
  let commandError = 0;
  let model = 0;
  let safetyRefuse = 0;
  const pluginCounts = new Map<string, number>();
  const commandCounts = new Map<string, number>();

  for (const row of rows) {
    switch (row.source) {
      case "plugin":
        plugin++;
        if (row.pluginId) pluginCounts.set(row.pluginId, (pluginCounts.get(row.pluginId) ?? 0) + 1);
        break;
      case "plugin_error":
        pluginError++;
        break;
      case "command":
        command++;
        if (row.commandId) commandCounts.set(row.commandId, (commandCounts.get(row.commandId) ?? 0) + 1);
        break;
      case "command_error":
        commandError++;
        break;
      case "model":
        model++;
        break;
      case "safety_refuse":
        safetyRefuse++;
        break;
    }
  }

  const routable = plugin + pluginError + command + commandError + model;
  const byPlugin = [...pluginCounts.entries()]
    .map(([pluginId, count]) => ({ pluginId, count }))
    .sort((a, b) => b.count - a.count);
  const byCommand = [...commandCounts.entries()]
    .map(([commandId, count]) => ({ commandId, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    plugin,
    pluginError,
    command,
    commandError,
    model,
    safetyRefuse,
    fallthroughRate: routable > 0 ? model / routable : null,
    byPlugin,
    byCommand,
  };
}
