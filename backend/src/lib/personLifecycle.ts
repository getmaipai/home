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
import { and, eq, isNull, ne } from "drizzle-orm";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { db, sqlite } from "@/db";
import {
  people,
  personCredentials,
  sessions,
  memoryRecords,
  conversationTurns,
  settingsValues,
  clonedVoices,
  scheduledJobs,
} from "@/db/schema";
import { clonedVoicesDir } from "@/lib/paths";
import { ROLE_LADDER, invalidateSessionCacheForPerson, type Role } from "@/middleware/auth";
import type { PersonRow } from "@/types";

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

/** Everyone may edit their own name, nickname, birthdate and avatar.
 * Managing somebody else needs the ladder above. */
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
  if (target.role === "owner" && otherOwnerCount(target.id) === 0) {
    return {
      ok: false,
      status: 400,
      error: "this is the household's only owner. Make someone else an owner first.",
    };
  }
  // routes/people.ts: "a PIN-free owner or admin profile is a one-request
  // takeover for anyone who can reach the API." Promotion has to honour
  // that too, or the rule is only enforced on the path that happens to
  // create the account.
  if ((nextRole === "owner" || nextRole === "admin") && !targetHasSecret) {
    return {
      ok: false,
      status: 400,
      error: `a ${nextRole} needs a PIN or password before they can be given that role`,
    };
  }
  return { ok: true, value: nextRole as Role };
}

export function hasSecret(personId: string): boolean {
  return db.select().from(personCredentials).where(eq(personCredentials.personId, personId)).get() !== undefined;
}

export interface ErasureCounts {
  memories: number;
  conversations: number;
  settings: number;
  clonedVoices: number;
  scheduledJobs: number;
  sessions: number;
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
  const memories = sqlite
    .query("DELETE FROM memory_records WHERE scope = 'person' AND person = ?")
    .run(personId).changes;
  const conversations = sqlite.query("DELETE FROM conversation_turns WHERE person_id = ?").run(personId).changes;
  // Person-scope settings hold the spec's full scope string
  // ("person:<id>"), so they are matched by that, not by a person_id
  // column this table does not have.
  const settings = sqlite.query("DELETE FROM settings_values WHERE scope = ?").run(`person:${personId}`).changes;
  const clonedVoiceRows = sqlite.query("DELETE FROM cloned_voices WHERE creator_id = ?").run(personId).changes;
  // Deleted outright rather than marked cancelled: a job belonging to
  // somebody who no longer exists has nobody to run for, and a cancelled
  // row would keep their id around in a table this function exists to
  // clear out.
  const jobs = sqlite.query("DELETE FROM scheduled_jobs WHERE person_id = ?").run(personId).changes;
  const sessionRows = sqlite.query("DELETE FROM sessions WHERE person_id = ?").run(personId).changes;
  sqlite.query("DELETE FROM person_credentials WHERE person_id = ?").run(personId);
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
    settings,
    clonedVoices: clonedVoiceRows,
    scheduledJobs: jobs,
    sessions: sessionRows,
  };
}

export function deletePerson(actor: PersonRow, personId: string): PersonOpResult<ErasureCounts> {
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
  if (target.role === "owner" && otherOwnerCount(personId) === 0) {
    return {
      ok: false,
      status: 400,
      error: "this is the household's only owner. Make someone else an owner first.",
    };
  }

  const counts = erasePersonData(personId);

  // The tombstone. Nickname and birthdate go with the rest of their
  // data; the display name stays, because a tombstone that cannot say
  // who it was is not much of a record for a robot reconciling later.
  const now = new Date().toISOString();
  db.update(people)
    .set({ deletedAt: now, updatedAt: now, nickname: null, birthdate: null })
    .where(eq(people.id, personId))
    .run();

  return { ok: true, value: counts };
}


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
