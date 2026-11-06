// ADULT-LOCK-07 slice 2: picture jobs use the shared Adult lock decision.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { lockItemOfProvenance, lockState, type LockItem, type LockResult } from "@/lib/adultLock";
import { getPictureJob, pictureJobIdsByTurn, pictureJobsForTurn, type PictureJob } from "@/lib/pictures/jobs";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";

/** The plain chat answer when a picture style is behind the Adult lock. */
export const LOCKED_PICTURE_STYLE_LINE = "No picture was started because the style asked for is locked. Say that it is locked and the person can unlock it on this page with their passcode, then ask again. Do not name the style.";

export function lockedPictureStyleOutcome(callId: string, packageId: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args: { locked: true }, durationMs: 0, result: { reply: { text: LOCKED_PICTURE_STYLE_LINE }, data: { locked: true }, actions: [] } });
}

export function pictureJobLockItem(job: PictureJob): LockItem | null {
  if (job.state === "done" && job.files[0]) {
    const row = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, job.files[0].id)).get();
    const item = row ? lockItemOfProvenance(row.owner, row.provenance) : null;
    if (item) return item;
  }
  // request.audience is the lane (an adult asked), not the content: adult-only is decided at finish, or at start by slice 3 setting adultLock.
  return job.request.adultLock ? { ownerPersonId: job.personId, madeAudience: "adult-only", lock: job.request.adultLock } : null;
}

export function pictureJobLockState(actor: PersonRow, job: PictureJob): LockResult {
  return lockState(pictureJobLockItem(job), actor);
}

export function pictureJobGroupLockState(actor: PersonRow, job: PictureJob): LockResult {
  const group = job.turnId ? pictureJobsForTurn(actor, job.turnId).filter((item) => item.kind !== "edit") : [job];
  const states = (group.length ? group : [job]).map((item) => pictureJobLockState(actor, item));
  return states.includes("hidden") ? "hidden" : states.includes("locked") ? "locked" : "open";
}

export const LOCKED_PICTURE_RESULT_TEXT = "An adult-only picture was made and is locked. Say that it is ready and locked. Do not describe it.";

export function redactLockedPictureOutcome(actor: PersonRow, outcome: ToolExecutionOutcome): ToolExecutionOutcome {
  const id = (outcome.result?.data as { pictureJobId?: unknown } | undefined)?.pictureJobId;
  if (typeof id !== "string") return outcome;
  const job = getPictureJob(actor, id);
  const item = job ? pictureJobLockItem(job) : null;
  if (!job || item?.madeAudience !== "adult-only" || lockState(item, actor) === "open") return outcome;
  return outcomeOf({ callId: outcome.callId, packageId: outcome.packageId, status: outcome.status, via: outcome.via, args: { locked: true }, at: outcome.at, durationMs: outcome.durationMs, result: { reply: { text: LOCKED_PICTURE_RESULT_TEXT }, data: { locked: true }, actions: [] } });
}

export function pictureJobIdsByTurnRedacted(actor: PersonRow, turnIds: readonly string[]): Map<string, string | "locked" | null> {
  const out = new Map<string, string | "locked" | null>();
  for (const [turnId, id] of pictureJobIdsByTurn(actor, turnIds)) {
    const job = getPictureJob(actor, id);
    const state = job ? pictureJobLockState(actor, job) : "hidden";
    out.set(turnId, state === "open" ? id : state === "locked" ? "locked" : null);
  }
  return out;
}

export function pictureRowIsLocked(person: PersonRow | string, jobId: string): boolean {
  const actor = typeof person === "string" ? db.select().from(people).where(eq(people.id, person)).get() as PersonRow | undefined : person;
  const job = actor ? getPictureJob(actor, jobId) : null;
  return job ? pictureJobLockState(actor!, job) !== "open" : false;
}
