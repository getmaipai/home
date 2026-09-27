// STORE-CAP-01 (docs/plans/household-storage-2026-09-23.md, "the two caps,
// declared once" and "usage, computed from the records"). Two enforced
// caps at the record API: a person's own cap (storage.person.cap_bytes,
// falling back to storage.person.default_cap_bytes when unset) and the
// household total (storage.household.cap_bytes). Usage is never a disk
// walk: the `attachments` table IS the spec's `file` record (STORE-SPEC-01
// renamed the record, not the table), so summing its `size` column is the
// bytes on disk, with one row per file and exactly one owner per row - a
// file shared with other people (STORE-SHARE-01, not built yet) still has
// only the one owner_person_id this sums against, so a shared file counts
// once, against its owner, and never against a recipient by construction:
// there is no join through a share pointer here that could double it.
import { relative } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { attachmentsDir, dataDir } from "@/lib/paths";
import { getHouseholdSettingValue, getSettingValueForPerson } from "@/lib/settings";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { walkFiles } from "@/lib/storage";
import { listActivePeople, isOwnerOrAdmin } from "@/lib/access";
import { HOUSEHOLD_STORAGE_CAP_KEY, PERSON_DEFAULT_STORAGE_CAP_KEY, PERSON_STORAGE_CAP_KEY } from "@/settings/storageKeys";
import type { File as FileRecord } from "@maipai/spec/gen/ts/file.js";
import type { PersonRow } from "@/types";
// The wire shape, not a second local interface (the same "one definition"
// pattern lib/performance.ts's own Performance/PerformanceDisk imports
// follow): the frontend's api.ts imports these two from
// @maipai/home-backend/src/wire the identical way it already imports
// Performance.
import type { PersonStorageRow, StorageUsageOverview } from "@/wire";
export type { PersonStorageRow, StorageUsageOverview } from "@/wire";

// STORE-SPEC-01: `kind` is a required field on the spec's `file` shape
// (image/video/audio/document/story/other) the `attachments` table never
// stores directly - it's derived from `media_type` at read time, here
// rather than in lib/attachments.ts (this module already imports from
// that one the other way - checkStorageCap - so this is the one place
// both attachments.ts's toRecord() and this module's own personUsageByKind()
// below can share it without a cycle). This module only ever sees origin
// "sent" uploads, so it only needs image/video/audio/other; it deliberately
// does not fold in documentExtraction.ts's own DOCUMENT_MEDIA_TYPES (a PDF
// or office file currently lands in "other", not "document") since that
// module already imports FROM lib/attachments.ts (readAttachment) -
// reaching back for its list would be circular, and a second copy here
// would drift. Flagged as a real, pre-existing gap, not silently guessed
// past: "document" and "story" never appear in a per-kind breakdown today
// because nothing in this codebase writes an attachment with either kind.
export function kindForMediaType(mediaType: string): FileRecord["kind"] {
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  return "other";
}

/** Bytes owned by one person, summed straight from the File records. */
export function personUsageBytes(personId: string): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${attachments.size}), 0)` })
    .from(attachments)
    .where(eq(attachments.ownerPersonId, personId))
    .get();
  return (row?.total as number | undefined) ?? 0;
}

/** The whole household's bytes: the same sum with no owner filter - one
 * pass over the same rows personUsageBytes() reads, so a person's number
 * and the household's number can never drift against each other. */
export function householdUsageBytes(): number {
  const row = db.select({ total: sql<number>`coalesce(sum(${attachments.size}), 0)` }).from(attachments).get();
  return (row?.total as number | undefined) ?? 0;
}

/** One person's bytes broken down by kind (STORE-PAGE-01: "the largest
 * kinds per person"), largest first. Grouped in JS via the same
 * kindForMediaType() classification toRecord() uses for the File shape's
 * own `kind` field, rather than a second SQL CASE expression that could
 * silently drift from it the next time that classification changes. */
export function personUsageByKind(personId: string): Array<{ kind: FileRecord["kind"]; bytes: number }> {
  const rows = db
    .select({ mediaType: attachments.mediaType, size: attachments.size })
    .from(attachments)
    .where(eq(attachments.ownerPersonId, personId))
    .all();
  const totals = new Map<FileRecord["kind"], number>();
  for (const row of rows) {
    const kind = kindForMediaType(row.mediaType);
    totals.set(kind, (totals.get(kind) ?? 0) + row.size);
  }
  return [...totals.entries()].map(([kind, bytes]) => ({ kind, bytes })).sort((a, b) => b.bytes - a.bytes);
}

/** STORE-PAGE-01's one read: the Storage settings page's data table, and
 * the child-view rule the acceptance names ("a child sees only their own
 * row") - enforced HERE, at the one function both the admin and the
 * non-admin call, rather than as a second filter re-applied in the route
 * or the frontend. An owner/admin gets every active person's row plus the
 * household total; anyone else gets a one-row list (themself only) and a
 * null household - never the total, never a sibling's row, the same
 * "self, or an owner/admin" shape access.ts's own canAccessPerson() already
 * uses elsewhere for personal settings. */
export function storageUsageOverview(actor: PersonRow): StorageUsageOverview {
  const admin = isOwnerOrAdmin(actor);
  const targets = admin ? listActivePeople() : listActivePeople().filter((p) => p.id === actor.id);
  const people: PersonStorageRow[] = targets.map((p) => ({
    personId: p.id,
    displayName: p.displayName,
    role: p.role,
    usageBytes: personUsageBytes(p.id),
    capBytes: personCapBytes(p.id),
    byKind: personUsageByKind(p.id),
  }));
  return {
    people,
    household: admin ? { usageBytes: householdUsageBytes(), capBytes: householdCapBytes() } : null,
  };
}

/** This person's effective cap: their own override when an admin set one
 * (> 0), else the household's default per-person cap. Both 0s carry the
 * same meaning every cap in this module gives 0 (household_cap_bytes
 * below, and the override itself) - "no cap enforced at this level" - so
 * an admin who explicitly zeroes storage.person.default_cap_bytes gets
 * exactly that, never a silently substituted 20 GB (a code review caught
 * the first version special-casing 0 here as "not configured" while its
 * two sibling keys in this same change both read 0 as "no cap"). The
 * registry's own default for that key is 20 GB
 * (storageKeys.ts's TWENTY_GB_BYTES) - a fresh, never-touched household
 * gets that number for free; only a deliberate 0 write ever reaches this
 * function as 0. */
export function personCapBytes(personId: string): number {
  const override = (getSettingValueForPerson(personId, PERSON_STORAGE_CAP_KEY) as number | undefined) ?? 0;
  if (override > 0) return override;
  return (getHouseholdSettingValue(PERSON_DEFAULT_STORAGE_CAP_KEY) as number | undefined) ?? 0;
}

/** The household total cap; 0 means the setup wizard hasn't set one yet
 * (decision 1), read as "no household-wide cap enforced" until it does. */
export function householdCapBytes(): number {
  return (getHouseholdSettingValue(HOUSEHOLD_STORAGE_CAP_KEY) as number | undefined) ?? 0;
}

/** The exact reason text (decision 3, household-storage-2026-09-23.md
 * "Enforcement"): a child's line never mentions raising the limit
 * themselves; an adult's line adds that they can. Every role other than
 * "child" gets the adult line - the design record only ever distinguishes
 * these two, never a third band for teen/guest. */
export function storageRefusalMessage(role: string): string {
  const base = "Your storage is full; delete some pictures or ask a parent for more room";
  return role === "child" ? base : `${base}, or raise the limit under Settings`;
}

/** The one preflight a write path calls before any bytes touch disk: the
 * record API's own createAttachment() today, and any future job whose
 * output would become a `made` File record (decision 3: "a picture or
 * video job whose output would not fit is refused before it starts") -
 * no such job exists in this codebase yet (checked), so this is the
 * function that job calls the day it's built, not a second copy of the
 * check. Refuses on the person's own cap first, then the household total;
 * either one being over is the same refusal in the person's words. */
export function checkStorageCap(personRole: string, personId: string, additionalBytes: number): { ok: boolean; error?: string } {
  const personCap = personCapBytes(personId);
  if (personCap > 0 && personUsageBytes(personId) + additionalBytes > personCap) {
    return { ok: false, error: storageRefusalMessage(personRole) };
  }
  const householdCap = householdCapBytes();
  if (householdCap > 0 && householdUsageBytes() + additionalBytes > householdCap) {
    return { ok: false, error: storageRefusalMessage(personRole) };
  }
  return { ok: true };
}

const RECONCILE_ISSUE_SOURCE = "storage";
const RECONCILE_ISSUE_KEY = "file_reconcile";

/** Every regular file under attachmentsDir, as the same dataDir-relative
 * path a File record's own storage_path is validated against
 * (attachments.ts's attachmentFilePath()/storagePathFor()). Walks via
 * lib/storage.ts's shared walkFiles() rather than its own recursion. */
function filesOnDisk(): Set<string> {
  const found = new Set<string>();
  walkFiles(attachmentsDir, (full) => found.add(relative(dataDir, full).replaceAll("\\", "/")));
  return found;
}

/** The core job (scheduler.ts's "storage.reconcile_files"): finds bytes on
 * disk with no matching File record, or a File record with no bytes on
 * disk, and raises a health item - it NEVER deletes anything, on either
 * side. A record with no bytes might be a crash mid-write; bytes with no
 * record might be a bug in some other write path; either way, a person
 * decides what happens next, not a background job (household-storage-
 * 2026-09-23.md: "the numbers a person sees are the bytes on disk, with
 * no double count to explain... a reconcile that finds bytes with no
 * record or a record with no bytes reports it as a health item, not as
 * usage"). Mirrors storage.ts's checkDiskFull()/the disk_full issue - the
 * same raiseIssue()/resolveIssue() upsert-by-(source,key) pattern, the one
 * health list, nothing bespoke. */
export function reconcileFileStore(): void {
  const rows = db.select({ storagePath: attachments.storagePath }).from(attachments).all();
  const recordPaths = new Set(rows.map((r) => r.storagePath));
  const diskPaths = filesOnDisk();

  const recordsWithNoBytes = [...recordPaths].filter((p) => !diskPaths.has(p));
  const bytesWithNoRecord = [...diskPaths].filter((p) => !recordPaths.has(p));

  if (recordsWithNoBytes.length === 0 && bytesWithNoRecord.length === 0) {
    resolveIssue(RECONCILE_ISSUE_SOURCE, RECONCILE_ISSUE_KEY);
    return;
  }

  const parts: string[] = [];
  if (bytesWithNoRecord.length > 0) parts.push(`${bytesWithNoRecord.length} file(s) on disk with no matching record`);
  if (recordsWithNoBytes.length > 0) parts.push(`${recordsWithNoBytes.length} record(s) with no bytes on disk`);

  void raiseIssue({
    source: RECONCILE_ISSUE_SOURCE,
    key: RECONCILE_ISSUE_KEY,
    severity: "warning",
    title: "Storage records and files on disk don't match",
    detail: `${parts.join(", ")}. Nothing was deleted; this needs a person to look.`,
  });
}
