// STORE-SHARE-01 (home docs/plans/household-storage-2026-09-23.md,
// decisions 2 and 6): share pointer records over the file table
// (lib/attachments.ts's own `attachments`, backing the spec's `file`
// shape) - created by whoever already has access (the owner, or a
// recipient re-sharing within the household), deleted by the owner or
// by whoever made that particular pointer, never a second file record
// or a copy of the bytes.
//
// "Outside the household" has no representable value in this record at
// all: `to` is either the literal "household" or an existing person id
// (share.schema.json's own pattern), and every person id this hub knows
// is a household member today (no known-people-without-accounts concept
// exists yet - PEOPLE-EXPAND-01, not built). An external link is a
// different record entirely (share-link-01/SHARE-LINK-02, its own
// schema and route, refused for a child at that route, not this one).
// So decision 2's "a child never shares outside it" is enforced here as:
// a share's target must resolve to "household" or a real, active person
// - the only thing this shape can ever address - for anyone, child or
// adult alike. When PEOPLE-EXPAND-01 lands a known person without
// household membership, `isValidShareTarget` below is the one place
// that needs a membership check added, not a second parallel rule.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, shares } from "@/db/schema";
import { Share as ShareSchema, type Share } from "@maipai/spec/gen/ts/share.js";
import { newShareId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { canAccessFile, getPersonRole, isOwnerOrAdmin, listActivePeople } from "@/lib/access";
import { toRecord } from "@/lib/attachments";
import { trigger } from "@/lib/notifications";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import type { File as FileRecord } from "@maipai/spec/gen/ts/file.js";
import type { PersonRow } from "@/types";

export type ShareOpResult<T, S extends number = 400 | 403 | 404> =
  | { ok: true; value: T }
  | { ok: false; status: S; error: string };

export interface CreateShareInput {
  fileId: string;
  to: string;
  provenance?: string;
}

function toShareRecord(row: typeof shares.$inferSelect): Share {
  const parsed = ShareSchema.safeParse({
    id: row.id,
    file_id: row.fileId,
    from_person_id: row.fromPersonId,
    to: row.to,
    provenance: row.provenance,
    created_at: row.createdAt,
    hlc: row.hlc,
  });
  if (!parsed.success) throw new Error(`invalid share row: ${parsed.error.message}`);
  return parsed.data;
}

function isValidShareTarget(to: string): boolean {
  if (to === "household") return true;
  return db.select({ id: people.id }).from(people).where(eq(people.id, to)).get() !== undefined;
}

/** Create a share pointer. `actor` must already be able to see the file
 * (the owner, or a share.schema.json recipient re-sharing it onward -
 * decision 6); the target must be "household" or a real person (the
 * household bound above). Idempotent per (file, to): re-sharing to a
 * target that already has a live pointer just returns it. */
export function createShare(actor: PersonRow, input: CreateShareInput): ShareOpResult<Share, 400 | 403 | 404> {
  const file = db.select().from(attachments).where(eq(attachments.id, input.fileId)).get();
  if (!file) return { ok: false, status: 404, error: "file not found" };

  if (!canAccessFile(actor, file.ownerPersonId, input.fileId)) {
    return { ok: false, status: 403, error: "you do not have access to this file" };
  }

  const to = input.to.trim();
  if (!isValidShareTarget(to)) {
    return { ok: false, status: 400, error: "the household does not have that person" };
  }

  const existing = db.select().from(shares).where(and(eq(shares.fileId, input.fileId), eq(shares.to, to))).get();
  if (existing) return { ok: true, value: toShareRecord(existing) };

  const provenance = (input.provenance ?? "files-page:share").trim() || "files-page:share";
  const row = {
    id: newShareId(),
    fileId: input.fileId,
    fromPersonId: actor.id,
    to,
    provenance,
    createdAt: new Date().toISOString(),
    hlc: nextHlc(),
  };
  db.insert(shares).values(row).run();
  notifyShareCreated(actor, to, file);
  return { ok: true, value: toShareRecord(row) };
}

/** A plain-language phrase for each File.kind, for the notification
 * template below - grammatical ("a photo", "an audio clip") rather than
 * the raw enum value, kept here as the one place that needs to know
 * that mapping. */
const KIND_PHRASES: Record<FileRecord["kind"], string> = {
  image: "a photo",
  video: "a video",
  audio: "an audio clip",
  document: "a document",
  story: "a story",
  other: "a file",
};

/** Fires NOTIFY-SHARE-01's declared type for a genuinely new share
 * pointer - never for the idempotent "already shared with this target"
 * return above `createShare` takes before reaching this call, since
 * nothing new happened there. Fire-and-forget, the same
 * `trackBackgroundWork(trigger(...).catch(...))` shape lib/notifications.ts's
 * own `notifyIfFlagged()` uses to fire a declared type from a
 * synchronous caller: `createShare` must never fail, or gain latency,
 * because a notification attempt did. `to === "household"` fires
 * `file.shared_with_household` (the `household` audience fans it out to
 * everyone in resolveRecipients(), so `excludePersonId: actor.id` drops
 * the sharer's own copy - a code review, 2026-09-27, caught the first
 * cut of this notifying the sharer about their own share); any other
 * `to` is already a validated person id at this point
 * (`isValidShareTarget` above), so it fires `file.shared_with_you`
 * straight at that one person - no exclusion needed there, since that
 * one recipient is named directly by `personId`, never derived from
 * "everyone." */
function notifyShareCreated(actor: PersonRow, to: string, file: typeof attachments.$inferSelect): void {
  // A code review (2026-09-27) found this had no fallback for a kind
  // value the map doesn't list - `Record<FileRecord["kind"], string>`
  // only guarantees exhaustiveness against today's type declaration, not
  // against whatever toRecord() actually returns at runtime.
  const kindPhrase = KIND_PHRASES[toRecord(file).kind] ?? "a file";
  const vars = { fromDisplayName: actor.displayName, kindPhrase };
  if (to === "household") {
    trackBackgroundWork(
      trigger("file.shared_with_household", vars, { subjectPersonId: actor.id, excludePersonId: actor.id }).catch((err: unknown) =>
        console.error(`[shares] file.shared_with_household notification failed: ${(err as Error).message}`),
      ),
    );
  } else {
    trackBackgroundWork(
      trigger("file.shared_with_you", vars, { personId: to, subjectPersonId: actor.id }).catch((err: unknown) =>
        console.error(`[shares] file.shared_with_you notification failed: ${(err as Error).message}`),
      ),
    );
  }
}

/** Unshare: a real delete, not a soft revoke (share.schema.json's own
 * words). Allowed for whoever created that specific pointer (retracting
 * your own re-share), the file's owner (removing anyone's pointer on
 * their own file), or an owner/admin acting for a CHILD's file (parity
 * with access.ts's canAccessPerson - a parent may unshare on a child's
 * behalf, never on an adult's). Deleting a pointer also prunes any
 * downstream re-share that depended on it (pruneUnreachableShares
 * below) - "a re-share made from a pointer dies with the pointer it
 * came from" (household-storage-2026-09-23.md). */
export function deleteShare(actor: PersonRow, shareId: string): ShareOpResult<{ deletedShareIds: string[] }, 403 | 404> {
  const share = db.select().from(shares).where(eq(shares.id, shareId)).get();
  if (!share) return { ok: false, status: 404, error: "share not found" };
  const file = db.select().from(attachments).where(eq(attachments.id, share.fileId)).get();
  if (!file) return { ok: false, status: 404, error: "file not found" };

  const canDelete =
    actor.id === share.fromPersonId ||
    actor.id === file.ownerPersonId ||
    (isOwnerOrAdmin(actor) && getPersonRole(file.ownerPersonId) === "child");
  if (!canDelete) return { ok: false, status: 403, error: "you may not remove this share" };

  db.delete(shares).where(eq(shares.id, shareId)).run();
  const pruned = pruneUnreachableShares(share.fileId, file.ownerPersonId);
  return { ok: true, value: { deletedShareIds: [shareId, ...pruned] } };
}

/** After a delete, recompute which remaining pointers still trace back
 * to the owner and drop any that don't - share.schema.json is `.strict()`
 * with no parent-pointer field to chase, so reachability is recomputed
 * from the graph itself instead of stored: a pointer is only as good as
 * whether its own `from_person_id` can still see the file (the owner,
 * or named by household or by another surviving pointer). Runs to a
 * fixed point since removing one dead pointer can orphan another.
 *
 * Reachability itself is a second, inner fixed point (code review,
 * 2026-09-27): a row's grant counts toward who's reachable only once
 * its OWN granter is already reachable via some OTHER row (or is the
 * owner) - never via the very row it granted. Folding every row's `to`
 * (household included) into the reachable set unconditionally, as a
 * first cut of this did, let a household share justify its own
 * creator's continued access: owner shares directly with lucia, lucia
 * (now able to see the file) shares it on to the whole household: once
 * the owner revokes lucia's direct share, lucia's own household-wide
 * share must die with it, but a share that reads "everyone, household
 * included" as reachable from the very fact that this row exists
 * treated lucia as reachable simply because her own row named
 * "household," so the household-wide grant she made survived her own
 * revoked access indefinitely. */
export function pruneUnreachableShares(fileId: string, ownerPersonId: string): string[] {
  const removed: string[] = [];
  for (;;) {
    const rows = db.select().from(shares).where(eq(shares.fileId, fileId)).all();
    if (rows.length === 0) break;

    const reachable = new Set<string>([ownerPersonId]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const row of rows) {
        if (!reachable.has(row.fromPersonId)) continue; // this row's own granter isn't justified (yet) - its grant doesn't count.
        if (row.to === "household") {
          for (const person of listActivePeople()) {
            if (!reachable.has(person.id)) {
              reachable.add(person.id);
              changed = true;
            }
          }
        } else if (!reachable.has(row.to)) {
          reachable.add(row.to);
          changed = true;
        }
      }
    }

    const dead = rows.filter((row) => !reachable.has(row.fromPersonId));
    if (dead.length === 0) break;
    for (const row of dead) db.delete(shares).where(eq(shares.id, row.id)).run();
    removed.push(...dead.map((row) => row.id));
  }
  return removed;
}

export function listSharesForFile(fileId: string): Share[] {
  return db.select().from(shares).where(eq(shares.fileId, fileId)).all().map(toShareRecord);
}

export interface VisibleFile {
  file: FileRecord;
  ownerPersonId: string;
  /** False for a file actor owns; true for one a share (direct or
   * household) makes visible to them. */
  shared: boolean;
}

/** The Library's own list: everything actor owns, plus everything
 * shared with them by name or by "household" - each shared file listed
 * once under its real owner (never a copy), per STORE-SHARE-01's own
 * acceptance ("a shared file appears in each recipient's Library under
 * the owner's name"). */
export function listFilesVisibleToActor(actor: PersonRow): VisibleFile[] {
  const owned = db.select().from(attachments).where(eq(attachments.ownerPersonId, actor.id)).all();
  const allShares = db.select().from(shares).where(eq(shares.to, actor.id)).all().concat(db.select().from(shares).where(eq(shares.to, "household")).all());

  const result: VisibleFile[] = owned.map((row) => ({ file: toRecord(row), ownerPersonId: row.ownerPersonId, shared: false }));
  const ownedIds = new Set(owned.map((row) => row.id));
  const sharedFileIds = [...new Set(allShares.map((share) => share.fileId).filter((id) => !ownedIds.has(id)))];
  // One batched lookup, not one query per shared file id (code review,
  // 2026-09-27): a household with many shared files would otherwise
  // cost this list an extra round trip per distinct file every time
  // anyone opens their Library.
  const sharedFiles = sharedFileIds.length > 0 ? db.select().from(attachments).where(inArray(attachments.id, sharedFileIds)).all() : [];
  for (const file of sharedFiles) {
    // An orphaned pointer (the file itself was deleted) simply has no
    // matching row here - nothing to list, no special case needed.
    result.push({ file: toRecord(file), ownerPersonId: file.ownerPersonId, shared: true });
  }
  return result;
}
