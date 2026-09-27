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
import { HOUSEHOLD_STORAGE_CAP_KEY, PERSON_DEFAULT_STORAGE_CAP_KEY, PERSON_STORAGE_CAP_KEY } from "@/settings/storageKeys";

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
