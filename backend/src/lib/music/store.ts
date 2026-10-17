// MUSIC-GEN-03: the one job store and deletion boundary. No attachment imports: forget can stop watchers before deleting files.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { musicJobs } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { cancelOrDeleteMusic } from "./stack";
import type { MusicJob, GenerationProvenance } from "./types";
export const TEMP_MS = 2 * 60 * 60 * 1000;
export const memory = new Map<string, MusicJob>();
export const liveJobs = new Map<string, MusicJob>();
export const watching = new Map<string, AbortController>();
const removed = new Set<string>();
export const temporarySongs = new Map<string, { bytes: Uint8Array; jobId: string; personId: string; conversationId: string; createdAt: number; provenance: GenerationProvenance }>();
function fromRow(row: typeof musicJobs.$inferSelect): MusicJob {
  return { ...row, request: JSON.parse(row.request) as MusicJob["request"], task: row.task as MusicJob["task"], state: row.state as MusicJob["state"], temporary: false };
}
/** The state last stored for this job, or null when none is stored yet. */
export function storedMusicState(job: MusicJob): string | null {
  if (job.temporary) return memory.get(job.id)?.state ?? null;
  return db.select({ state: musicJobs.state }).from(musicJobs).where(eq(musicJobs.id, job.id)).get()?.state ?? null;
}
/** A stopped song stays stopped: a later write from a watcher or a finishing submit adopts the stored cancel instead of overwriting it. */
export function saveMusicJob(job: MusicJob): void {
  if (removed.has(job.id)) return;
  if (job.state !== "cancelled" && storedMusicState(job) === "cancelled") { job.state = "cancelled"; return; }
  job.updatedAt = new Date().toISOString();
  if (job.temporary) { memory.set(job.id, job); return; }
  const { temporary: _temporary, ...rest } = job;
  const values = { ...rest, request: JSON.stringify(job.request), hlc: nextHlc() };
  db.insert(musicJobs).values(values).onConflictDoUpdate({ target: musicJobs.id, set: values }).run();
}
/** Called once nothing can write the job any more (its watcher finished or its submit failed). */
export function forgetRemovedMusicJob(id: string): void { removed.delete(id); }
export function dropMusicJob(job: MusicJob): void {
  // Only a job something may still write (a watcher or a submit in flight) needs the no-resurrection mark; it is cleared when that ends.
  if (watching.has(job.id) || liveJobs.has(job.id)) removed.add(job.id);
  watching.get(job.id)?.abort(); watching.delete(job.id);
  memory.delete(job.id); liveJobs.delete(job.id);
  if (job.fileId) temporarySongs.delete(job.fileId);
  if (job.stackJob && (job.state === "queued" || job.state === "running")) void cancelOrDeleteMusic(job.stackJob);
}
export function pruneMusicJobs(now = Date.now()): void {
  for (const job of memory.values()) if (now - Date.parse(job.createdAt) >= TEMP_MS) dropMusicJob(job);
  for (const [id, song] of temporarySongs) if (now - song.createdAt >= TEMP_MS) temporarySongs.delete(id);
}
export function getMusicJobFor(actor: { id: string }, id: string): MusicJob | null {
  pruneMusicJobs();
  const live = memory.get(id) ?? liveJobs.get(id);
  if (live) return live.personId === actor.id ? live : null;
  const row = db.select().from(musicJobs).where(and(eq(musicJobs.id, id), eq(musicJobs.personId, actor.id))).get();
  return row ? fromRow(row) : null;
}
export function jobsForConversation(actor: { id: string }, conversationId: string, temporary = false): MusicJob[] {
  pruneMusicJobs();
  if (temporary) return [...memory.values()].filter((j) => j.personId === actor.id && j.conversationId === conversationId);
  return db.select().from(musicJobs).where(and(eq(musicJobs.personId, actor.id), eq(musicJobs.conversationId, conversationId))).all().map((r) => liveJobs.get(r.id) ?? fromRow(r));
}
export function activeMusicJobsFor(actor: { id: string }): number {
  pruneMusicJobs();
  const ids = new Set([...memory.values(), ...liveJobs.values()].filter((j) => j.personId === actor.id && (j.state === "queued" || j.state === "running")).map((j) => j.id));
  for (const row of db.select({ id: musicJobs.id }).from(musicJobs).where(and(eq(musicJobs.personId, actor.id), inArray(musicJobs.state, ["queued", "running"]))).all()) ids.add(row.id);
  return ids.size;
}
export function musicJobIdsByTurn(actor: { id: string }, turnIds: readonly string[]): Map<string, string> {
  pruneMusicJobs();
  const jobs = [...memory.values()].filter((j) => j.personId === actor.id && j.turnId && turnIds.includes(j.turnId));
  if (turnIds.length) jobs.push(...db.select().from(musicJobs).where(and(eq(musicJobs.personId, actor.id), inArray(musicJobs.turnId, [...turnIds]))).all().map(fromRow));
  const ids = new Map<string, string>();
  for (const job of jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (job.turnId && !ids.has(job.turnId)) ids.set(job.turnId, job.id);
  return ids;
}
export function deleteMusicJobsForTurns(turnIds: string[]): void {
  if (!turnIds.length) return;
  for (const job of [...memory.values(), ...liveJobs.values(), ...db.select().from(musicJobs).where(inArray(musicJobs.turnId, turnIds)).all().map(fromRow)]) if (job.turnId && turnIds.includes(job.turnId)) dropMusicJob(job);
  db.delete(musicJobs).where(inArray(musicJobs.turnId, turnIds)).run();
}
export function deleteMusicJobsForPerson(personId: string): void {
  for (const job of [...memory.values(), ...liveJobs.values(), ...db.select().from(musicJobs).where(eq(musicJobs.personId, personId)).all().map(fromRow)]) if (job.personId === personId) dropMusicJob(job);
  db.delete(musicJobs).where(eq(musicJobs.personId, personId)).run();
}
export function deleteMusicJobsForConversation(conversationId: string): void {
  for (const job of [...memory.values(), ...liveJobs.values(), ...db.select().from(musicJobs).where(eq(musicJobs.conversationId, conversationId)).all().map(fromRow)]) if (job.conversationId === conversationId) dropMusicJob(job);
  db.delete(musicJobs).where(eq(musicJobs.conversationId, conversationId)).run();
}
export function dropTemporaryMusicConversation(conversationId: string): void {
  for (const job of [...memory.values(), ...liveJobs.values()]) if (job.temporary && job.conversationId === conversationId) dropMusicJob(job);
}
export function pendingMusicJobs(): MusicJob[] {
  return db.select().from(musicJobs).where(inArray(musicJobs.state, ["queued", "running"])).all().map(fromRow);
}
export function __removedMusicJobCountForTests(): number { return removed.size; }
export function __resetMusicJobsForTests(): void {
  for (const controller of watching.values()) controller.abort();
  watching.clear(); liveJobs.clear(); memory.clear(); temporarySongs.clear(); removed.clear();
}
