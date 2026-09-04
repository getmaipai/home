// The memory store (platform plan 4.4): "One store, the spec shape, with
// judge, recall and maintenance." This is the core memory port; `remember`
// and `forget` as ways of asking will be a default skill package calling
// it once the package host (4.9) exists, but the store itself is core and
// usable directly today, the same way the safety layer's HTTP route
// stands in for the turn engine that doesn't exist yet (lib/safety.ts).
//
// What's built here and what's deferred is documented in
// docs/dev.md and repeated at the point it matters below; read that
// before extending this file.
import { eq, and, lt } from "drizzle-orm";
import { db } from "@/db";
import { memoryRecords, people } from "@/db/schema";
import { newMemoryRecordId } from "@/lib/memoryId";
import { toMemoryRecord } from "@/lib/memoryShape";
import { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import type { PersonRow, MemoryRecordRow } from "@/types";

export type MemoryOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string };

function isOwnerOrAdmin(actor: PersonRow): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

function rolesById(): Map<string, string> {
  const rows = db.select({ id: people.id, role: people.role }).from(people).all();
  return new Map(rows.map((r) => [r.id, r.role]));
}

// scope=self is "not shared with anyone" per the schema's own field
// description: no read path, however privileged, ever returns it. scope=
// person is visible to the person themself, or to owner/admin ONLY when
// the owning person is a child (parity with 4.14's conversation-visibility
// rule: a parent sees a child's, nothing of an adult's; teen support needs
// a summary mechanism that doesn't exist yet, so teens are treated like
// adults here for now, a deliberately conservative judgment call recorded
// in docs/dev.md). Sensitive household memories are owner/admin only.
function canRead(actor: PersonRow, record: MemoryRecordRow, roleOf: Map<string, string>): boolean {
  if (record.scope === "self") return false;
  if (record.scope === "person") {
    if (actor.id === record.person) return true;
    if (isOwnerOrAdmin(actor) && record.person && roleOf.get(record.person) === "child") {
      return true;
    }
    return false;
  }
  // household
  if (!record.sensitive) return true;
  return isOwnerOrAdmin(actor);
}

function assertCanWrite(
  actor: PersonRow,
  scope: string,
  person: string | null | undefined,
): MemoryOpResult<true> {
  if (scope === "self") {
    if (!isOwnerOrAdmin(actor)) {
      return { ok: false, status: 403, error: "only owner or admin may write self-scope memories" };
    }
    return { ok: true, value: true };
  }
  if (scope === "person") {
    if (!person) return { ok: false, status: 400, error: "person is required when scope is person" };
    if (actor.id !== person && !isOwnerOrAdmin(actor)) {
      return { ok: false, status: 403, error: "cannot write a memory scoped to another person" };
    }
    return { ok: true, value: true };
  }
  if (scope === "household") return { ok: true, value: true };
  return { ok: false, status: 400, error: `unknown scope: ${scope}` };
}

export interface RememberInput {
  record_kind?: "memory" | "entity" | "episode";
  text: string;
  category: string;
  tier: string;
  scope: string;
  person?: string | null;
  source: string;
  importance: number;
  pinned?: boolean;
  sensitive?: boolean;
  embedding_space?: string | null;
}

export function remember(actor: PersonRow, input: RememberInput): MemoryOpResult<MemoryRecord> {
  const scope = input.scope;
  const person = input.scope === "person" ? (input.person ?? null) : null;
  const auth = assertCanWrite(actor, scope, person);
  if (!auth.ok) return auth;

  const recordKind = input.record_kind ?? "memory";
  const now = new Date().toISOString();
  const candidate = {
    id: newMemoryRecordId(recordKind),
    record_kind: recordKind,
    text: input.text,
    category: input.category,
    tier: input.tier,
    status: "active",
    scope,
    person,
    source: input.source,
    importance: input.importance,
    pinned: input.pinned ?? false,
    sensitive: input.sensitive ?? false,
    uses: 0,
    created_at: now,
    last_used_at: now,
    valid_from: null,
    valid_to: null,
    expired_at: null,
    superseded_by: null,
    embedding_space: input.embedding_space ?? null,
  };

  // Validate against the spec BEFORE writing: the single source of truth
  // for what a valid record looks like is the generated Zod schema, not a
  // hand-kept second copy of its rules here.
  const parsed = MemoryRecord.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  db.insert(memoryRecords)
    .values({
      id: parsed.data.id,
      recordKind: parsed.data.record_kind,
      text: parsed.data.text,
      category: parsed.data.category,
      tier: parsed.data.tier,
      status: parsed.data.status,
      scope: parsed.data.scope,
      person: parsed.data.person,
      source: parsed.data.source,
      importance: parsed.data.importance,
      pinned: parsed.data.pinned,
      sensitive: parsed.data.sensitive,
      uses: parsed.data.uses,
      createdAt: parsed.data.created_at,
      lastUsedAt: parsed.data.last_used_at,
      validFrom: parsed.data.valid_from,
      validTo: parsed.data.valid_to,
      expiredAt: parsed.data.expired_at,
      supersededBy: parsed.data.superseded_by,
      embeddingSpace: parsed.data.embedding_space,
    })
    .run();

  return { ok: true, value: parsed.data };
}

export interface ListOptions {
  scope?: "household" | "person" | "self";
  person?: string;
}

/** Browsing: sorted, filtered, but never touches uses/last_used_at (that's
 * recall's job, see below: only an actual query "recalls" a memory). */
export function list(actor: PersonRow, opts: ListOptions = {}): MemoryRecord[] {
  const roleOf = rolesById();
  let rows = db.select().from(memoryRecords).where(eq(memoryRecords.status, "active")).all();
  if (opts.scope) rows = rows.filter((r) => r.scope === opts.scope);
  if (opts.person) rows = rows.filter((r) => r.person === opts.person);
  rows = rows.filter((r) => canRead(actor, r, roleOf));
  rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    return b.lastUsedAt.localeCompare(a.lastUsedAt);
  });
  return rows.slice(0, 100).map(toMemoryRecord);
}

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "to", "of", "in", "on", "at",
  "for", "and", "or", "my", "our", "your", "i", "we", "you", "it", "do", "does",
  "what", "who", "when", "where", "how", "with", "about",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

export interface RecallMatch {
  record: MemoryRecord;
  score: number;
}

// "Entity-first recall then scored vectors" (4.4). The "scored vectors"
// half needs an embedder (4.11, not built); this is the deterministic
// half: entity-first (does the query mention a known entity's name? if
// so, records mentioning that entity are boosted) then a keyword-overlap
// score as the fallback ranking, documented in docs/dev.md as a
// placeholder for real embedding-based scoring, not a claim of semantic
// search.
//
// The spec's entity shape has one free-text `text` field, not a separate
// `name`/`aliases` pair (unlike the legacy hub's entities table, which
// indexed real aliases, see docs/dev.md's review queue): the convention
// in spec/fixtures/records/memory-record.entity.example.json is "Name:
// description", so the entity's "name" here is approximated as the
// tokenized words of the clause before the first colon/period/comma.
// Matching is word-set containment (every name word present as a whole
// word), not a raw substring check, so a short entity name can't
// false-positive inside an unrelated longer word.
function entityNameWords(entityText: string): Set<string> {
  const firstClause = entityText.split(/[:.,]/, 1)[0] ?? "";
  return tokenize(firstClause);
}

export function recall(actor: PersonRow, query: string, opts: ListOptions = {}): RecallMatch[] {
  const roleOf = rolesById();
  let rows = db.select().from(memoryRecords).where(eq(memoryRecords.status, "active")).all();
  if (opts.scope) rows = rows.filter((r) => r.scope === opts.scope);
  if (opts.person) rows = rows.filter((r) => r.person === opts.person);
  rows = rows.filter((r) => canRead(actor, r, roleOf));

  const queryWords = tokenize(query);

  const matchedEntityNameWords: Set<string>[] = rows
    .filter((r) => r.recordKind === "entity")
    .map((r) => entityNameWords(r.text))
    .filter((nameWords) => nameWords.size > 0 && [...nameWords].every((w) => queryWords.has(w)));

  const scored: RecallMatch[] = [];
  for (const row of rows) {
    const words = tokenize(row.text);
    const overlap = [...queryWords].filter((w) => words.has(w)).length;
    const union = new Set([...queryWords, ...words]).size || 1;
    let score = overlap / union;
    if (matchedEntityNameWords.some((nameWords) => [...nameWords].every((w) => words.has(w)))) {
      score += 0.5;
    }
    if (score > 0) scored.push({ record: toMemoryRecord(row), score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 20);

  // Recalling touches usage, per 4.4's store lifecycle; browsing (list())
  // does not.
  const now = new Date().toISOString();
  for (const match of top) {
    db.update(memoryRecords)
      .set({ uses: match.record.uses + 1, lastUsedAt: now })
      .where(eq(memoryRecords.id, match.record.id))
      .run();
    match.record = { ...match.record, uses: match.record.uses + 1, last_used_at: now };
  }

  return top;
}

function getWritable(actor: PersonRow, id: string): MemoryOpResult<MemoryRecordRow> {
  const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get();
  if (!row) return { ok: false, status: 404, error: "memory record not found" };
  const auth = assertCanWrite(actor, row.scope, row.person);
  if (!auth.ok) return auth;
  return { ok: true, value: row };
}

/** Tombstone, never a hard delete (4.4's routine lifecycle): status ->
 * archived, expired_at stamped. The one hard delete is forget(), below. */
export function archive(actor: PersonRow, id: string): MemoryOpResult<MemoryRecord> {
  const found = getWritable(actor, id);
  if (!found.ok) return found;
  if (found.value.status !== "active") {
    return { ok: false, status: 400, error: `cannot archive a record with status ${found.value.status}` };
  }
  const now = new Date().toISOString();
  db.update(memoryRecords).set({ status: "archived", expiredAt: now }).where(eq(memoryRecords.id, id)).run();
  const updated = db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!;
  return { ok: true, value: toMemoryRecord(updated) };
}

export interface SupersedeInput {
  text: string;
  category?: string;
  tier?: string;
  importance?: number;
  pinned?: boolean;
  sensitive?: boolean;
  source: string;
}

/** Replace an active record with a new one carrying forward its scope and
 * person: the old record is retired (status superseded, expired_at
 * stamped, superseded_by pointing at the new row), never deleted. */
export function supersede(
  actor: PersonRow,
  oldId: string,
  input: SupersedeInput,
): MemoryOpResult<{ old: MemoryRecord; created: MemoryRecord }> {
  const found = getWritable(actor, oldId);
  if (!found.ok) return found;
  const old = found.value;
  if (old.status !== "active") {
    return { ok: false, status: 400, error: `cannot supersede a record with status ${old.status}` };
  }

  const created = remember(actor, {
    record_kind: old.recordKind as RememberInput["record_kind"],
    text: input.text,
    category: input.category ?? old.category,
    tier: input.tier ?? old.tier,
    scope: old.scope,
    person: old.person,
    source: input.source,
    importance: input.importance ?? old.importance,
    pinned: input.pinned ?? old.pinned,
    sensitive: input.sensitive ?? old.sensitive,
    embedding_space: old.embeddingSpace,
  });
  if (!created.ok) return created;

  const now = new Date().toISOString();
  db.update(memoryRecords)
    .set({ status: "superseded", expiredAt: now, supersededBy: created.value.id })
    .where(eq(memoryRecords.id, oldId))
    .run();
  const updatedOld = db.select().from(memoryRecords).where(eq(memoryRecords.id, oldId)).get()!;

  return { ok: true, value: { old: toMemoryRecord(updatedOld), created: created.value } };
}

function assertCanForgetOrExport(actor: PersonRow, personId: string): MemoryOpResult<true> {
  if (actor.id === personId || isOwnerOrAdmin(actor)) return { ok: true, value: true };
  return { ok: false, status: 403, error: "cannot forget or export another person's memories" };
}

/** The deliberate erasure right (2.2's privacy architecture:
 * "host.data.forget(person) is mandatory for person-scoped storage"),
 * distinct from the routine lifecycle above: this is a real DELETE, not a
 * tombstone. Only scope=person records for this person are touched;
 * household memories that happen to mention them are out of scope (a
 * much harder redaction problem, not attempted here). */
export function forget(actor: PersonRow, personId: string): MemoryOpResult<{ deleted: number }> {
  const auth = assertCanForgetOrExport(actor, personId);
  if (!auth.ok) return auth;
  const rows = db
    .select({ id: memoryRecords.id })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.scope, "person"), eq(memoryRecords.person, personId)))
    .all();
  for (const row of rows) {
    db.delete(memoryRecords).where(eq(memoryRecords.id, row.id)).run();
  }
  return { ok: true, value: { deleted: rows.length } };
}

/** Per-person export (4.14): every scope=person record about them,
 * whatever its status, so the archive is complete. */
export function exportPerson(actor: PersonRow, personId: string): MemoryOpResult<MemoryRecord[]> {
  const auth = assertCanForgetOrExport(actor, personId);
  if (!auth.ok) return auth;
  const rows = db
    .select()
    .from(memoryRecords)
    .where(and(eq(memoryRecords.scope, "person"), eq(memoryRecords.person, personId)))
    .all();
  return { ok: true, value: rows.map(toMemoryRecord) };
}

// Decay and archival (4.4). Adapted from the legacy hub's
// lib/memory/maintenance.ts (principle 8: a real, tuned decay formula
// from production use, not invented from scratch this pass): a
// Generative-Agents-style exponential recency decay, blended with
// importance and a gentle usage boost, gated by a minimum age so nothing
// archives just because it's briefly unpopular. No scheduler exists yet
// (4.7) to run this on a timer, so it's a manually-triggered pass for now
// (routes/memory.ts); the thresholds are a provisional default, not read
// from a real settings key, since the settings renderer (4.6) doesn't
// exist yet either.
//
// Two deliberate departures from the legacy source, both worth knowing:
// - **Durable memories are never touched by decay or the cap**, same as
//   legacy ("never touches durable memories"); this pass additionally
//   treats the spec's `observation` tier (which legacy didn't have) the
//   same as `episodic` for decay purposes, a judgment call: an ambient
//   sensor reading is at least as disposable as a conversational aside.
// - **No purge.** Legacy's file hard-deletes archived/superseded rows
//   after PURGE_AFTER_DAYS despite its own header comment claiming
//   nothing is hard-deleted; that's a real inconsistency in the legacy
//   code, not a pattern to carry forward. Platform plan 4.4 says the
//   store "never hard-deletes" outside the deliberate `forget()` erasure
//   right, so this pass takes that literally and leaves every tombstone
//   in place indefinitely. Revisit if unbounded archive growth becomes a
//   real storage problem once this runs on real households.
const DECAY_FACTOR = 0.995; // score = DECAY_FACTOR ^ hours-since-last-used
const ARCHIVE_SCORE_THRESHOLD = 0.1;
const ARCHIVE_MIN_AGE_DAYS = 30;
const EPISODIC_CAP_PER_SCOPE = 200;
const STATE_EXPIRY_DAYS = 7; // category "state" always expires hard after this, any tier

function decayScore(importance: number, uses: number, lastUsedAt: string): number {
  const hoursSince = (Date.now() - new Date(lastUsedAt).getTime()) / 3_600_000;
  const recency = Math.pow(DECAY_FACTOR, hoursSince);
  const usageBoost = 1 + Math.log1p(uses) * 0.1;
  return recency * importance * usageBoost; // importance is already 0-1 in this schema
}

export function runMaintenance(): { archived: number } {
  const now = new Date();
  const nowIso = now.toISOString();
  const minAgeCutoff = new Date(now.getTime() - ARCHIVE_MIN_AGE_DAYS * 86_400_000).toISOString();
  let archived = 0;

  const decaying = db
    .select()
    .from(memoryRecords)
    .where(and(eq(memoryRecords.status, "active"), eq(memoryRecords.pinned, false)))
    .all()
    .filter((r) => r.tier === "episodic" || r.tier === "observation");

  const byScope = new Map<string, MemoryRecordRow[]>();
  for (const row of decaying) {
    const key = `${row.scope}:${row.person ?? ""}`;
    const bucket = byScope.get(key) ?? [];
    bucket.push(row);
    byScope.set(key, bucket);
  }

  for (const rows of byScope.values()) {
    const scored = rows
      .map((row) => ({ row, score: decayScore(row.importance, row.uses, row.lastUsedAt) }))
      .sort((a, b) => b.score - a.score);

    const toArchive = new Set<string>();
    for (const s of scored) {
      if (s.score < ARCHIVE_SCORE_THRESHOLD && s.row.lastUsedAt < minAgeCutoff) {
        toArchive.add(s.row.id);
      }
    }
    const survivors = scored.filter((s) => !toArchive.has(s.row.id));
    if (survivors.length > EPISODIC_CAP_PER_SCOPE) {
      for (const excess of survivors.slice(EPISODIC_CAP_PER_SCOPE)) toArchive.add(excess.row.id);
    }
    for (const id of toArchive) {
      db.update(memoryRecords).set({ status: "archived", expiredAt: nowIso }).where(eq(memoryRecords.id, id)).run();
      archived++;
    }
  }

  // "state" memories (an ongoing situation, e.g. "stressed about a
  // deadline") expire hard after a week regardless of tier or score: the
  // future judge's promise that states auto-expire lives here, ported
  // ahead of the judge itself existing.
  const stateCutoff = new Date(now.getTime() - STATE_EXPIRY_DAYS * 86_400_000).toISOString();
  const staleStates = db
    .select({ id: memoryRecords.id })
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.status, "active"),
        eq(memoryRecords.pinned, false),
        eq(memoryRecords.category, "state"),
        lt(memoryRecords.createdAt, stateCutoff),
      ),
    )
    .all();
  for (const row of staleStates) {
    db.update(memoryRecords).set({ status: "archived", expiredAt: nowIso }).where(eq(memoryRecords.id, row.id)).run();
    archived++;
  }

  return { archived };
}

// Not built this pass, deliberately (see docs/dev.md):
// - Real "scored vectors" recall: needs the embed role (4.11).
// - The sleep-time judge itself (deciding WHAT to remember from a
//   conversation): needs an LLM (4.11) and the turn engine (4.5).
// - Profile paragraphs: LLM-synthesized summaries, same dependency.
// - Mood and unfinished-business reads (the robot's reflect jobs):
//   robot-specific, Robot v0.1.
