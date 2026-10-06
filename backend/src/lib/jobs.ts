// ACTIVITY-01b: the common visible state for background work. This module
// only records and projects state; producer engines retain execution.
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { jobs, people, projects, scheduledJobs, approvals, conversations } from "@/db/schema";
import { isOwnerOrAdmin } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import { summarizeApproval } from "@/lib/approvals";
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

/** ACTIVITY-01d: a person's own scheduled core job (a reminder or a timer,
 * packageHost.ts) in plain words; the engine's job name never reaches the
 * panel. */
function plainScheduledJob(kind: string, job: string, inputs: string): { kind: string; title: string } {
  if (kind !== "core") return { kind: "routine", title: job };
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(inputs) as Record<string, unknown>; } catch { parsed = {}; }
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : "");
  if (job === "reminders.fire") return { kind: "reminder", title: text(parsed.task) ? `Reminder: ${text(parsed.task)}` : "Reminder" };
  if (job === "timers.fire") return { kind: "timer", title: text(parsed.label) ? `Timer: ${text(parsed.label)}` : "Timer" };
  return { kind: job, title: "Scheduled task" };
}

/** A current snapshot across persisted Home producers. Raw producer payloads are
 * deliberately not inferred from titles or prompt-shaped input. */
export function listJobsForViewer(actor: PersonRow): Record<string, unknown>[] {
  const rows = db.select().from(jobs).all().map(fromRow);
  const allPeople = db.select().from(people).all();
  const peopleById = new Map(allPeople.map((p) => [p.id, p]));
  const roles = new Map(allPeople.map((p) => [p.id, p.role]));
  // ACTIVITY-01d: `actions` is the set the panel may offer this viewer.
  // Only rows in the jobs table have a stop route today; every other
  // producer below is listed with none until it gains one.
  const visible: Record<string, unknown>[] = [];
  for (const row of rows) {
    const view = visibleJobFor(actor, row, roles);
    if (!view) continue;
    // ACTIVITY-01d: an admin reading a child's job sees whose it is.
    const forName = row.forPerson && row.forPerson !== actor.id && "title" in view ? peopleById.get(row.forPerson)?.displayName : undefined;
    visible.push({ ...view, actions: jobActionsFor(actor, row), ...(forName ? { forPersonName: forName } : {}) });
  }
  if (isOwnerOrAdmin(actor)) visible.push(...modelDownloadJobsAsHomeJobs().map((row) => visibleJobFor(actor, row, roles)).filter((row): row is Record<string, unknown> => row !== null).map((row) => ({ ...row, actions: [] })));
  const scheduled = db.select().from(scheduledJobs).all();
  for (const row of scheduled) {
    if (rows.some((job) => job.id === `schedule:${row.id}`)) continue;
    // ACTIVITY-01d: the hub's own housekeeping (core jobs for nobody) is
    // not anyone's work, and a schedule waiting for a later time is not in
    // progress; listing either filled the panel with engine names.
    if (row.kind === "core" && row.personId === null) continue;
    if (row.status === "pending" && Date.parse(row.nextRunAt) > Date.now()) continue;
    if (row.personId !== actor.id && !(isOwnerOrAdmin(actor) && (row.personId === null || peopleById.has(row.personId)))) continue;
    const updatedAt = row.lastRunAt ?? row.createdAt;
    const state = row.status === "pending" ? "queued" : row.status === "done" ? "done" : row.status;
    const target = row.personId ? peopleById.get(row.personId) : null;
    if (target && row.personId !== actor.id && speakerAgeBand(target, new Date()) !== "child") visible.push({ id: row.id, kind: row.kind === "core" ? row.job : "routine", forPerson: row.personId, durationSeconds: Math.max(0, Math.floor((Date.parse(updatedAt) - Date.parse(row.createdAt)) / 1000)), actions: [] });
    else {
      const plain = plainScheduledJob(row.kind, row.job, row.inputs);
      visible.push({ id: row.id, kind: plain.kind, startedBy: row.personId ?? "system", forPerson: row.personId, title: plain.title, state, createdAt: row.createdAt, updatedAt, actions: [] });
    }
  }
  const projectRows = db.select().from(projects).all();
  for (const row of projectRows) {
    if (row.person !== actor.id) {
      const projectOwner = peopleById.get(row.person);
      if (!isOwnerOrAdmin(actor) || !projectOwner) continue;
      if (speakerAgeBand(projectOwner, new Date()) !== "child") {
        visible.push({ id: row.id, kind: "chat_plan", forPerson: row.person, durationSeconds: Math.max(0, Math.floor((Date.parse(row.updatedAt) - Date.parse(row.createdAt)) / 1000)), actions: [] });
        continue;
      }
    }
    visible.push({ id: row.id, kind: "chat_plan", startedBy: row.person, forPerson: row.person, title: row.title, state: row.state, progress: null, resultRef: null, createdAt: row.createdAt, updatedAt: row.updatedAt, actions: [] });
  }
  const asks = db.select().from(approvals).all().filter((row) => row.status === "pending" && (row.personId === actor.id || (isOwnerOrAdmin(actor) && peopleById.get(row.personId) && speakerAgeBand(peopleById.get(row.personId)!, new Date()) === "child")));
  // ACTIVITY-01d: an ask reads as what was asked, in plain words. The
  // asker is offered nothing (a child's view says "Asked a parent"); an
  // admin deciding a child's ask is offered approve and deny, the same
  // decision the approvals routes already enforce.
  for (const row of asks) {
    const what = summarizeApproval(row.kind, JSON.parse(row.details) as Record<string, unknown>);
    const own = row.personId === actor.id;
    const asker = peopleById.get(row.personId)?.displayName ?? "Someone";
    visible.push({ id: row.id, kind: "approval", startedBy: row.personId, forPerson: row.personId, title: own ? `Asked to ${what}` : `${asker} asked to ${what}`, state: "waiting_for_you", createdAt: row.createdAt, updatedAt: row.createdAt, actions: own ? [] : ["approve", "deny"] });
  }
  // APPROVE-CALM-01: a chat parked on the viewer's own yes or no (the
  // approval card in that chat) waits on them too. Only the owner of the
  // chat sees it; the panel opens the chat, where the card answers it.
  const waitingChats = db.select({ id: conversations.id, title: conversations.title, pendingAsk: conversations.pendingAsk, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(eq(conversations.personId, actor.id), eq(conversations.status, "open"), isNotNull(conversations.pendingAsk)))
    .all();
  for (const chat of waitingChats) {
    let kind: unknown;
    try { kind = (JSON.parse(chat.pendingAsk ?? "null") as { kind?: unknown } | null)?.kind; } catch { kind = undefined; }
    if (kind !== "confirm") continue;
    visible.push({ id: `ask:${chat.id}`, kind: "chat_ask", startedBy: actor.id, forPerson: actor.id, title: chat.title?.trim() || "A chat", state: "waiting_for_you", conversationId: chat.id, createdAt: chat.createdAt, updatedAt: chat.updatedAt, actions: ["open"] });
  }
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

/** ACTIVITY-01d (UI-STUDY.md 8.4): a child stops only what they started
 * themselves, never a job a parent started for them. */
export function canStopJob(actor: PersonRow, ownerId: string | null, startedBy: string): boolean {
  if (speakerAgeBand(actor, new Date()) === "child") return startedBy === actor.id;
  return ownerId === actor.id || (startedBy === actor.id) || (isOwnerOrAdmin(actor) && ownerId !== null && ownerId !== actor.id);
}

const STOPPABLE_STATES = new Set(["queued", "running", "paused", "waiting_for_you"]);

function jobActionsFor(actor: PersonRow, job: HomeJob): string[] {
  return STOPPABLE_STATES.has(job.state) && canStopJob(actor, job.forPerson, job.startedBy) ? ["stop"] : [];
}
