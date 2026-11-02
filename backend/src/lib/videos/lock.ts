// ADULT-LOCK-02: the Adult lock for video jobs. A job is a locked item when the Library file of its clip is adult-only with the lock on, or, before
// there is a clip (queued, running, failed), when the job was marked adult-only at its start (`request.adultOnly`: an adult-only style, or an adult source).
// The decision itself is `lockState` in lib/adultLock.ts; this file only says which item a job is.
import { and, eq, inArray } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { attachments, people, videoJobs } from "@/db/schema";
import { libraryProvenanceSql } from "@/lib/libraryProvenance";
import { lockItemOfProvenance, lockState, lockedFilterSql, lockedView, unlockedFor, type AdultProof, type LockItem, type LockResult } from "@/lib/adultLock";
import { getVideoJobFor, videoJobIdsByTurn, type VideoJob } from "@/lib/videos/jobs";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";

export function videoJobLockItem(job: VideoJob): LockItem | null {
  const fileId = job.state === "done" ? job.files[0]?.id : undefined;
  if (fileId) {
    const row = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, fileId)).get();
    const item = row ? lockItemOfProvenance(row.owner, row.provenance) : null;
    if (item) return item;
  }
  return job.request.adultOnly === true ? { ownerPersonId: job.personId, madeAudience: "adult-only", lock: "on" } : null;
}

export function videoJobLockState(actor: PersonRow, job: VideoJob, proof?: AdultProof): LockResult {
  return lockState(videoJobLockItem(job), actor, proof);
}

/** The tile for a locked job: the one flag, plus a spinner while the job is still being made. */
export function lockedJobView(job: VideoJob): { locked: true; making: boolean } {
  return lockedView(job.state === "queued" || job.state === "running");
}

/** The fixed answer of a route that starts something from a locked source (edit, remix, another take): a plain line, no name, and nothing starts. */
export const LOCKED_START_LINE = "That is locked. Unlock it with your passcode first, then try again.";

/** The one tile that stands for every locked clip and clip being made of this person, or null when there is none (or the person holds a proof, and the
 * clips are listed as themselves). Counts nothing and orders nothing. */
export function lockedVideoTile(person: PersonRow): { locked: true; making: boolean } | null {
  if (unlockedFor(person)) return null;
  const meta = libraryProvenanceSql("a.provenance");
  const stored = sqlite.query(`SELECT 1 AS n FROM attachments a WHERE a.owner_person_id = ? AND a.deleted_at IS NULL AND json_extract(${meta},'$.writer') != 'video-poster' AND ${lockedFilterSql(person, meta)} LIMIT 1`).get(person.id);
  const active = db.select({ request: videoJobs.request }).from(videoJobs).where(and(eq(videoJobs.personId, person.id), inArray(videoJobs.state, ["queued", "running"]))).all()
    .some((row) => { try { return (JSON.parse(row.request) as { adultOnly?: boolean }).adultOnly === true; } catch { return false; } });
  return stored || active ? lockedView(active) : null;
}

/** What the model is told about a locked video, in the turn that made it and in every later one (it never sees the item's words or file id again). */
export const LOCKED_RESULT_TEXT = "An adult-only video was made and is locked. Say that it is ready and locked. Do not describe it, and do not repeat what it shows.";

/** A started or finished generate_video / edit_video outcome whose clip is a locked item, as the turn stores it: a placeholder with no prompt, styles or
 * file ids (the card follows the job by turn, never by this part). Any other outcome is returned as it came. */
export function redactLockedVideoOutcome(actor: PersonRow, outcome: ToolExecutionOutcome): ToolExecutionOutcome {
  const id = (outcome.result?.data as { videoJobId?: unknown } | undefined)?.videoJobId;
  if (typeof id !== "string") return outcome;
  const job = getVideoJobFor(actor, id);
  if (!job || videoJobLockItem(job)?.madeAudience !== "adult-only") return outcome;
  return outcomeOf({ callId: outcome.callId, packageId: outcome.packageId, status: outcome.status, via: outcome.via, args: { locked: true }, at: outcome.at, durationMs: outcome.durationMs, result: { reply: { text: LOCKED_RESULT_TEXT }, data: { locked: true }, actions: [] } });
}

/** The tool answer when an adult-only style is asked for in chat without an unlock proof: nothing starts, and the card is the lock tile with the unlock prompt. */
export function lockedStyleOutcome(callId: string, packageId: string, args: Record<string, unknown>): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args: { locked: true }, durationMs: 0, result: { reply: { text: "No video was started because the style asked for is locked. Say that it is locked and the person can unlock it on this page with their passcode, then ask again. Do not name the style." }, data: { locked: true, refused: "locked" }, actions: [] } });
}

/** The history list's video ids by turn with a locked job's id withheld: the id of a locked clip is as unreadable as its words. A turn whose clip is locked
 * maps to `null` (the page shows the lock tile by following the turn, never by this id). */
export function videoJobIdsByTurnRedacted(actor: PersonRow, turnIds: readonly string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [turnId, id] of videoJobIdsByTurn(actor, turnIds)) {
    const job = getVideoJobFor(actor, id);
    out.set(turnId, job && videoJobLockState(actor, job) === "open" ? id : null);
  }
  return out;
}

/** Whether a stored video job of this person is a locked item right now (for lists of activity that must not count or name it). */
export function videoRowIsLocked(person: PersonRow | string, jobId: string): boolean {
  const owner = typeof person === "string" ? db.select().from(people).where(eq(people.id, person)).get() : person;
  const job = owner ? getVideoJobFor(owner, jobId) : null;
  return job ? videoJobLockState(owner!, job) !== "open" : false;
}
