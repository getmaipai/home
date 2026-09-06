// The memory store (platform plan 4.4): "One store, the spec shape, with
// judge, recall and maintenance." This is the core memory port; `remember`
// and `forget` as ways of asking will be a default plugin package calling
// it once the package host (4.9) exists, but the store itself is core and
// usable directly today, the same way the safety layer's HTTP route
// stands in for the turn engine that doesn't exist yet (lib/safety.ts).
//
// What's built here and what's deferred is documented in
// docs/dev.md and repeated at the point it matters below; read that
// before extending this file.
import { eq, and, lt, isNull, inArray } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { memoryRecords, memoryEmbeddings, pendingEmbeddings, people } from "@/db/schema";
import { newMemoryRecordId } from "@/lib/memoryId";
import { toMemoryRecord } from "@/lib/memoryShape";
import { isOwnerOrAdmin, rolesById, canAccessPerson } from "@/lib/access";
import { tokenize } from "@/lib/text";
import { embed } from "@/lib/llm";
import { nextHlc } from "@/lib/hlc";
import { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import type { PersonRow, MemoryRecordRow } from "@/types";

export type MemoryOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string };

// scope=self is "not shared with anyone" per the schema's own field
// description: no read path, however privileged, ever returns it.
// Sensitive household memories are owner/admin only.
//
// `selfOnly` (session-a-intelligence.md step 2): the turn engine's own
// recall() call sets this true so a person-scope record is only ever
// readable when it's the ACTOR's own, regardless of role - never another
// person's, even a child's, even though canAccessPerson() would
// otherwise let an owner/admin through for the explicit parental-view
// case below. A parent's own casual conversation must never surface a
// child's private facts into the model's context; the explicit
// parental view (list()/recall() called with no selfOnly, the real
// "list route's parental view", unchanged) is the only sanctioned way
// to read someone else's person-scope memories.
function canRead(actor: PersonRow, record: MemoryRecordRow, roleOf: Map<string, string>, selfOnly = false): boolean {
  if (record.scope === "self") return false;
  if (record.scope === "person") {
    if (!record.person) return false;
    if (selfOnly) return record.person === actor.id;
    return canAccessPerson(actor, record.person, roleOf);
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
  /** When the fact became/stopped being true (step 6, session-a-
   * intelligence.md: "trips and states stored as dated `state` with
   * `valid_to` when known"). Both spec fields have existed on
   * MemoryRecord since it shipped, but remember() always wrote null for
   * both until the judge needed to write a real one. */
  valid_from?: string | null;
  valid_to?: string | null;
  /** Skips remember()'s own embed() round trip when the caller already
   * has a real vector for this EXACT text (lib/memoryJudge.ts's judge:
   * it already embeds a candidate fact once for its own dedupe search,
   * before deciding whether to remember() it - a code review, 2026-09-05,
   * found remember() was blindly re-embedding the identical text a
   * second time). Only safe when the vector was computed for precisely
   * the text being stored. */
  precomputed_embedding?: { space: string; vector: readonly number[] };
}

export function remember(actor: PersonRow, input: RememberInput): MemoryOpResult<MemoryRecord> {
  const scope = input.scope;
  const person = input.scope === "person" ? (input.person ?? null) : null;
  const auth = assertCanWrite(actor, scope, person);
  if (!auth.ok) return auth;

  // Checked here, not left to the SQLite foreign key: a code review
  // (2026-09-04) found an owner/admin writing scope=person with a typo'd
  // personId reached the FK constraint at insert time and got a raw,
  // uncaught "FOREIGN KEY constraint failed" 500 instead of a clean 400.
  // Only needed for the owner/admin path (assertCanWrite already proved
  // actor.id === person on the self-write path, and an authenticated
  // actor always exists). Excludes soft-deleted people too (a follow-up
  // review found the first cut of this check didn't), matching the
  // deletedAt-awareness this same pass added to resolveSession() and
  // /verify-secret: a deleted person is not a valid write target either.
  if (person && person !== actor.id) {
    const exists = db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, person), isNull(people.deletedAt)))
      .get();
    if (!exists) return { ok: false, status: 400, error: `person not found: ${person}` };
  }

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
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
    expired_at: null,
    superseded_by: null,
    embedding_space: input.embedding_space ?? null,
    hlc: nextHlc(),
    deleted_at: null,
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
      hlc: parsed.data.hlc,
      deletedAt: parsed.data.deleted_at,
    })
    .run();

  // Step 5: embed on write, fire-and-forget - a real embed() call is
  // real I/O (network or local inference), and remember() itself must
  // never wait on it or fail because of it. A backend that's down
  // queues the id for the retry job below instead of losing the vector
  // forever. A caller that already has a real vector for this exact
  // text (input.precomputed_embedding) skips the round trip entirely -
  // storeEmbedding() itself is synchronous DB work, not I/O, so this
  // branch completes before remember() returns rather than racing it.
  if (input.precomputed_embedding) {
    storeEmbedding(parsed.data.id, input.precomputed_embedding.space, input.precomputed_embedding.vector);
  } else {
    void embedMemoryRecordSafely(parsed.data.id, parsed.data.text);
  }

  return { ok: true, value: parsed.data };
}

// ==== Step 5: the vector store ====

const EMBEDDING_DIMENSION_BYTES = 4; // Float32

function vectorToBuffer(vector: readonly number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

function bufferToVector(buffer: Buffer): Float32Array {
  // Copy into a fresh, aligned ArrayBuffer: bun:sqlite's own Buffer can
  // start at a non-4-byte-aligned offset into a shared backing store,
  // which a raw Float32Array view over it would silently misread.
  const aligned = new Uint8Array(buffer.length);
  aligned.set(buffer);
  return new Float32Array(aligned.buffer, 0, buffer.length / EMBEDDING_DIMENSION_BYTES);
}

/** Best-effort: embeds one record's text and stores the vector, or
 * queues the id for retry when the embed backend is unavailable. Never
 * throws, and never lets an UNHANDLED rejection escape this fire-and-
 * forget call either - the one contract every post-write side effect in
 * this codebase holds (logTurn()'s own "never turns a successful
 * generation into a reported failure", extended here to "never turns a
 * successful remember() into one either"). This runs unawaited
 * (`remember()`'s own `void embedMemoryRecordSafely(...)`), so by the
 * time it resolves the record it's about could already be gone (forgot,
 * a fast-following test's own reset) - storeEmbedding()/
 * queueForEmbedding() each catch that themselves rather than letting a
 * second, later exception from INSIDE this function's own catch block
 * turn into the unhandled rejection this whole function exists to
 * prevent. */
export async function embedMemoryRecordSafely(memoryId: string, text: string): Promise<void> {
  try {
    const result = await embed([text]);
    if (!result.ok) {
      queueForEmbedding(memoryId);
      return;
    }
    storeEmbedding(memoryId, result.value.model, result.value.vectors[0]!);
  } catch (err) {
    console.error(`[memory] embed-on-write failed for ${memoryId}, queued for retry: ${(err as Error).message}`);
    queueForEmbedding(memoryId);
  }
}

function storeEmbedding(memoryId: string, space: string, vector: readonly number[]): void {
  try {
    const row = { memoryId, space, dims: vector.length, vector: vectorToBuffer(vector), hlc: nextHlc() };
    db.insert(memoryEmbeddings)
      .values(row)
      .onConflictDoUpdate({ target: memoryEmbeddings.memoryId, set: row })
      .run();
    db.update(memoryRecords).set({ embeddingSpace: space, hlc: nextHlc() }).where(eq(memoryRecords.id, memoryId)).run();
    db.delete(pendingEmbeddings).where(eq(pendingEmbeddings.memoryId, memoryId)).run();
  } catch (err) {
    // The record itself is gone by now (forgot, or a test's resetDb()
    // ran before this fire-and-forget callback got to run) - nothing
    // left to attach a vector to, not a real failure.
    console.error(`[memory] could not store embedding for ${memoryId} (likely already gone): ${(err as Error).message}`);
  }
}

function queueForEmbedding(memoryId: string): void {
  try {
    db.insert(pendingEmbeddings)
      .values({ memoryId, queuedAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run();
  } catch (err) {
    console.error(`[memory] could not queue ${memoryId} for embedding retry (likely already gone): ${(err as Error).message}`);
  }
}

/** The retry job (step 5: "a core job retries every minute"). One
 * batched `embed()` call for every still-live row, not one round trip
 * per row (a code review, 2026-09-05, found this awaiting `embed()`
 * one row at a time even though it already accepts an array - the same
 * "one batched query, not one per row" discipline recall()'s own vector
 * fetch already applies): a failure or an outage takes the whole batch
 * down together, so every row simply stays queued for the next tick,
 * the same "never retried forever, never blocks the rest" outcome the
 * per-row version had. A record that's been superseded/archived/
 * forgotten since being queued (or one whose text somehow no longer
 * exists) is dropped rather than retried forever, checked before the
 * batch is built so its text never has to round-trip to the embedder
 * at all. */
export async function drainPendingEmbeddings(): Promise<{ embedded: number; stillPending: number }> {
  const pending = db.select().from(pendingEmbeddings).all();
  const live: { id: string; text: string }[] = [];
  for (const row of pending) {
    const record = db.select().from(memoryRecords).where(eq(memoryRecords.id, row.memoryId)).get();
    if (!record) {
      db.delete(pendingEmbeddings).where(eq(pendingEmbeddings.memoryId, row.memoryId)).run();
      continue;
    }
    live.push({ id: record.id, text: record.text });
  }

  let embedded = 0;
  if (live.length > 0) {
    try {
      const result = await embed(live.map((r) => r.text));
      if (result.ok) {
        live.forEach((r, i) => {
          storeEmbedding(r.id, result.value.model, result.value.vectors[i]!);
          embedded++;
        });
      } // else: still down; every row stays queued for the next tick
    } catch (err) {
      console.error(`[memory] pending-embedding retry batch failed: ${(err as Error).message}`);
    }
  }
  const stillPending = db.select().from(pendingEmbeddings).all().length;
  return { embedded, stillPending };
}

export interface ListOptions {
  scope?: "household" | "person" | "self";
  person?: string;
  /** See canRead()'s own comment: turn-scoped recall only, never the
   * parental-view routes. */
  selfOnly?: boolean;
}

/** Browsing: sorted, filtered, but never touches uses/last_used_at (that's
 * recall's job, see below: only an actual query "recalls" a memory). */
export function list(actor: PersonRow, opts: ListOptions = {}): MemoryRecord[] {
  const roleOf = rolesById();
  let rows = db.select().from(memoryRecords).where(eq(memoryRecords.status, "active")).all();
  if (opts.scope) rows = rows.filter((r) => r.scope === opts.scope);
  if (opts.person) rows = rows.filter((r) => r.person === opts.person);
  rows = rows.filter((r) => canRead(actor, r, roleOf, opts.selfOnly));
  rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    return b.lastUsedAt.localeCompare(a.lastUsedAt);
  });
  return rows.slice(0, 100).map(toMemoryRecord);
}

export interface RecallMatch {
  record: MemoryRecord;
  score: number;
}

// "Entity-first recall then scored vectors" (4.4), real as of step 5:
// entity-first (does the query mention a known entity's name? if so,
// records mentioning that entity are boosted, and bypass the cosine
// floor below the same way a pinned record does) then real cosine
// similarity over each candidate's stored embedding (memory_embeddings,
// `embedMemoryRecordSafely()` above) when both a query vector and a
// stored one exist. Keyword overlap is now only the fallback for a
// record with no vector yet (queued, embed backend down) or a caller
// with no query vector to score against - the placeholder every score
// used to be, before this step.
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

export interface RecallOptions extends ListOptions {
  /** Whether recall() bumps uses/last_used_at on the records it returns.
   * Defaults to true: the direct recall API and the `recall` package
   * (a result someone actually asked for and got back counts as
   * "used"). The turn engine (turnEngine.ts) sets this false and bumps
   * only the subset that actually reached the model's prompt
   * (buildSystemPrompt's MAX_MEMORY_SNIPPETS truncation), via the
   * separate bumpUsage() below - not every scored candidate above
   * recall()'s own top-20 cutoff (step 2: "uses/last_used_at bump only
   * on records that reached the prompt"). */
  bumpUsage?: boolean;
  /** The query's own embedding (step 5), pre-computed by the caller:
   * recall() itself stays synchronous (pure scoring given a vector it's
   * handed is CPU work, not I/O), so any caller that can afford the
   * async embed() round trip (turnEngine.ts's prepareTurn, already
   * async; packageHost.ts's Host.memory.recall, made async for exactly
   * this) computes it first. Omitted (or when the embed backend is
   * down) falls back to keyword overlap for every candidate - the exact
   * placeholder behavior this step replaces, kept as the real fallback
   * it always was. */
  queryVector?: Float32Array;
}

// Legacy's tuned values (ported verbatim, session-a-intelligence.md step
// 5's own instruction - "record that they must be re-measured on the
// bench before v0.1"; see docs/dev.md's bench-script entry for the
// pointer): 0.7/0.2/0.1 weights, floors of 0.55 for episodic and 0.37
// for durable, a hyperbolic recency decay (0.05/day) that durable
// records skip entirely (recency 1.0, unchanging - a durable fact's
// value doesn't fade with age the way an episodic aside's does). The
// spec's third tier, "observation", has no legacy counterpart; treated
// as episodic here, the same judgment call runMaintenance()'s own decay
// logic already made for the identical reason.
const COSINE_WEIGHT = 0.7;
const IMPORTANCE_WEIGHT = 0.2;
const RECENCY_WEIGHT = 0.1;
const RECENCY_DECAY_PER_DAY = 0.05;
const EPISODIC_MIN_COSINE = 0.55;
const DURABLE_MIN_COSINE = 0.37;

function minCosineForTier(tier: string): number {
  return tier === "durable" ? DURABLE_MIN_COSINE : EPISODIC_MIN_COSINE;
}

function recencyScore(tier: string, createdAt: string, nowMs: number): number {
  if (tier === "durable") return 1.0;
  const ageDays = Math.max(0, (nowMs - new Date(createdAt).getTime()) / 86_400_000);
  return 1 / (1 + ageDays * RECENCY_DECAY_PER_DAY);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0; // a dimension mismatch (a model change mid-household) is "no match," not a crash
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Best-effort query embedding for recall() callers (step 5): embeds
 * `query` and returns the vector, or `undefined` on ANY failure (no
 * embed backend, a down one, a malformed response) - recall() itself
 * already treats a missing queryVector as "fall back to keyword
 * overlap," so a caller never needs its own try/catch around this.
 * Shared by turnEngine.ts's prepareTurn() and packageHost.ts's
 * Host.memory.recall, the two real async callers. Legacy applies no
 * query/passage instruction prefix (confirmed against the mirror), so
 * neither does this - the raw text, same as what's embedded on write. */
export async function embedQueryForRecall(query: string): Promise<Float32Array | undefined> {
  try {
    const result = await embed([query]);
    if (!result.ok) return undefined;
    return new Float32Array(result.value.vectors[0]!);
  } catch {
    return undefined;
  }
}

/** Shared by recall()'s default behavior and turnEngine.ts's own
 * turn-scoped call: bumps uses/last_used_at on exactly these matches,
 * mutating each match's own `record` in place so a caller that already
 * has the returned array sees the updated count without a re-read.
 * Deliberately does NOT stamp a fresh hlc (step 10): hlc exists to
 * resolve conflicts on a record's own synced CONTENT, and a usage bump
 * happens purely from a local recall touching the record - stamping it
 * here would make an ordinary read look like a newer edit than a
 * genuinely concurrent real change to the record's text/status/tier,
 * defeating the comparison hlc exists to make correct. */
function bumpMatchUsage(matches: RecallMatch[]): void {
  const now = new Date().toISOString();
  for (const match of matches) {
    db.update(memoryRecords)
      .set({ uses: match.record.uses + 1, lastUsedAt: now })
      .where(eq(memoryRecords.id, match.record.id))
      .run();
    match.record = { ...match.record, uses: match.record.uses + 1, last_used_at: now };
  }
}

export function recall(actor: PersonRow, query: string, opts: RecallOptions = {}): RecallMatch[] {
  const roleOf = rolesById();
  let rows = db.select().from(memoryRecords).where(eq(memoryRecords.status, "active")).all();
  // Never the profile paragraph: turnEngine.ts's buildSystemPrompt()
  // already injects it unconditionally via getProfileParagraph(), "not
  // a recall() candidate... never something that competes with other
  // facts for a cosine-scored slot" (step 7's own design). Without this
  // exclusion, its own `pinned: true` sets `forceInclude` below and it
  // would surface a SECOND time as an ordinary scored match - a
  // post-hoc review (2026-09-05) found this duplicate-injection bug,
  // the read-side twin of the dedupe-candidate bug similarByVector()
  // below has the identical fix for.
  rows = rows.filter((r) => r.source !== PROFILE_SOURCE);
  if (opts.scope) rows = rows.filter((r) => r.scope === opts.scope);
  if (opts.person) rows = rows.filter((r) => r.person === opts.person);
  rows = rows.filter((r) => canRead(actor, r, roleOf, opts.selfOnly));

  const queryWords = tokenize(query);

  const matchedEntityNameWords: Set<string>[] = rows
    .filter((r) => r.recordKind === "entity")
    .map((r) => entityNameWords(r.text))
    .filter((nameWords) => nameWords.size > 0 && [...nameWords].every((w) => queryWords.has(w)));

  // One batched query for every candidate's stored vector, not one per
  // row (household scale is "hundreds of rows" per the plan's own
  // words, brute-force cosine in JS, but still one round trip).
  const vectorRows =
    rows.length > 0
      ? db
          .select()
          .from(memoryEmbeddings)
          .where(inArray(memoryEmbeddings.memoryId, rows.map((r) => r.id)))
          .all()
      : [];
  const vectorsByMemoryId = new Map(vectorRows.map((v) => [v.memoryId, bufferToVector(v.vector)]));
  const nowMs = Date.now();

  const scored: RecallMatch[] = [];
  for (const row of rows) {
    const words = tokenize(row.text);
    const isEntityMatch = matchedEntityNameWords.some((nameWords) => [...nameWords].every((w) => words.has(w)));
    const storedVector = vectorsByMemoryId.get(row.id);

    // Pinned and entity-matched candidates are deterministic overrides
    // that always surface, regardless of what cosine or keyword scoring
    // comes back with (pinned: the household said "always surface
    // this"; entity match: "keep the entity-name boost" - the plan's
    // own words for the exact same treatment this file already gave it
    // before any vector existed). Real cosine similarity can be
    // negative (unlike keyword overlap, which is always >= 0), so a
    // code review (2026-09-05) found that the plain `score > 0` filter
    // below could silently drop one of these overrides anyway when its
    // cosine came back negative enough to pull the whole weighted score
    // under zero - forceInclude keeps the override real all the way to
    // the final push, not just past the floor check.
    const forceInclude = row.pinned || isEntityMatch;

    let score: number;
    if (opts.queryVector && storedVector) {
      const cosine = cosineSimilarity(opts.queryVector, storedVector);
      // The floor excludes outright, it doesn't down-weight (legacy's
      // real behavior, confirmed against the mirror rather than
      // assumed): a candidate below its tier's floor never enters the
      // ranking at all, UNLESS it's pinned or an entity match.
      if (!forceInclude && cosine < minCosineForTier(row.tier)) continue;
      const recency = recencyScore(row.tier, row.createdAt, nowMs);
      score = COSINE_WEIGHT * cosine + IMPORTANCE_WEIGHT * row.importance + RECENCY_WEIGHT * recency;
    } else {
      // Keyword fallback: no query vector (embed backend down) or no
      // stored vector yet for this record (just written, still queued
      // in pending_embeddings) - the exact placeholder this step's
      // predecessor used for every record, now only for the ones that
      // genuinely have no vector to score against. Floors don't apply
      // here: they're a vector-quality gate with nothing to gate
      // without one.
      const overlap = [...queryWords].filter((w) => words.has(w)).length;
      const union = new Set([...queryWords, ...words]).size || 1;
      score = overlap / union;
    }
    if (isEntityMatch) score += 0.5;
    if (forceInclude || score > 0) scored.push({ record: toMemoryRecord(row), score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 20);

  // Recalling touches usage, per 4.4's store lifecycle; browsing (list())
  // does not. Skippable (see RecallOptions.bumpUsage's own comment) for
  // the turn engine's own call, which bumps only what actually reached
  // the prompt instead of every one of these top 20 candidates.
  if (opts.bumpUsage !== false) bumpMatchUsage(top);

  return top;
}

/** Exported for turnEngine.ts's turn-scoped call: bumps usage only on the
 * records that actually reached the model's prompt (buildSystemPrompt's
 * own MAX_MEMORY_SNIPPETS truncation of recall()'s top-20 candidates),
 * per step 2's "bump only on records that reached the prompt." */
export function bumpUsage(matches: RecallMatch[]): void {
  bumpMatchUsage(matches);
}

/** Dedupe's own cosine floor (step 6, session-a-intelligence.md: "compare
 * with the actor's readable records at cosine 0.5, look at the top 5"),
 * separate from recall()'s tier floors above: dedupe asks a completely
 * different question ("is this the same fact as something already
 * stored," any tier, any category) than recall does ("is this worth
 * putting in front of the model right now"), so it gets its own
 * threshold rather than reusing EPISODIC_MIN_COSINE/DURABLE_MIN_COSINE. */
const DEDUPE_MIN_COSINE = 0.5;
const DEDUPE_TOP_N = 5;

export interface SimilarMatch {
  record: MemoryRecord;
  cosine: number;
}

/** The memory judge's own lookup (lib/memoryJudge.ts): plain top-N cosine
 * similarity over every ACTIVE record the actor can read, no keyword
 * fallback and no entity/pinned override - unlike recall(), a candidate
 * with no stored vector yet simply can't be compared and is skipped
 * (a judge run always has a real vector for the fact it just embedded;
 * a target with none yet is definitionally not a match for anything).
 * Never touches uses/last_used_at: being a dedupe candidate isn't "used"
 * the way an actual recall answer is. */
export function similarByVector(actor: PersonRow, vector: Float32Array, opts: ListOptions = {}): SimilarMatch[] {
  const roleOf = rolesById();
  let rows = db.select().from(memoryRecords).where(eq(memoryRecords.status, "active")).all();
  // Never an entity record: "Rover: a family friend" and a plain fact
  // are different KINDS of content (entityNameWords()'s own "Name:
  // description" convention vs. free-text prose), so comparing one
  // against the other for dedupe makes no sense - and a code review
  // (2026-09-05) found that without this filter, a fact whose embedding
  // happened to cross DEDUPE_MIN_COSINE against an existing entity
  // record could get SUPERSEDEd onto it, corrupting the household's
  // actual entity registry with plain-fact text that recall()'s own
  // entity-match boost would then silently stop recognizing.
  rows = rows.filter((r) => r.recordKind !== "entity");
  // Never the profile paragraph either: a post-hoc review (2026-09-05)
  // found this filter only excluded entity records, not source ===
  // PROFILE_SOURCE, so the judge's own dedupe pass could select a
  // person's profile paragraph as a merge/SUPERSEDE candidate and
  // overwrite it with an ordinary judge-authored fact under the turn's
  // own source - exactly the "written and rewritten only by consolidate,
  // never by the extractor" invariant step 7 exists to hold, broken by
  // the one lookup that wasn't taught about it.
  rows = rows.filter((r) => r.source !== PROFILE_SOURCE);
  if (opts.scope) rows = rows.filter((r) => r.scope === opts.scope);
  if (opts.person) rows = rows.filter((r) => r.person === opts.person);
  rows = rows.filter((r) => canRead(actor, r, roleOf, opts.selfOnly));

  const vectorRows =
    rows.length > 0
      ? db
          .select()
          .from(memoryEmbeddings)
          .where(inArray(memoryEmbeddings.memoryId, rows.map((r) => r.id)))
          .all()
      : [];
  const vectorsByMemoryId = new Map(vectorRows.map((v) => [v.memoryId, bufferToVector(v.vector)]));

  const scored: SimilarMatch[] = [];
  for (const row of rows) {
    const stored = vectorsByMemoryId.get(row.id);
    if (!stored) continue;
    const cosine = cosineSimilarity(vector, stored);
    if (cosine >= DEDUPE_MIN_COSINE) scored.push({ record: toMemoryRecord(row), cosine });
  }
  scored.sort((a, b) => b.cosine - a.cosine);
  return scored.slice(0, DEDUPE_TOP_N);
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
  db.update(memoryRecords).set({ status: "archived", expiredAt: now, hlc: nextHlc() }).where(eq(memoryRecords.id, id)).run();
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
  /** The NEW record's own dated bounds (e.g. a dated state/trip fact
   * that happened to dedupe-match an existing similar record) - distinct
   * from SupersedeOptions.closeValidTo below, which is about the OLD
   * record. Omitted (the default) means the new record gets null for
   * both, same as a bare remember(). */
  valid_from?: string | null;
  valid_to?: string | null;
}

export interface SupersedeOptions {
  /** Set when the OLD record is being retired because the fact it stated
   * is now false (a contradiction), not merely refined - the memory
   * judge's own distinction (step 6, session-a-intelligence.md: "a
   * contradiction supersedes and closes valid_to on the old record"),
   * distinct from expired_at (when we retired the row, stamped
   * unconditionally below) which records when it STOPPED BEING TRUE. */
  closeValidTo?: string;
}

/** Replace an active record with a new one carrying forward its scope and
 * person: the old record is retired (status superseded, expired_at
 * stamped, superseded_by pointing at the new row), never deleted. */
export function supersede(
  actor: PersonRow,
  oldId: string,
  input: SupersedeInput,
  opts: SupersedeOptions = {},
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
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
  });
  if (!created.ok) return created;

  const now = new Date().toISOString();
  db.update(memoryRecords)
    .set({
      status: "superseded",
      expiredAt: now,
      supersededBy: created.value.id,
      hlc: nextHlc(),
      ...(opts.closeValidTo ? { validTo: opts.closeValidTo } : {}),
    })
    .where(eq(memoryRecords.id, oldId))
    .run();
  const updatedOld = db.select().from(memoryRecords).where(eq(memoryRecords.id, oldId)).get()!;

  return { ok: true, value: { old: toMemoryRecord(updatedOld), created: created.value } };
}

function assertCanForgetOrExport(actor: PersonRow, personId: string): MemoryOpResult<true> {
  if (canAccessPerson(actor, personId, rolesById())) return { ok: true, value: true };
  return { ok: false, status: 403, error: "cannot forget or export another person's memories" };
}

// Step 10 (session-a-intelligence.md): what a tombstoned record's own
// `text` becomes. `text` keeps memory-record.schema.json's `minLength: 1`
// (relaxing it to allow "" for every record just to cover this one path
// would weaken the schema's own guarantee for every ACTIVE record, most
// of which have no business ever having empty text), so a real, fixed,
// never-a-real-fact sentinel stands in for "the actual content is gone" -
// the same shape a person's own tombstone keeps display_name but wipes
// nickname/birthdate (personLifecycle.ts's own erasePersonData()).
export const TOMBSTONE_TEXT = "[forgotten]";

/** The deliberate erasure right (2.2's privacy architecture:
 * "host.data.forget(person) is mandatory for person-scoped storage").
 * Tombstones as of step 10, not a real DELETE: `status` becomes
 * `archived`, `text` and `embedding_space` are wiped, `deleted_at` is
 * set, and the row itself is kept - a hard delete cannot be told apart
 * from "never existed" once a robot or a second hub can sync, so a
 * device offline during the forget could resurrect the record right
 * back once it reconnects. Only scope=person records for this person are
 * touched; household memories that happen to mention them are out of
 * scope (a much harder redaction problem, not attempted here). */
export function forget(actor: PersonRow, personId: string): MemoryOpResult<{ deleted: number }> {
  const auth = assertCanForgetOrExport(actor, personId);
  if (!auth.ok) return auth;
  const forgotten = forgetTransaction(personId);
  return { ok: true, value: { deleted: forgotten } };
}

const forgetTransaction = sqlite.transaction((personId: string): number => {
  // Step 5: memory_embeddings/pending_embeddings both carry a real FK to
  // memory_records.id; the vector store itself isn't spec-synced
  // content (memory-record.schema.json's own comment: "the embedding
  // vector itself is never part of this record and never syncs"), so
  // it's really gone, not tombstoned, same as before this step.
  sqlite
    .query(
      "DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE scope = 'person' AND person = ?)",
    )
    .run(personId);
  sqlite
    .query(
      "DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE scope = 'person' AND person = ?)",
    )
    .run(personId);
  const ids = sqlite.query("SELECT id FROM memory_records WHERE scope = 'person' AND person = ?").all(personId) as {
    id: string;
  }[];
  const now = new Date().toISOString();
  // One UPDATE per row, not a single bulk statement, so each tombstone
  // gets its own genuinely unique hlc (nextHlc()'s counter only advances
  // on each real call) - the identical "a flat shared stamp defeats hlc's
  // whole point" fix a code review already found necessary for migration
  // 0010's own conversations backfill. Household scale (a person's own
  // memories, not the whole store) keeps this cheap.
  for (const row of ids) {
    sqlite
      .query("UPDATE memory_records SET status = 'archived', text = ?, embedding_space = NULL, deleted_at = ?, hlc = ? WHERE id = ?")
      .run(TOMBSTONE_TEXT, now, nextHlc(), row.id);
  }
  return ids.length;
});

/** Per-person export (4.14): every scope=person record about them,
 * whatever its status, so the archive is complete - EXCEPT a tombstone
 * (step 10: `deleted_at` set): its content is already wiped, so
 * returning it would only show `TOMBSTONE_TEXT` back to the person who
 * just asked to forget it, looking exactly like the erasure didn't
 * actually happen. */
export function exportPerson(actor: PersonRow, personId: string): MemoryOpResult<MemoryRecord[]> {
  const auth = assertCanForgetOrExport(actor, personId);
  if (!auth.ok) return auth;
  const rows = db
    .select()
    .from(memoryRecords)
    .where(and(eq(memoryRecords.scope, "person"), eq(memoryRecords.person, personId), isNull(memoryRecords.deletedAt)))
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
      db.update(memoryRecords).set({ status: "archived", expiredAt: nowIso, hlc: nextHlc() }).where(eq(memoryRecords.id, id)).run();
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
    db.update(memoryRecords).set({ status: "archived", expiredAt: nowIso, hlc: nextHlc() }).where(eq(memoryRecords.id, row.id)).run();
    archived++;
  }

  return { archived };
}

// ==== Step 6: primitives for lib/memoryJudge.ts's consolidate pass ====
//
// Both of these are unconditional system sweeps, no actor - the same
// shape runMaintenance() above already has, and for the identical
// reason: a weekly consolidation pass isn't any one person's write
// request, it's household-wide lifecycle management. The LLM-touching
// orchestration (grouping candidates, calling the model to decide a
// contradiction) lives in lib/memoryJudge.ts, not here - this file stays
// the "dumb, mechanical" half of memory lifecycle, matching the
// judge/store split runMaintenance()'s own trailer already documents.

/** Batched vector lookup with no actor/canRead filtering - the caller
 * already has the ids it wants (from its own already-authorized query)
 * and just needs their vectors, the same access similarByVector() above
 * already grants indirectly through recall-shaped calls. */
export function vectorsFor(ids: string[]): Map<string, Float32Array> {
  if (ids.length === 0) return new Map();
  const rows = db.select().from(memoryEmbeddings).where(inArray(memoryEmbeddings.memoryId, ids)).all();
  return new Map(rows.map((r) => [r.memoryId, bufferToVector(r.vector)]));
}

export { cosineSimilarity };

/** Retires an ACTIVE record in favor of one that already exists (unlike
 * supersede(), which always creates a brand-new record) - consolidate's
 * own contradiction pass: the newer of two contradicting durable facts
 * is already a fully valid record, so the older one just needs to point
 * at it, not spawn a third row saying the same thing again. `closeValidTo`
 * mirrors supersede()'s own SupersedeOptions for the identical reason:
 * a contradiction means the old fact stopped being true, not merely that
 * we stopped caring about it. */
/** Returns whether the row was actually retired: false when `oldId` is
 * no longer `active` by the time this runs (already superseded earlier
 * in the same sweep, or forgotten/archived through a concurrent request
 * this background job doesn't otherwise coordinate with) - a code
 * review (2026-09-05) found the original version wrote unconditionally
 * by id alone, unlike supersede() above (which requires `active` before
 * proceeding), so a record already retired could be silently overwritten
 * a second time. Raw sqlite, not db.update().run(): the same
 * typed-changes-count escape hatch lib/memoryId.ts's nextSeq and this
 * file's own forgetTransaction already use, needed here so the caller
 * (lib/memoryJudge.ts's runConsolidation) can tell a real retirement
 * from a no-op and stop scanning that record's pairs either way. */
export function supersedeInFavorOfExisting(oldId: string, existingId: string, closeValidTo?: string): boolean {
  const now = new Date().toISOString();
  const result = closeValidTo
    ? sqlite
        .query(
          "UPDATE memory_records SET status = 'superseded', expired_at = ?, superseded_by = ?, valid_to = ?, hlc = ? WHERE id = ? AND status = 'active'",
        )
        .run(now, existingId, closeValidTo, nextHlc(), oldId)
    : sqlite
        .query("UPDATE memory_records SET status = 'superseded', expired_at = ?, superseded_by = ?, hlc = ? WHERE id = ? AND status = 'active'")
        .run(now, existingId, nextHlc(), oldId);
  return result.changes > 0;
}

// A durable record that has sat unpinned and unused since before this
// many days ago is "mis-tiered junk" (BACKLOG.md's own phrase for the
// gap this closes): durable memories are permanently exempt from
// runMaintenance()'s decay above, so a wrongly-durable fact the judge
// over-graded was otherwise immortal no matter how irrelevant it turned
// out to be. Demoting it to episodic is not a deletion - it just lets
// the existing decay path above finally see it and, if it stays unused,
// eventually archive it the normal way.
const NEVER_RECALLED_DEMOTE_DAYS = 30;

/** Demotes every unpinned, never-recalled (uses = 0) durable record
 * older than NEVER_RECALLED_DEMOTE_DAYS to episodic. Returns the count
 * demoted, the same "what did this sweep actually do" shape
 * runMaintenance() returns. */
export function demoteNeverRecalledDurables(now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - NEVER_RECALLED_DEMOTE_DAYS * 86_400_000).toISOString();
  const stale = db
    .select({ id: memoryRecords.id })
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.status, "active"),
        eq(memoryRecords.pinned, false),
        eq(memoryRecords.tier, "durable"),
        eq(memoryRecords.uses, 0),
        lt(memoryRecords.createdAt, cutoff),
      ),
    )
    .all();
  for (const row of stale) {
    db.update(memoryRecords).set({ tier: "episodic", hlc: nextHlc() }).where(eq(memoryRecords.id, row.id)).run();
  }
  return stale.length;
}

// ==== Step 7: the profile paragraph ====
//
// "One pinned, person-scoped record per person... written and rewritten
// only by the consolidate job... never by the extractor directly"
// (session-a-intelligence.md). Exported from here, not lib/memoryJudge.ts
// (which does the actual writing, in its own runConsolidation() pass),
// so turnEngine.ts's read side and memoryJudge.ts's write side agree on
// exactly one definition of "which record IS the profile" without a
// circular import between the two files - this constant is the shape of
// the store, not a judge-specific concern.
export const PROFILE_SOURCE = "memory.consolidate:profile";

/** turnEngine.ts's own read side (buildSystemPrompt(): "injected whole
 * at the top of the memory block before recalled items"). A targeted
 * lookup by (person, source), not a recall() candidate: the profile
 * paragraph is unconditional context about who's speaking, not
 * something that competes with other facts for a cosine-scored slot. */
export function getProfileParagraph(actor: PersonRow): MemoryRecord | undefined {
  const row = db
    .select()
    .from(memoryRecords)
    .where(and(eq(memoryRecords.person, actor.id), eq(memoryRecords.source, PROFILE_SOURCE), eq(memoryRecords.status, "active")))
    .get();
  return row ? toMemoryRecord(row) : undefined;
}

// Not built this pass, deliberately (see docs/dev.md):
// - Mood and unfinished-business reads (the robot's reflect jobs):
//   robot-specific, Robot v0.1.
// - runMaintenance() scheduling (step 5's own "runMaintenance runs daily
//   via ensureCoreJob"): the function itself is unchanged by step 5 -
//   see lib/scheduler.ts for the new core job registration.
// - The sleep-time judge itself (step 6, deciding WHAT to remember from a
//   conversation) now lives in lib/memoryJudge.ts, not here - this file
//   only exports the primitives it needs (remember/supersede/
//   similarByVector), the same "core store, judge as a caller" split
//   4.4's own header names.
