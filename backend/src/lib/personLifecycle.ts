// Editing and deleting a person, and the erasure that a delete performs.
//
// Two things here are judgment calls rather than something the platform
// plan spells out, both recorded in docs/dev.md:
//
// 1. **Who may manage whom.** routes/people.ts already decided creation
//    ("only the owner can create another owner or an admin, so an admin
//    account can never unilaterally create a peer"). Editing and
//    deleting follow the same ladder for the same reason: an admin who
//    could delete or demote another admin, or the owner, could take the
//    household over in one request. MANAGEABLE_BY below is that rule.
//
// 2. **A deleted person leaves a tombstone; their content is really
//    gone.** The person row is soft-deleted (the spec's own `deleted_at`
//    field, which GET /api/people already filters on) while everything
//    that person said, remembered, configured or recorded is hard-
//    deleted, following lib/memory.ts's forget() precedent for erasure.
//    Keeping the tombstone is what org standard 3 ("no data debt: every
//    record carries id, provenance and clock stamp from the first boot;
//    pairing later is a transfer, never a translation") needs: a row
//    that simply vanishes is indistinguishable, to a robot syncing later,
//    from a row it has not been told about yet, so the delete would
//    silently undo itself on the next sync. A tombstone transfers.
import { and, eq, isNull, ne, lt } from "drizzle-orm";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { db, sqlite } from "@/db";
import {
  people,
  personCredentials,
  sessions,
  conversationTurns,
  settingsValues,
  clonedVoices,
  scheduledJobs,
  deviceTokens,
  devices,
  passkeyCredentials,
  totpSecrets,
  entities,
  relationships,
  grants,
  approvals,
} from "@/db/schema";
import { clonedVoicesDir } from "@/lib/paths";
import { nextHlc } from "@/lib/hlc";
import { TOMBSTONE_TEXT } from "@/lib/memory";
import { invalidateScopeCache } from "@/lib/settings";
import { deleteReceivedBackupsForDevice } from "@/lib/receivedBackups";
import { ROLE_LADDER, invalidateSessionCacheForPerson, type Role } from "@/middleware/auth";
import { trigger } from "@/lib/notifications";
import type { PersonRow } from "@/types";
import type { personToDbValues } from "@/lib/personShape";

export type PersonOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string };

/** Whose profiles each role may edit or delete. Mirrors routes/people.ts's
 * CREATABLE_BY exactly: if you cannot create that role, you cannot manage
 * someone who holds it. */
export const MANAGEABLE_BY: Record<Role, Role[]> = {
  owner: [...ROLE_LADDER],
  admin: ["adult", "teen", "child", "guest"],
  adult: [],
  teen: [],
  child: [],
  guest: [],
};

function livingPerson(personId: string) {
  return db
    .select()
    .from(people)
    .where(and(eq(people.id, personId), isNull(people.deletedAt)))
    .get();
}

/** How many owners the household still has, not counting `excludingId`.
 * A household with no owner has nobody who can promote anyone, which is
 * unrecoverable through the UI. */
function otherOwnerCount(excludingId: string): number {
  return db
    .select()
    .from(people)
    .where(and(eq(people.role, "owner"), isNull(people.deletedAt), ne(people.id, excludingId)))
    .all().length;
}

// A review (2026-09-06) found this exact check - and the exact same
// error it returns - hand-written three times (checkRoleChange,
// commitPersonUpdate, deletePerson), each with its own copy of the
// wording. One place now: `wouldLeaveOwnerRole` is each caller's own
// "is this operation taking personId OUT of being an owner" condition
// (a role change away from owner, or a delete of an owner), already
// true by the time any of them reach this - the last-owner count is the
// one part actually worth sharing. otherOwnerCount() no longer needs to
// be exported: this is the only caller now, closing the "dead export
// inviting a future caller to roll its own unguarded check" gap the same
// review found.
function lastOwnerGuardError(personId: string, wouldLeaveOwnerRole: boolean): PersonOpResult<never> | null {
  if (!wouldLeaveOwnerRole) return null;
  if (otherOwnerCount(personId) > 0) return null;
  return { ok: false, status: 400, error: "this is the household's only owner. Make someone else an owner first." };
}

/** Everyone may edit their own name, nickname and avatar. Managing
 * somebody else needs the ladder above.
 *
 * Birthdate and localOnly are the exception (SEC-8, code review,
 * 2026-09-06): they're safety-adjacent, not cosmetic, so a self-edit of
 * either still needs owner/admin - checked separately in
 * routes/people.ts's PATCH handler, not here, since this function has no
 * way to see WHICH fields a given request is touching. */
export function canManage(actor: PersonRow, target: { id: string; role: string }): boolean {
  if (actor.id === target.id) return true;
  return (MANAGEABLE_BY[actor.role as Role] ?? []).includes(target.role as Role);
}

export interface PersonEdit {
  displayName?: string;
  nickname?: string | null;
  birthdate?: string | null;
  avatarSeed?: string;
  role?: string;
  localOnly?: boolean;
  enabled?: boolean;
  guestExpiresAt?: string | null;
}

/** The rules a role change has to satisfy, kept separate from the route
 * so each one can be read (and tested) as its own sentence. */
export function checkRoleChange(
  actor: PersonRow,
  target: { id: string; role: string },
  nextRole: string,
  targetHasSecret: boolean,
): PersonOpResult<Role> {
  if (!ROLE_LADDER.includes(nextRole as Role)) {
    return { ok: false, status: 400, error: `role must be one of ${ROLE_LADDER.join(", ")}` };
  }
  // Nobody changes their own role. An admin promoting themselves to
  // owner is the obvious hole; an owner demoting themselves is the less
  // obvious one, and it can leave a household with no owner at all.
  if (actor.id === target.id) {
    return { ok: false, status: 403, error: "you cannot change your own role" };
  }
  // Only the owner hands out roles, the same rule creation already
  // follows: an admin who could make someone else an admin has created a
  // peer, which is the thing CREATABLE_BY exists to prevent.
  if (actor.role !== "owner") {
    return { ok: false, status: 403, error: `${actor.role} cannot change a person's role` };
  }
  const lastOwnerError = lastOwnerGuardError(target.id, target.role === "owner");
  if (lastOwnerError) return lastOwnerError;
  // routes/people.ts: "a PIN-free owner or admin profile is a one-request
  // takeover for anyone who can reach the API." Promotion has to honour
  // that too, or the rule is only enforced on the path that happens to
  // create the account. Step 6: "the owner with a passkey or password"
  // - a passkey is an equally strong credential here, so the caller
  // passes requiresCredential(id) (lib/personAuthMethods.ts: PIN/
  // password OR any registered passkey), not the narrower hasSecret()
  // below.
  if ((nextRole === "owner" || nextRole === "admin") && !targetHasSecret) {
    return {
      ok: false,
      status: 400,
      error: `a ${nextRole} needs a PIN, password, or passkey before they can be given that role`,
    };
  }
  return { ok: true, value: nextRole as Role };
}

// A review of the COR-5 fix above (2026-09-06) found checkRoleChange()'s
// own last-owner guard has the identical race deletePerson() just got
// fixed for, one function away: it runs before routes/people.ts's own
// write, so two concurrent demotions of two different sole-owner-adjacent
// people (or a demote racing a delete) could each see "another owner
// still exists" before either write lands. routes/people.ts's PATCH
// handler does real work between checkRoleChange()'s own early check (a
// nice, immediate 400 for the ordinary non-racing case) and the actual
// write - re-validating a whole Person candidate, none of it needing
// re-verification here - so this re-checks and writes atomically at the
// one point that actually matters, rather than moving the whole handler
// into one transaction. Never throws; a race that loses returns the
// identical error checkRoleChange()'s own early check would have.
export const commitPersonUpdate = sqlite.transaction(
  (
    personId: string,
    dbValues: ReturnType<typeof personToDbValues>,
    // A single pre-computed condition, matching checkRoleChange()'s and
    // deletePerson()'s own call shape - a code review of this fix
    // (2026-09-06) found the two-flag form here let a caller AND them
    // together itself, which invites passing a `wasOwner`/`leavingOwnerRole`
    // pair that don't reflect the same real before/after transition (a
    // stale `wasOwner` read separately from the `nextRole` behind
    // `leavingOwnerRole`, say) and silently defeat the guard.
    wouldLeaveOwnerRole: boolean,
  ): PersonOpResult<true> => {
    const lastOwnerError = lastOwnerGuardError(personId, wouldLeaveOwnerRole);
    if (lastOwnerError) return lastOwnerError;
    db.update(people).set(dbValues).where(eq(people.id, personId)).run();
    return { ok: true, value: true };
  },
);

// A code review (2026-09-06) found this returning true for a row that
// merely EXISTS, not one with a real secretHash - step 6 made secretHash
// nullable (a passkey-only person's row holds only their shared lockout
// counter, lib/credentialLockout.ts), so a passkey-only person read as
// "has a PIN/password" here, which routes/people.ts's role-promotion
// guard trusted as proof of a strong credential.
export function hasSecret(personId: string): boolean {
  const row = db.select({ secretHash: personCredentials.secretHash }).from(personCredentials).where(eq(personCredentials.personId, personId)).get();
  return row?.secretHash != null;
}

export interface ErasureCounts {
  memories: number;
  conversations: number;
  /** Session A step 3: conversation THREADS (the `conversations` table),
   * distinct from `conversations` above (conversation_turns, the
   * existing field name here since before threads existed - kept as-is
   * rather than renamed, so nothing that reads erased.conversations
   * today silently starts meaning something else). */
  conversationThreads: number;
  settings: number;
  clonedVoices: number;
  scheduledJobs: number;
  sessions: number;
  /** Step 7: this person's own person-scoped entities and relationship
   * statements, and every grant/approval that was for or by them - a
   * code review (2026-09-06) found these four tables entirely untouched
   * by erasure despite this function's own claim to remove "everything
   * the household holds about one person". */
  entities: number;
  relationships: number;
  grants: number;
  approvals: number;
}

/** Everything the household holds about one person, deleted for real.
 *
 * Every table that references a person is listed here on purpose, and a
 * test walks the schema to prove none is missed: a table added later
 * that keeps person data, and is not handled here, is exactly how a
 * delete quietly stops being a delete. */
export function erasePersonData(personId: string): ErasureCounts {
  // Files first for cloned voices, while the rows still say which files
  // they are; the rows go immediately after. A file that will not delete
  // (locked, permissions) leaves a harmless orphan in a directory that
  // is not backed up, exactly the trade lib/clonedVoices.ts already made
  // and for the same reason: never a person who cannot be removed.
  const voices = db.select().from(clonedVoices).where(eq(clonedVoices.creatorId, personId)).all();
  for (const voice of voices) {
    try {
      const path = join(clonedVoicesDir, voice.fileName);
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // Orphaned file, never a stuck delete. See above.
    }
  }

  // Raw sqlite for the counts: Drizzle's bun-sqlite typing declares
  // .run() as void though it returns {changes} at runtime, the same
  // escape hatch memory.ts's forget() documents.
  //
  // Step 5: memory_embeddings/pending_embeddings carry a real FK to
  // memory_records.id, so their rows for this person's records are
  // cleared first - the same cascade memory.ts's forget() needs for the
  // identical reason. The vector store itself isn't spec-synced content
  // (memory-record.schema.json's own comment), so it's really gone here
  // too, not tombstoned.
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
  // Step 10 (session-a-intelligence.md): "the person-delete cascade stop
  // hard-deleting memory rows" - tombstoned the same way memory.ts's own
  // forget() now does, one UPDATE per row so each gets a genuinely
  // unique hlc, not memory.ts's forget() reused directly: that function
  // is a household member's OWN request about their OWN memories
  // (assertCanForgetOrExport's access check), while this runs as part of
  // deleting the PERSON, a different authorization path entirely.
  const memoryIds = sqlite
    .query("SELECT id FROM memory_records WHERE scope = 'person' AND person = ?")
    .all(personId) as { id: string }[];
  const tombstonedAt = new Date().toISOString();
  for (const row of memoryIds) {
    sqlite
      .query("UPDATE memory_records SET status = 'archived', text = ?, embedding_space = NULL, deleted_at = ?, hlc = ? WHERE id = ?")
      .run(TOMBSTONE_TEXT, tombstonedAt, nextHlc(), row.id);
  }
  const memories = memoryIds.length;
  const conversations = sqlite.query("DELETE FROM conversation_turns WHERE person_id = ?").run(personId).changes;
  // The thread record itself (step 3's `conversations` table), not just
  // its turns: left alone, this table's own person_id column would keep
  // holding rows about a deleted person forever (caught by the schema-
  // walking test below).
  const conversationThreads = sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(personId).changes;
  // Person-scope settings hold the spec's full scope string
  // ("person:<id>"), so they are matched by that, not by a person_id
  // column this table does not have.
  const settings = sqlite.query("DELETE FROM settings_values WHERE scope = ?").run(`person:${personId}`).changes;
  // A raw DELETE, not writeValue()/resetValue() - settings.ts's own
  // resolveStoredValue() cache (a latency review, 2026-09-06) is only
  // ever invalidated by those, so it needs telling directly here or a
  // just-erased person's settings could keep serving their last cached
  // value for the rest of this process's life.
  invalidateScopeCache(`person:${personId}`);
  const clonedVoiceRows = sqlite.query("DELETE FROM cloned_voices WHERE creator_id = ?").run(personId).changes;
  // Deleted outright rather than marked cancelled: a job belonging to
  // somebody who no longer exists has nobody to run for, and a cancelled
  // row would keep their id around in a table this function exists to
  // clear out.
  const jobs = sqlite.query("DELETE FROM scheduled_jobs WHERE person_id = ?").run(personId).changes;
  const sessionRows = sqlite.query("DELETE FROM sessions WHERE person_id = ?").run(personId).changes;
  sqlite.query("DELETE FROM person_credentials WHERE person_id = ?").run(personId);

  // Step 7: a code review (2026-09-06) found entities/relationships/
  // grants/approvals entirely untouched here despite this function's own
  // claim to erase everything the household holds about one person -
  // this person's own private entities and relationship statements, and
  // every grant and approval that was for them, all survived a delete
  // fully readable by owner/admin.
  //
  // FK-ordering matters: relationships.from_id/to_id reference
  // entities.id with no cascade, so any relationship touching one of
  // this person's own entities has to go BEFORE those entities do, or
  // the entity delete throws a foreign-key violation. Deliberately
  // matched by entity id rather than by this person's own `person`
  // column, since the reciprocal row a stated relationship stores
  // (lib/relationships.ts's inverseRelationship()) shares the same two
  // entity ids either way. A grant's granted_by_person_id/
  // acknowledged_by_person_id and a relationship's confirmed_by_person_id/
  // stated_by_person_id are left alone on purpose: `people` rows are
  // never hard-deleted (only tombstoned via deleted_at), so those
  // references stay perfectly valid - they record who did something,
  // not data belonging to the deleted person.
  const ownEntityIds = (sqlite.query("SELECT id FROM entities WHERE person = ?").all(personId) as Array<{ id: string }>).map((r) => r.id);
  let relationshipRows = 0;
  if (ownEntityIds.length > 0) {
    const placeholders = ownEntityIds.map(() => "?").join(",");
    relationshipRows += sqlite
      .query(`DELETE FROM relationships WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`)
      .run(...ownEntityIds, ...ownEntityIds).changes;
  }
  relationshipRows += sqlite.query("DELETE FROM relationships WHERE person = ?").run(personId).changes;
  const entityRows = sqlite.query("DELETE FROM entities WHERE person = ?").run(personId).changes;
  const grantRows = sqlite.query("DELETE FROM grants WHERE person = ?").run(personId).changes;
  const approvalRows = sqlite.query("DELETE FROM approvals WHERE person_id = ?").run(personId).changes;
  // Deleting the session rows is not enough on its own: resolveSession
  // keeps a 10-second in-memory cache, so a deleted person went on
  // making authenticated requests until it expired. auth.ts has had
  // invalidateSessionCacheForPerson ready since 2026-09-04 with the note
  // "no caller yet... kept ready for when a delete-person or role-change
  // route lands"; this is that caller. Found by the test that asserts a
  // deleted person's session stops working, not by reading the code.
  invalidateSessionCacheForPerson(personId);

  return {
    memories,
    conversations,
    conversationThreads,
    settings,
    clonedVoices: clonedVoiceRows,
    scheduledJobs: jobs,
    sessions: sessionRows,
    entities: entityRows,
    relationships: relationshipRows,
    grants: grantRows,
    approvals: approvalRows,
  };
}

// COR-5 (code review, 2026-09-06): erasePersonData()'s own SQL
// statements plus the tombstone update below used to run outside any
// transaction, and (the more concrete risk) the otherOwnerCount() check
// below ran BEFORE the writes with nothing stopping two owners from
// deleting each other at the same moment: both checks could see "another
// owner still exists" before either delete actually landed, leaving zero
// owners. sqlite.transaction()'s own callback runs synchronously start
// to finish (bun:sqlite, like better-sqlite3, has no async transaction
// API, and neither the check nor erasePersonData() ever awaits anything)
// - on a single JS thread, that alone is what closes the race: a second,
// "concurrent" call's own synchronous transaction cannot begin until
// this one's callback has already returned, by which point either the
// target owner is already gone (livingPerson() below returns null) or
// the count already reflects the first delete. This covers every SQL
// write erasePersonData() makes (all of them go through this same
// connection); it does NOT extend to the plain-file unlinks inside it
// (a cloned voice's audio file) - those were already best-effort,
// tolerant of a leftover orphan, before this fix (that function's own
// header explains why), and stay exactly that tolerant now, just with
// the SQL side genuinely atomic underneath.
export const deletePerson = sqlite.transaction((actor: PersonRow, personId: string): PersonOpResult<ErasureCounts> => {
  const target = livingPerson(personId);
  if (!target) return { ok: false, status: 404, error: "no such person" };

  // Deleting yourself would sign you out mid-request and, for the only
  // owner, lock the household out of its own management for good. It is
  // also never what someone means to do from a roster screen.
  if (actor.id === personId) {
    return { ok: false, status: 403, error: "you cannot delete your own profile" };
  }
  if (!canManage(actor, target)) {
    return { ok: false, status: 403, error: `${actor.role} cannot delete a ${target.role} profile` };
  }
  const lastOwnerError = lastOwnerGuardError(personId, target.role === "owner");
  if (lastOwnerError) return lastOwnerError;

  const counts = erasePersonData(personId);

  // The tombstone. Nickname and birthdate go with the rest of their
  // data; the display name stays, because a tombstone that cannot say
  // who it was is not much of a record for a robot reconciling later.
  const now = new Date().toISOString();
  db.update(people)
    .set({ deletedAt: now, updatedAt: now, nickname: null, birthdate: null, hlc: nextHlc() })
    .where(eq(people.id, personId))
    .run();

  return { ok: true, value: counts };
});


export interface BatchDeleteOutcome {
  id: string;
  deleted: boolean;
  /** Why this one was left alone, in the same words the single-delete
   * route would have used. */
  reason?: string;
}

/** Deleting several people at once (docs/UI.md > Batch actions: every
 * list of things the household can delete offers a multi-select).
 *
 * Partial success on purpose: selecting five people and having the whole
 * request refused because one of them is the household's only owner
 * helps nobody. Each is attempted under exactly the same rules as a
 * single delete, and the caller is told, per person, what happened. */
export function deletePeople(actor: PersonRow, ids: string[]): BatchDeleteOutcome[] {
  const outcomes: BatchDeleteOutcome[] = [];
  for (const id of ids) {
    const result = deletePerson(actor, id);
    outcomes.push(result.ok ? { id, deleted: true } : { id, deleted: false, reason: result.error });
  }
  return outcomes;
}

// --- Step 7: enabled, guest expiry, memorialise, the band change ---

/** Every sign-in credential and live session for one person, gone at
 * once - the shared shape memorializePerson() below and a future
 * "revoke everything" admin action would both need. Never touches
 * memories, conversations or settings: unlike deletePerson()'s erasure,
 * this is about ending ACCESS, not history. */
function revokeAllCredentialsAndSessions(personId: string): void {
  db.delete(personCredentials).where(eq(personCredentials.personId, personId)).run();
  db.delete(passkeyCredentials).where(eq(passkeyCredentials.personId, personId)).run();
  const ownDevices = db.select({ id: devices.id }).from(devices).where(eq(devices.personId, personId)).all();
  for (const device of ownDevices) {
    db.delete(deviceTokens).where(eq(deviceTokens.deviceId, device.id)).run();
    // Step 8: same foreign-key gap a code review (2026-09-06) found in
    // lib/devices.ts's deleteDevice() - received_backups.device_id has
    // no cascade, so the devices delete below would throw for any
    // device that had ever pushed a backup (POST /api/backups/received).
    deleteReceivedBackupsForDevice(device.id);
  }
  db.delete(devices).where(eq(devices.personId, personId)).run();
  db.delete(sessions).where(eq(sessions.personId, personId)).run();
  db.delete(totpSecrets).where(eq(totpSecrets.personId, personId)).run();
  invalidateSessionCacheForPerson(personId);
}

/** BACKLOG.md: "memorialise (read-only profile, PIN cleared, sessions
 * revoked, export offered)". Distinct from deletePerson(): a
 * memorialized profile keeps every memory, conversation and
 * relationship exactly as it was - the household can still see and talk
 * about that person - it just can never sign in again. Set once, never
 * cleared (person.schema.json's own field description); calling this
 * again on an already-memorialized person is a harmless no-op, not an
 * error, since the end state is identical either way. */
export function memorializePerson(actor: PersonRow, personId: string): PersonOpResult<{ id: string }> {
  const target = livingPerson(personId);
  if (!target) return { ok: false, status: 404, error: "no such person" };
  if (actor.id === personId) {
    return { ok: false, status: 403, error: "you cannot memorialize your own profile" };
  }
  if (!canManage(actor, target)) {
    return { ok: false, status: 403, error: `${actor.role} cannot memorialize a ${target.role} profile` };
  }

  revokeAllCredentialsAndSessions(personId);
  if (!target.memorializedAt) {
    db.update(people)
      .set({ memorializedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() })
      .where(eq(people.id, personId))
      .run();
  }
  return { ok: true, value: { id: personId } };
}

/** A guest profile past its own guest_expires_at stops signing in on its
 * own (person.schema.json's own field description) - the same effect
 * `enabled: false` has, applied automatically rather than requiring a
 * household member to remember to remove it. Idempotent (only ever sets
 * enabled, never re-flips it back), so a scheduled job can call this
 * every day without re-notifying or re-writing an already-expired guest.
 * Returns the ids actually disabled, for the caller's own log line. */
export function disableExpiredGuests(): string[] {
  const now = new Date().toISOString();
  const expired = db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.role, "guest"), eq(people.enabled, true), isNull(people.deletedAt), lt(people.guestExpiresAt, now)))
    .all();
  for (const row of expired) {
    db.update(people).set({ enabled: false, updatedAt: now, hlc: nextHlc() }).where(eq(people.id, row.id)).run();
    invalidateSessionCacheForPerson(row.id);
  }
  return expired.map((r) => r.id);
}

/** The age band a birthdate implies today, matching person.schema.json's
 * own role description ("Two minor bands (teen 13-17, child under 13) so
 * there is no thirteen-year cliff") and platform plan 4.2's adult
 * threshold. Only ever returns "child", "teen" or "adult" - the three
 * roles this sweep is allowed to move someone between; owner/admin/guest
 * are authorization roles, never age bands, and this function is never
 * consulted for them. */
export function ageBandForBirthdate(birthdate: string, today: Date = new Date()): "child" | "teen" | "adult" {
  const born = new Date(birthdate);
  let age = today.getUTCFullYear() - born.getUTCFullYear();
  const monthDay = (d: Date) => d.getUTCMonth() * 100 + d.getUTCDate();
  if (monthDay(today) < monthDay(born)) age -= 1; // birthday hasn't happened yet this year
  if (age >= 18) return "adult";
  if (age >= 13) return "teen";
  return "child";
}

/** BACKLOG.md: "the band change on a birthday with its passive
 * notification". Only ever touches people whose CURRENT role is "child"
 * or "teen" (an "adult" has no further band to age into, and
 * owner/admin/guest were never age-derived in the first place) - and
 * only those with a birthdate on file, since a role assigned by hand
 * with no birthdate has nothing for this to compute against. Fires
 * exactly one notification per person actually moved, never one for a
 * birthday that happens to land on a day this runs without crossing a
 * band boundary. */
export async function applyAgeBandChanges(today: Date = new Date()): Promise<string[]> {
  const candidates = db
    .select()
    .from(people)
    .where(and(isNull(people.deletedAt)))
    .all()
    .filter((p) => (p.role === "child" || p.role === "teen") && p.birthdate !== null);

  const moved: string[] = [];
  for (const person of candidates) {
    const nextBand = ageBandForBirthdate(person.birthdate!, today);
    if (nextBand === person.role) continue;
    const now = new Date().toISOString();
    db.update(people).set({ role: nextBand, updatedAt: now, hlc: nextHlc() }).where(eq(people.id, person.id)).run();
    invalidateSessionCacheForPerson(person.id);
    moved.push(person.id);
    await trigger("person.band_changed", { displayName: person.displayName, newRole: nextBand });
  }
  return moved;
}
