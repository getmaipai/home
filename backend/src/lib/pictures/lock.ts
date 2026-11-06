// ADULT-LOCK-07 slice 2: picture jobs use the shared Adult lock decision.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { lockItemOfProvenance, lockState, type LockItem, type LockResult } from "@/lib/adultLock";
import { getPictureJob, pictureJobIdsByTurn, pictureJobsForTurn, type PictureJob } from "@/lib/pictures/jobs";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";

export function pictureJobLockItem(job: PictureJob): LockItem | null {
  if (job.state === "done" && job.files[0]) {
    const row = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, job.files[0].id)).get();
    const item = row ? lockItemOfProvenance(row.owner, row.provenance) : null;
    if (item) return item;
  }
  return job.request.audience === "adult" ? { ownerPersonId: job.personId, madeAudience: "adult-only", lock: job.request.adultLock === "off" ? "off" : "on" } : null;
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
  if (!job || item?.madeAudience !== "adult-only" || item.lock === "off") return outcome;
  return outcomeOf({ callId: outcome.callId, packageId: outcome.packageId, status: outcome.status, via: outcome.via, args: { locked: true }, at: outcome.at, durationMs: outcome.durationMs, result: { reply: { text: LOCKED_PICTURE_RESULT_TEXT }, data: { locked: true }, actions: [] } });
}

export function pictureJobIdsByTurnRedacted(actor: PersonRow, turnIds: readonly string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [turnId, id] of pictureJobIdsByTurn(actor, turnIds)) {
    const job = getPictureJob(actor, id);
    out.set(turnId, job && pictureJobLockState(actor, job) === "open" ? id : null);
  }
  return out;
}

export function pictureRowIsLocked(person: PersonRow | string, jobId: string): boolean {
  const actor = typeof person === "string" ? db.select().from(people).where(eq(people.id, person)).get() as PersonRow | undefined : person;
  const job = actor ? getPictureJob(actor, jobId) : null;
  return job ? pictureJobLockState(actor!, job) !== "open" : false;
}
