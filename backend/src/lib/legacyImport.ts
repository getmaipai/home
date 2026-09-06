// Step 10 (session-c-brain-and-voice.md): "import from the legacy hub."
// Reads a legacy `app.db` (home-legacy.git's backend/src/db/schema.ts,
// confirmed directly against the mirror rather than assumed) and brings
// its people, memories, and chat history into this hub's own store. The
// plan's own words name exactly three legacy tables: `users`, `memories`,
// and `conversations`/`messages` - the legacy `entities` and
// `memory_episodes` tables are a real, documented gap, not silently
// skipped: see this file's own header note below.
//
// Idempotent by construction, not by a separate tracking table: every
// imported row's identity is DERIVED from the legacy row it came from
// (a memory record's own free-text `source` field for memories, a
// deterministic hash of the legacy id for conversations/turns, and a
// display-name match for people), so re-running this import against the
// same legacy database a second time finds every row it already made and
// reports it as "already present" instead of writing it twice. This is
// what "runs once... idempotent by legacy id" means in practice: nothing
// stops a second call, a second call just does nothing new.
//
// What's deliberately NOT imported this pass, and why:
// - Legacy's `entities` table (named people/places/things the household
//   tracked) now has a real, better home in F's own lib/entities.ts
//   (spec/schemas/entity.schema.json, source: "imported" already exists
//   as an enum value for exactly this case) - but createEntity() always
//   writes source: "hub" with no override, and entities.ts is F's owned
//   file (docs/plans/wave-2.md's ownership map), so adding an override
//   or an idempotent bulk-import path there is F's call, not a change
//   this session makes to another session's file mid-wave. A legacy
//   `memories` row whose OWN category is entity-shaped (person/place/
//   thing) is still imported correctly below, as a record_kind:"entity"
//   memory record - the same convention lib/memoryJudge.ts's own judge
//   already uses for a freshly extracted fact of the same category
//   (categoryToRecordKind(), exported from there for exactly this
//   reuse). Only the SEPARATE legacy `entities` table (a distinct
//   catalog of named entities, not memories) is left for a follow-up.
// - Legacy's `memory_episodes` table (rolling per-conversation
//   summaries) could round-trip through a record_kind:"episode" memory
//   record (the same shape lib/conversationHistory.ts's own retention
//   summaries already write), but the plan's own words for this step
//   name only "memories" and "conversations" - left as a documented,
//   real gap rather than a scope addition assumed without the plan
//   actually asking for it.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/db";
import { people, memoryRecords, conversations, conversationTurns } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { parsePersonCandidate, personToDbValues } from "@/lib/personShape";
import { speakerAgeBand } from "@/lib/ageBand";
import { remember } from "@/lib/memory";
import { categoryToRecordKind, isCategory } from "@/lib/memoryJudge";
import { listBackups } from "@/lib/backup";
import { Conversation } from "@maipai/spec/gen/ts/conversation.js";
import type { PersonRow } from "@/types";

export class LegacyImportError extends Error {}

// A fixed, documented sentinel, the same convention lib/memory.ts's own
// TOMBSTONE_TEXT already uses for "the real content isn't recoverable
// here" - a user message with no following assistant reply (the
// conversation ends mid-turn, or the reply was an inactive/discarded
// regenerate branch this import already excludes) is real history worth
// keeping, not a row worth dropping just because half of it is missing.
export const ORPHANED_REPLY_TEXT = "[no reply recorded]";

function legacyTsToIso(raw: number | null | undefined): string | null {
  // Legacy's own integer('...', { mode: 'timestamp' }) columns store
  // whole seconds since epoch (confirmed against home-legacy.git's own
  // drizzle usage), not milliseconds - the one unit mismatch a raw
  // bun:sqlite read of another product's database has to get right by
  // hand, since reading through the DRIVER (not through legacy's own
  // drizzle instance, which isn't loaded here) hands back the bare
  // stored integer.
  if (raw == null) return null;
  return new Date(raw * 1000).toISOString();
}

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

function normalizeLegacyBirthdate(raw: string): string {
  // person.schema.json's birthdate is format:"date" (YYYY-MM-DD); legacy
  // stores birthdate as plain text with no format guarantee recorded in
  // its own schema comment. Every real legacy row is expected to
  // already be in this shape (a text column an app itself only ever
  // wrote ISO dates into) - taken directly, with no Date round-trip at
  // all, which a code review (2026-09-06) found necessary: `new
  // Date(raw).toISOString()` parses a NON-ISO string like "06/15/1985"
  // at LOCAL midnight (unlike a bare "1985-06-15", which the spec
  // guarantees is UTC midnight), so on a host east of UTC that fallback
  // alone could silently shift such a birthdate back one day. Only a
  // genuinely non-ISO value falls through to that best-effort (and
  // still ambiguous - there is no way to know which zone the original
  // writer intended) fallback below.
  if (ISO_DATE_PREFIX.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function stableSuffix(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

// Deterministic, not random: running the same legacy database through
// this import twice must mint the exact same new-hub id for the exact
// same legacy row both times, which is what makes a second run's
// db.select(...).where(eq(id, ...)) lookup below a real idempotency
// check rather than a coincidence. Matches conversation.schema.json's
// own `^conv-[a-z0-9]{6,}$` pattern (a sha256 hex digest is already
// lowercase alphanumeric).
function deterministicConversationId(legacyConversationId: string): string {
  return `conv-${stableSuffix(`legacy-conversation:${legacyConversationId}`, 16)}`;
}

// conversation_turns ids carry no spec pattern (lib/id.ts's own header:
// "not a spec-shaped id... just a stable, collision-resistant local
// id") - free to be deterministic here for the identical idempotency
// reason as the conversation id above. Anchored to the message that
// COMPLETES a turn (the assistant reply, or the orphaned user message
// itself when there is no reply) rather than a synthetic pair id, so
// the anchor is always a real legacy row this import can point back to.
function deterministicTurnId(anchorLegacyMessageId: string): string {
  return `turn-${stableSuffix(`legacy-message:${anchorLegacyMessageId}`, 16)}`;
}

interface LegacyUserRaw {
  id: string;
  first_name: string;
  last_name: string;
  nickname: string;
  birthdate: string;
  role: "admin" | "user";
  dicebear_seed: string | null;
}

interface LegacyMemoryRaw {
  id: string;
  user_id: string | null;
  character_id: string | null;
  text: string;
  category: string;
  tier: "durable" | "episodic";
  status: "active" | "superseded" | "archived";
  importance: number;
  pinned: number;
  sensitive: number;
  created_at: number;
}

interface LegacyConversationRaw {
  id: string;
  user_id: string;
  title: string | null;
  created_at: number;
  updated_at: number | null;
}

interface LegacyMessageRaw {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
}

export interface PersonResolution {
  legacyId: string;
  displayName: string;
  outcome: "matched_existing" | "created" | "skipped_needs_parent_pick";
  personId: string | null;
}

export interface LegacyImportCounts {
  peopleMatched: number;
  peopleCreated: number;
  peopleSkippedMinor: number;
  memoriesImported: number;
  memoriesAlreadyPresent: number;
  memoriesSkippedNoPerson: number;
  conversationsImported: number;
  conversationsAlreadyPresent: number;
  conversationsSkippedNoPerson: number;
  turnsImported: number;
  turnsAlreadyPresent: number;
  turnsSkippedSystemMessages: number;
}

export interface LegacyImportResult {
  dryRun: boolean;
  people: PersonResolution[];
  counts: LegacyImportCounts;
  errors: string[];
}

function emptyCounts(): LegacyImportCounts {
  return {
    peopleMatched: 0,
    peopleCreated: 0,
    peopleSkippedMinor: 0,
    memoriesImported: 0,
    memoriesAlreadyPresent: 0,
    memoriesSkippedNoPerson: 0,
    conversationsImported: 0,
    conversationsAlreadyPresent: 0,
    conversationsSkippedNoPerson: 0,
    turnsImported: 0,
    turnsAlreadyPresent: 0,
    turnsSkippedSystemMessages: 0,
  };
}

/** "Never auto-created for children without a parent's pick" (the plan's
 * own words): derives an age band from the legacy user's own birthdate
 * (legacy has no child/teen/adult concept, only admin|user) using the
 * exact same computation the safety layer and the prompt already share
 * (lib/ageBand.ts) - a fabricated PersonRow carrying only role/birthdate
 * is enough, since speakerAgeBand() only ever reads those two fields. */
function legacyUserAgeBand(birthdate: string) {
  return speakerAgeBand({ role: "adult", birthdate } as unknown as PersonRow, new Date());
}

/** People matching (the plan: "matched by display name to existing
 * people, never auto-created for children without a parent's pick").
 * A legacy admin is imported as role "adult", the same as a legacy
 * "user" - promoting an imported profile to admin is left to the
 * owner's own People settings after review, not something this import
 * grants on its own (an admin profile the route (routes/people.ts) would
 * otherwise require a secret for, which this background import never
 * collects - creating one with no way to sign in would just be a
 * locked-out profile). Matching is case-insensitive on "first last",
 * legacy's own two name fields joined - the closest legacy analogue to
 * the new hub's single display_name field. */
function resolvePeople(legacyDb: Database, dryRun: boolean, counts: LegacyImportCounts, errors: string[]): PersonResolution[] {
  const legacyUsers = legacyDb
    .query("SELECT id, first_name, last_name, nickname, birthdate, role, dicebear_seed FROM users")
    .all() as LegacyUserRaw[];

  const existingByName = new Map<string, string>();
  for (const p of db.select({ id: people.id, displayName: people.displayName }).from(people).where(isNull(people.deletedAt)).all()) {
    existingByName.set(p.displayName.trim().toLowerCase(), p.id);
  }

  const results: PersonResolution[] = [];
  for (const u of legacyUsers) {
    const displayName = `${u.first_name} ${u.last_name}`.trim();
    const key = displayName.toLowerCase();
    const existingId = existingByName.get(key);
    if (existingId) {
      results.push({ legacyId: u.id, displayName, outcome: "matched_existing", personId: existingId });
      counts.peopleMatched++;
      continue;
    }

    if (legacyUserAgeBand(u.birthdate) !== "adult") {
      results.push({ legacyId: u.id, displayName, outcome: "skipped_needs_parent_pick", personId: null });
      counts.peopleSkippedMinor++;
      continue;
    }

    const newId = newPersonId();
    if (!dryRun) {
      const now = new Date().toISOString();
      const nickname = u.nickname.trim();
      const candidate = parsePersonCandidate({
        id: newId,
        display_name: displayName,
        nickname: nickname && nickname.toLowerCase() !== key ? nickname : null,
        birthdate: normalizeLegacyBirthdate(u.birthdate),
        role: "adult",
        avatar_seed: u.dicebear_seed ?? newId,
        source: "hub",
        local_only: false,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        hlc: nextHlc(),
        enabled: true,
        guest_expires_at: null,
        memorialized_at: null,
      });
      if (!candidate.success) {
        errors.push(`legacy user ${u.id} (${displayName}): ${candidate.error.issues.map((i) => i.message).join("; ")}`);
        continue;
      }
      db.insert(people).values(personToDbValues(candidate.data)).run();
    }
    // Recorded whether or not this is a dry run: a dry run's own
    // "would create" count still has to resolve every LATER legacy row
    // that references this same legacy user (their memories, their
    // conversations) to the same minted id, so counting stays coherent
    // within one run, and a second real run of the same database finds
    // this row for real via the name match above instead of minting a
    // second one.
    existingByName.set(key, newId);
    results.push({ legacyId: u.id, displayName, outcome: "created", personId: newId });
    counts.peopleCreated++;
  }
  return results;
}

/** Memories (the plan: "legacy `memories`, scopes mapped to person/
 * household, source: import:legacy:<id>, valid_from from created_at,
 * embedded on write"). Legacy's own three-way scoping collapses to two
 * here: `user_id` set (whether or not `character_id` is also set) maps
 * to scope "person" for that person - the new hub has no per-companion
 * memory concept to preserve the character_id distinction with, and the
 * fact is still genuinely about that real person either way. `user_id`
 * null (a "character-global" row, the companion's own knowledge with no
 * person attached at all) has nowhere else to go and maps to scope
 * "household", the plan's other named target. Only `status: 'active'`
 * rows are imported (superseded/archived legacy facts have no successor
 * chain worth reconstructing here - a deliberate simplification, not an
 * oversight). No `precomputed_embedding` is passed: `remember()`'s own
 * fire-and-forget embed-on-write computes a fresh vector against
 * whatever embedding backend this hub is actually running today, per
 * the plan's own "embedded on write" - legacy's stored nomic-embed-text
 * vector is never reused, since there's no guarantee it shares this
 * hub's embedding space. */
function importMemories(
  legacyDb: Database,
  actor: PersonRow,
  personByLegacyId: Map<string, string | null>,
  dryRun: boolean,
  counts: LegacyImportCounts,
  errors: string[],
): void {
  const rows = legacyDb
    .query("SELECT id, user_id, character_id, text, category, tier, status, importance, pinned, sensitive, created_at FROM memories WHERE status = 'active'")
    .all() as LegacyMemoryRaw[];

  // One batched lookup for every candidate's own source, not one query
  // per row (a code review, 2026-09-06, found the original version doing
  // exactly that) - the same "one round trip, not N" discipline
  // resolvePeople()'s own name-match lookup above already follows.
  const candidateSources = rows.map((row) => `import:legacy:memory:${row.id}`);
  const alreadyImportedSources =
    candidateSources.length > 0
      ? new Set(db.select({ source: memoryRecords.source }).from(memoryRecords).where(inArray(memoryRecords.source, candidateSources)).all().map((r) => r.source))
      : new Set<string>();

  for (const row of rows) {
    const source = `import:legacy:memory:${row.id}`;
    if (alreadyImportedSources.has(source)) {
      counts.memoriesAlreadyPresent++;
      continue;
    }

    let person: string | null = null;
    if (row.user_id) {
      const mapped = personByLegacyId.get(row.user_id);
      if (!mapped) {
        // undefined: a legacy user_id with no matching users row at all
        // (a foreign-key gap raw sqlite doesn't enforce). null: that
        // legacy user was skipped as a minor with no parent pick yet.
        // Both mean this memory has nowhere real to attach.
        counts.memoriesSkippedNoPerson++;
        continue;
      }
      person = mapped;
    }

    if (!isCategory(row.category)) {
      errors.push(`legacy memory ${row.id}: unknown category "${row.category}", skipped`);
      continue;
    }

    if (!dryRun) {
      const result = remember(actor, {
        record_kind: categoryToRecordKind(row.category),
        text: row.text,
        category: row.category,
        tier: row.tier,
        scope: person ? "person" : "household",
        person,
        source,
        importance: row.importance / 10,
        pinned: !!row.pinned,
        sensitive: !!row.sensitive,
        valid_from: legacyTsToIso(row.created_at),
      });
      if (!result.ok) {
        errors.push(`legacy memory ${row.id}: ${result.error}`);
        continue;
      }
    }
    counts.memoriesImported++;
  }
}

interface PairedTurn {
  userText: string;
  replyText: string;
  createdAt: number;
  anchorLegacyId: string;
}

/** Legacy's `messages` table is one row per role; the new hub's
 * `conversation_turns` is one row per completed exchange. Adjacent
 * user->assistant messages pair into one turn. A user message with no
 * following assistant reply (the conversation was cut off, or its would-
 * be reply was an inactive/discarded regenerate branch this import
 * already excludes via `active = 1`) becomes its own turn with
 * ORPHANED_REPLY_TEXT rather than being dropped - real history, just
 * half of it missing. An assistant message with no PRECEDING pending
 * user message (a proactive line with nothing to answer) becomes its
 * own turn with an empty userText, the mirror case. `system` messages
 * don't fit either half of this shape and are counted, not paired. */
function pairMessagesIntoTurns(messages: LegacyMessageRaw[], counts: LegacyImportCounts): PairedTurn[] {
  const turns: PairedTurn[] = [];
  let pendingUser: LegacyMessageRaw | null = null;
  for (const m of messages) {
    if (m.role === "system") {
      counts.turnsSkippedSystemMessages++;
      continue;
    }
    if (m.role === "user") {
      if (pendingUser) {
        turns.push({ userText: pendingUser.content, replyText: ORPHANED_REPLY_TEXT, createdAt: pendingUser.created_at, anchorLegacyId: pendingUser.id });
      }
      pendingUser = m;
    } else {
      if (pendingUser) {
        turns.push({ userText: pendingUser.content, replyText: m.content, createdAt: m.created_at, anchorLegacyId: m.id });
        pendingUser = null;
      } else {
        turns.push({ userText: "", replyText: m.content, createdAt: m.created_at, anchorLegacyId: m.id });
      }
    }
  }
  if (pendingUser) {
    turns.push({ userText: pendingUser.content, replyText: ORPHANED_REPLY_TEXT, createdAt: pendingUser.created_at, anchorLegacyId: pendingUser.id });
  }
  return turns;
}

/** Conversations and their turns (the plan: "legacy `messages` into
 * `conversations` and `conversation_turns`, per person"). Every imported
 * thread lands `status: "closed"` - a finished, historical archive, not
 * reopened as the person's current "chat" thread, which would otherwise
 * collide with resolveOrCreateConversation()'s own "most recently
 * active open conversation for this surface" pick the next time they
 * actually talk to the hub. A turn's own `source` is the literal string
 * "import" (never one of routingStats()'s own six known values, so an
 * imported turn is deliberately excluded from every one of its buckets -
 * correct, since it was never actually routed by this hub's router at
 * all, it's historical transcript from a different system). `judgeStatus:
 * "done"` for the same reason: these turns already have their real
 * memories imported directly (above), so the per-turn extraction job
 * must never re-run its own guesswork over years of imported history. */
function importConversations(
  legacyDb: Database,
  personByLegacyId: Map<string, string | null>,
  dryRun: boolean,
  counts: LegacyImportCounts,
  errors: string[],
): void {
  const convRows = legacyDb
    .query("SELECT id, user_id, title, created_at, updated_at FROM conversations WHERE temporary = 0 AND deleted_at IS NULL")
    .all() as LegacyConversationRaw[];

  const personRowCache = new Map<string, PersonRow | null>();
  function personRow(personId: string): PersonRow | null {
    if (!personRowCache.has(personId)) {
      personRowCache.set(personId, db.select().from(people).where(eq(people.id, personId)).get() ?? null);
    }
    return personRowCache.get(personId)!;
  }

  // Two passes, not one: the first resolves every conversation's own
  // person and pairs its messages into turns (reading the LEGACY database,
  // unavoidable per row - that's the source data, not an idempotency
  // lookup), then a single batched query per table checks which of the
  // resulting ids already exist on THIS hub. A code review (2026-09-06)
  // found the original version doing that existence check with one
  // `db.select` per conversation and per turn instead - fine at a
  // household's real conversation count, but a needless N round trips on
  // a re-run against a legacy database with a long chat history.
  interface Planned {
    conv: LegacyConversationRaw;
    personId: string;
    newConvId: string;
    turns: PairedTurn[];
  }
  const planned: Planned[] = [];
  for (const conv of convRows) {
    const personId = personByLegacyId.get(conv.user_id);
    if (!personId) {
      counts.conversationsSkippedNoPerson++;
      continue;
    }
    const messages = legacyDb
      .query("SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? AND active = 1 ORDER BY created_at ASC, rowid ASC")
      .all(conv.id) as LegacyMessageRaw[];
    planned.push({ conv, personId, newConvId: deterministicConversationId(conv.id), turns: pairMessagesIntoTurns(messages, counts) });
  }

  const existingConvIds =
    planned.length > 0
      ? new Set(
          db
            .select({ id: conversations.id })
            .from(conversations)
            .where(inArray(conversations.id, planned.map((p) => p.newConvId)))
            .all()
            .map((r) => r.id),
        )
      : new Set<string>();
  const allTurnIds = planned.flatMap((p) => p.turns.map((t) => deterministicTurnId(t.anchorLegacyId)));
  const existingTurnIds =
    allTurnIds.length > 0
      ? new Set(db.select({ id: conversationTurns.id }).from(conversationTurns).where(inArray(conversationTurns.id, allTurnIds)).all().map((r) => r.id))
      : new Set<string>();

  for (const { conv, personId, newConvId, turns } of planned) {
    const conversationAlreadyImported = existingConvIds.has(newConvId);
    if (conversationAlreadyImported) counts.conversationsAlreadyPresent++;
    else counts.conversationsImported++;

    if (!dryRun && !conversationAlreadyImported) {
      const createdIso = legacyTsToIso(conv.created_at)!;
      const updatedIso = legacyTsToIso(conv.updated_at) ?? createdIso;
      // safeParse, not parse (a code review, 2026-09-06): the original
      // version's throwing parse() had no per-row error handling, unlike
      // importMemories()/resolvePeople() - a single legacy row the spec
      // rejects (an over-length title, say) would crash the whole import
      // as an unhandled 500 instead of a clean per-row skip, and with
      // conversations already inserted earlier in the same run left
      // committed with no transaction wrapping either.
      const candidate = Conversation.safeParse({
        id: newConvId,
        person: personId,
        surface: "chat",
        companion_id: null,
        title: conv.title,
        status: "closed",
        summary: null,
        summary_through_turn: null,
        source: "hub",
        hlc: nextHlc(),
        created_at: createdIso,
        updated_at: updatedIso,
      });
      if (!candidate.success) {
        errors.push(`legacy conversation ${conv.id}: ${candidate.error.issues.map((i) => i.message).join("; ")}`);
        continue;
      }
      const record = candidate.data;
      db.insert(conversations)
        .values({
          id: record.id,
          personId: record.person,
          surface: record.surface,
          companionId: record.companion_id,
          title: record.title,
          status: record.status,
          summary: record.summary,
          summaryThroughTurn: record.summary_through_turn,
          source: record.source,
          pendingAsk: null,
          hlc: record.hlc,
          createdAt: record.created_at,
          updatedAt: record.updated_at,
        })
        .run();
    }

    for (const t of turns) {
      const turnId = deterministicTurnId(t.anchorLegacyId);
      if (existingTurnIds.has(turnId)) {
        counts.turnsAlreadyPresent++;
        continue;
      }
      if (!dryRun) {
        const createdIso = legacyTsToIso(t.createdAt)!;
        const person = personRow(personId);
        const minorSpeaker = person ? speakerAgeBand(person, new Date(createdIso)) !== "adult" : false;
        db.insert(conversationTurns)
          .values({
            id: turnId,
            personId,
            surface: "chat",
            conversationId: newConvId,
            userText: t.userText,
            replyText: t.replyText,
            source: "import",
            pluginId: null,
            commandId: null,
            safetyFlagged: false,
            safetyAction: "allow",
            minorSpeaker,
            createdAt: createdIso,
            routingTier: null,
            routingScore: null,
            judgeStatus: "done",
            judgeAttempts: 0,
            hlc: nextHlc(),
          })
          .run();
      }
      counts.turnsImported++;
    }
  }
}

export interface LegacyImportOptions {
  /** Absolute path to the legacy `app.db` file on this same machine -
   * a same-host migration tool, not an upload endpoint: the real run is
   * "Jesse's, on the hub" (the plan's own words), where the legacy file
   * already sits on disk next to (or inside) this same deployment. */
  dbPath: string;
  /** Defaults true: "a dry run reports counts first." A real import
   * (`dryRun: false`) additionally refuses outright unless at least one
   * backup already exists (below) - the plan's own "the route refuses
   * without one." */
  dryRun?: boolean;
}

export function runLegacyImport(actor: PersonRow, opts: LegacyImportOptions): LegacyImportResult {
  const dryRun = opts.dryRun ?? true;
  if (!existsSync(opts.dbPath)) {
    throw new LegacyImportError(`no such file: ${opts.dbPath}`);
  }
  if (!dryRun && listBackups().length === 0) {
    throw new LegacyImportError("refusing a real import with no backup on file yet - run a backup first (POST /api/backups/run)");
  }

  let legacyDb: Database;
  try {
    legacyDb = new Database(opts.dbPath, { readonly: true });
  } catch (err) {
    throw new LegacyImportError(`could not open ${opts.dbPath} as a database: ${(err as Error).message}`);
  }

  try {
    const counts = emptyCounts();
    const errors: string[] = [];
    const peopleResult = resolvePeople(legacyDb, dryRun, counts, errors);
    const personByLegacyId = new Map(peopleResult.map((p) => [p.legacyId, p.personId]));
    importMemories(legacyDb, actor, personByLegacyId, dryRun, counts, errors);
    importConversations(legacyDb, personByLegacyId, dryRun, counts, errors);
    return { dryRun, people: peopleResult, counts, errors };
  } finally {
    legacyDb.close();
  }
}
