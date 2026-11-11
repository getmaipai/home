// SONG-LOCK-B: the Adult lock for music jobs, using the song file provenance once it exists.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { lockItemOfProvenance, lockState, lockedView, type AdultProof, type LockItem, type LockResult } from "@/lib/adultLock";
import { getMusicJobFor, musicJobIdsByTurn } from "@/lib/music/store";
import type { MusicJob } from "@/lib/music/types";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";

export function musicJobLockItem(job: MusicJob): LockItem | null {
  const fileId = job.fileId;
  if (fileId) {
    const row = db.select({ owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, fileId)).get();
    const item = row ? lockItemOfProvenance(row.owner, row.provenance) : null;
    if (item) return item;
  }
  const request = job.request as typeof job.request & { adultOnly?: boolean; adultLock?: string };
  return request.adultOnly === true ? { ownerPersonId: job.personId, madeAudience: "adult-only", lock: request.adultLock === "off" ? "off" : "on" } : null;
}
export function musicJobLockState(job: MusicJob, actor: PersonRow, proof?: AdultProof): LockResult { return lockState(musicJobLockItem(job), actor, proof); }
export function musicRowIsLocked(person: PersonRow | string, jobId: string): boolean {
  const actor = typeof person === "string" ? db.select().from(people).where(eq(people.id, person)).get() as PersonRow | undefined : person;
  const job = actor ? getMusicJobFor(actor, jobId) : null;
  return !!(job && musicJobLockState(job, actor!) !== "open");
}
export function lockedMusicTile(job: MusicJob): { locked: true; making: boolean } { return lockedView(job.state === "queued" || job.state === "running"); }
export const LOCKED_MUSIC_START_LINE = "This song is locked. Unlock it first, then try again.";
export const LOCKED_MUSIC_RESULT_TEXT = "An adult-only song was made and is locked. Say that it is ready and locked. Do not describe it.";
export function redactLockedMusicOutcome(actor: PersonRow, outcome: ToolExecutionOutcome): ToolExecutionOutcome {
  const id = (outcome.result?.data as { musicJobId?: unknown } | undefined)?.musicJobId;
  if (typeof id !== "string") return outcome;
  const job = getMusicJobFor(actor, id), item = job ? musicJobLockItem(job) : null;
  if (!job || item?.madeAudience !== "adult-only" || item.lock === "off" || musicJobLockState(job, actor) === "open") return outcome;
  return outcomeOf({ callId: outcome.callId, packageId: outcome.packageId, status: outcome.status, via: outcome.via, args: { locked: true }, at: outcome.at, durationMs: outcome.durationMs, result: { reply: { text: LOCKED_MUSIC_RESULT_TEXT }, data: { locked: true }, actions: [] } });
}
export function musicJobIdsByTurnRedacted(actor: PersonRow, turnIds: readonly string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [turnId, id] of musicJobIdsByTurn(actor, turnIds)) {
    const job = getMusicJobFor(actor, id);
    out.set(turnId, job && musicJobLockState(job, actor) === "open" ? id : null);
  }
  return out;
}
