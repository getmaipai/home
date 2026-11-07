// SCHED-02 part A: the hub executor. A device_action or scene task whose executor is `hub` (a recurrence an automation
// cannot express, or Home Assistant's automation API was unavailable when it was made) runs from the scheduler's job loop
// as the core job `schedules.device.fire`. The creator's access is checked again every time it runs. Nothing here writes a
// tool audit row, a log line or an error that carries a task, entity, instance or person id (rule 6a).
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, scheduledJobs, scheduledTasks } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newJobId } from "@/lib/id";
import { nextOccurrence, type JobRow } from "@/lib/scheduler";
import { effectivePermissions } from "@/lib/permissions";
import { houseInstanceLanFetch, type HouseLanFetchDeps } from "@/lib/house/connection";
import { performHouseAction, type HouseActionInput, type HouseActionResult } from "@/lib/house/act";
import type { EffectivePermission } from "@/lib/house/access";
import type { HouseEntity, HouseRegistryResult } from "@/lib/house/registry";
import { checkTargets, instancesOf, isUnknownReason, loadScheduleRegistry, scheduleActor } from "./guard";
import type { TaskRow } from "./store";

export const HUB_FIRE_JOB = "schedules.device.fire";

export type ExecutorDeps = {
  house?: HouseLanFetchDeps;
  loadRegistry?: () => Promise<HouseRegistryResult>;
  permissionsOf?: (personId: string) => EffectivePermission[];
  perform?: (entity: HouseEntity, action: HouseActionInput) => Promise<HouseActionResult>;
  now?: () => Date;
};

/** The next time a hub task is due after `after`, or null when it has no further run. Recurrence is the scheduler's own `nextOccurrence`. */
export function nextRunOf(row: TaskRow, after: Date): Date | null {
  if (row.onceAt !== null) return Date.parse(row.onceAt) > after.getTime() ? new Date(row.onceAt) : null;
  if (row.time === null || row.zone === null) return null;
  return nextOccurrence({ time: row.time, days: JSON.parse(row.days ?? "[]") as number[], zone: row.zone, after });
}

/** Queues the task's next run on the scheduler's job table (one pending job per run; the handler queues the following one). */
export function queueHubRun(row: TaskRow, now: Date = new Date()): void {
  const next = nextRunOf(row, now);
  if (!next) return;
  db.insert(scheduledJobs).values({
    id: newJobId(), kind: "core", packageId: "core", job: HUB_FIRE_JOB, personId: row.person, inputs: JSON.stringify({ taskId: row.id }),
    when: next.toISOString(), recurring: false, nextRunAt: next.toISOString(), status: "pending", createdAt: now.toISOString(),
  }).run();
}

export function pauseTask(taskId: string, reason: "grant_revoked" | "scene_changed" | "automation_unavailable" | "owner_removed", now: Date = new Date()): void {
  db.update(scheduledTasks).set({ state: "paused", pausedReason: reason, externalRef: null, updatedAt: now.toISOString(), hlc: nextHlc() }).where(eq(scheduledTasks.id, taskId)).run();
}

function inputOf(name: string, value: number | undefined): HouseActionInput { return { name, ...(value !== undefined ? { value } : {}) } as HouseActionInput; }

/** The core job handler. Never throws a message that names anything; a failure is recorded on the job row as plain text. */
export async function fireHubDeviceTask(job: JobRow, deps: ExecutorDeps = {}): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const taskId = (JSON.parse(job.inputs) as { taskId?: unknown }).taskId;
  const row = typeof taskId === "string" ? db.select().from(scheduledTasks).where(eq(scheduledTasks.id, taskId)).get() : undefined;
  if (!row || row.deletedAt !== null || row.state !== "active" || row.executor !== "hub") return;

  // Queue the following run first, so a failed run never ends a repeating schedule.
  if (row.onceAt !== null) db.update(scheduledTasks).set({ state: "done", updatedAt: now.toISOString(), hlc: nextHlc() }).where(eq(scheduledTasks.id, row.id)).run();
  else queueHubRun(row, new Date(Math.max(now.getTime(), Date.parse(job.nextRunAt))));

  const person = db.select({ id: people.id, role: people.role, deletedAt: people.deletedAt, enabled: people.enabled }).from(people).where(eq(people.id, row.person)).get();
  const actor = person && person.deletedAt === null && person.enabled ? scheduleActor(person) : null;
  if (!actor) { pauseTask(row.id, "grant_revoked", now); return; }
  const what = JSON.parse(row.what) as { targets: string[]; action: string; value?: number };
  const registry = await (deps.loadRegistry ?? (() => loadScheduleRegistry(instancesOf(what.targets))))();
  if (!registry.ok) throw new Error("Home Assistant did not answer, so a scheduled home action was skipped.");
  const checked = checkTargets({ actor, permissions: (deps.permissionsOf ?? effectivePermissions)(row.person), entities: registry.entities, targets: what.targets });
  // A target the registry could not show (a partial read, Home Assistant restarting) skips this run; only a real denial pauses.
  if (!checked.ok) {
    if (!isUnknownReason(checked.reason)) pauseTask(row.id, checked.reason === "scene_changed" ? "scene_changed" : "grant_revoked", now);
    return;
  }

  const action = inputOf(what.action === "activate" ? "activate" : what.action, what.value);
  let failed = 0;
  for (const entity of checked.entities) {
    const result = await (deps.perform ?? (async (target, act) => {
      const connection = houseInstanceLanFetch(target.instance ?? "default", deps.house);
      return connection.ok ? performHouseAction({ lanFetch: connection.lanFetch, token: connection.token, entity: target, action: act }) : { ok: false as const, kind: "unreachable" as const };
    }))(entity, action);
    if (!result.ok) failed += 1;
  }
  if (failed > 0) throw new Error("A scheduled home action could not reach every device.");
}
