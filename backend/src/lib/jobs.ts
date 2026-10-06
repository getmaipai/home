// ACTIVITY-01b: the common visible state for background work. This module
// only records and projects state; producer engines retain execution.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, people, projects, scheduledJobs, approvals } from "@/db/schema";
import { isOwnerOrAdmin } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import { listStackModelDownloadJobs, modelDownloadJobsAsHomeJobs } from "@/lib/jobProducers";
import type { PersonRow } from "@/types";

export type HomeJob = {
  id: string; kind: string; startedBy: string; forPerson: string | null; title: string;
  state: string; progress?: Record<string, unknown> | null; waitingReason?: string | null;
  legacyProgress?: Record<string, unknown> | null;
  resultRef?: string | null; conversationId?: string | null; errorKind?: string | null;
  raw?: string | null; provenance?: Record<string, unknown>; createdAt: string; updatedAt: string;
};

export function visibleJobFor(actor: PersonRow, job: HomeJob, roleOf?: Map<string, string>): Record<string, unknown> | null {
  const full = (includeRaw: boolean): Record<string, unknown> => {
    const value = { ...job } as Record<string, unknown>;
    if (speakerAgeBand(actor, new Date()) !== "adult" && job.progress) {
      const progress = { ...job.progress };
      delete progress.eta_seconds;
      delete progress.etaSeconds;
      value.progress = progress;
    }
    if (!includeRaw || speakerAgeBand(actor, new Date()) !== "adult") delete value.raw;
    return value;
  };
  if (job.forPerson === null) return isOwnerOrAdmin(actor) ? full(true) : null;
  if (job.forPerson === actor.id) return full(isOwnerOrAdmin(actor));
  const target = db.select().from(people).where(eq(people.id, job.forPerson)).get();
  const targetRole = roleOf?.get(job.forPerson) ?? target?.role;
  const band = targetRole === "child" ? "child" : targetRole === "teen" ? "teen" : target ? speakerAgeBand(target, new Date()) : "adult";
  if (isOwnerOrAdmin(actor)) {
    if (band === "child") return full(true);
    if (speakerAgeBand(actor, new Date()) !== "adult") return null;
    const durationSeconds = Math.max(0, Math.floor((Date.parse(job.updatedAt) - Date.parse(job.createdAt)) / 1000));
    return { id: job.id, kind: job.kind, forPerson: job.forPerson, durationSeconds };
  }
  return null;
}

export function createJob(input: Omit<HomeJob, "createdAt" | "updatedAt">): HomeJob {
  const now = new Date().toISOString();
  const row = { ...input, progress: input.progress ? JSON.stringify(input.progress) : null, provenance: JSON.stringify(input.provenance), createdAt: now, updatedAt: now };
  db.insert(jobs).values({ id: row.id, kind: row.kind, startedBy: row.startedBy, forPerson: row.forPerson, title: row.title, state: row.state, progress: row.progress, waitingReason: row.waitingReason, resultRef: row.resultRef, conversationId: row.conversationId, errorKind: row.errorKind, raw: row.raw, provenance: row.provenance, createdAt: now, updatedAt: now }).run();
  return { ...input, createdAt: now, updatedAt: now };
}

export function updateJob(id: string, patch: Partial<Pick<HomeJob, "state" | "progress" | "waitingReason" | "resultRef" | "errorKind" | "raw">>): boolean {
  const found = db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id)).get();
  if (!found) return false;
  db.update(jobs).set({ ...patch, progress: patch.progress ? JSON.stringify(patch.progress) : undefined, updatedAt: new Date().toISOString() }).where(eq(jobs.id, id)).run();
  return true;
}

function fromRow(row: typeof jobs.$inferSelect): HomeJob {
  return { ...row, progress: row.progress ? JSON.parse(row.progress) : null, provenance: JSON.parse(row.provenance) };
}

/** A current snapshot across persisted Home producers. Raw producer payloads are
 * deliberately not inferred from titles or prompt-shaped input. */
export function listJobsForViewer(actor: PersonRow): Record<string, unknown>[] {
  const rows = db.select().from(jobs).all().map(fromRow);
  const allPeople = db.select().from(people).all();
  const peopleById = new Map(allPeople.map((p) => [p.id, p]));
  const roles = new Map(allPeople.map((p) => [p.id, p.role]));
  const visible = rows.map((row) => visibleJobFor(actor, row, roles)).filter((row): row is Record<string, unknown> => row !== null);
  if (isOwnerOrAdmin(actor)) visible.push(...modelDownloadJobsAsHomeJobs().map((row) => visibleJobFor(actor, row, roles)).filter((row): row is Record<string, unknown> => row !== null));
  const scheduled = db.select().from(scheduledJobs).all();
  for (const row of scheduled) {
    if (rows.some((job) => job.id === `schedule:${row.id}`)) continue;
    if (row.personId !== actor.id && !(isOwnerOrAdmin(actor) && (row.personId === null || peopleById.has(row.personId)))) continue;
    const updatedAt = row.lastRunAt ?? row.createdAt;
    const state = row.status === "pending" ? "queued" : row.status === "done" ? "done" : row.status;
    const target = row.personId ? peopleById.get(row.personId) : null;
    if (target && row.personId !== actor.id && speakerAgeBand(target, new Date()) !== "child") visible.push({ id: row.id, kind: row.kind === "core" ? row.job : "routine", forPerson: row.personId, durationSeconds: Math.max(0, Math.floor((Date.parse(updatedAt) - Date.parse(row.createdAt)) / 1000)) });
    else visible.push({ id: row.id, kind: row.kind === "core" ? row.job : "routine", startedBy: row.personId ?? "system", forPerson: row.personId, title: row.job, state, createdAt: row.createdAt, updatedAt });
  }
  const projectRows = db.select().from(projects).all();
  for (const row of projectRows) {
    if (row.person !== actor.id) {
      const projectOwner = peopleById.get(row.person);
      if (!isOwnerOrAdmin(actor) || !projectOwner) continue;
      if (speakerAgeBand(projectOwner, new Date()) !== "child") {
        visible.push({ id: row.id, kind: "chat_plan", forPerson: row.person, durationSeconds: Math.max(0, Math.floor((Date.parse(row.updatedAt) - Date.parse(row.createdAt)) / 1000)) });
        continue;
      }
    }
    visible.push({ id: row.id, kind: "chat_plan", startedBy: row.person, forPerson: row.person, title: row.title, state: row.state, progress: null, resultRef: null, createdAt: row.createdAt, updatedAt: row.updatedAt });
  }
  const asks = db.select().from(approvals).all().filter((row) => row.status === "pending" && (row.personId === actor.id || (isOwnerOrAdmin(actor) && peopleById.get(row.personId) && speakerAgeBand(peopleById.get(row.personId)!, new Date()) === "child")));
  for (const row of asks) visible.push({ id: row.id, kind: "approval", startedBy: row.personId, forPerson: row.personId, title: "Waiting for approval", state: "waiting_for_you", createdAt: row.createdAt, updatedAt: row.createdAt });
  return visible.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

export async function listJobsForViewerLive(actor: PersonRow): Promise<Record<string, unknown>[]> {
  const local = listJobsForViewer(actor);
  if (!isOwnerOrAdmin(actor)) return local;
  const allPeople = db.select().from(people).all();
  const roles = new Map(allPeople.map((person) => [person.id, person.role]));
  const stack = await listStackModelDownloadJobs();
  const projected = stack.map((job) => visibleJobFor(actor, job, roles)).filter((job): job is Record<string, unknown> => job !== null);
  return [...local.filter((job) => !String(job.id).startsWith("model:")), ...projected].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

export function canStopJob(actor: PersonRow, ownerId: string | null, startedBy: string): boolean {
  return ownerId === actor.id || (startedBy === actor.id) || (isOwnerOrAdmin(actor) && ownerId !== null && ownerId !== actor.id);
}
