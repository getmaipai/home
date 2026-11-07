// SCHED-02 part A: keeps Home Assistant's `maipai_` automations and the scheduled_tasks table in step. It runs on every
// Home Assistant connect (the events socket opening, the registry cache loading) and:
//  (a) recreates the automation of an active home_assistant task that has none,
//  (b) deletes a `maipai_` automation that has no task row,
//  (c) pauses a task whose creator can no longer control a target (paused_reason grant_revoked) and deletes its automation,
//  (d) pauses a scheduled scene that now sets a sensitive or ungranted item (paused_reason scene_changed), same way.
// Drift raises ONE Repairs issue per kind carrying a COUNT only: no title, entity, instance or person (rule 6a, C3).
// It never touches an automation whose id does not start `maipai_`, and it acts only on a complete, readable list.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people, scheduledTasks } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { effectivePermissions } from "@/lib/permissions";
import { listInstances } from "@/lib/connectors/instances";
import { houseInstanceLanFetch } from "@/lib/house/connection";
import { onHouseConnected, onScheduleRecheck } from "@/lib/house/connectHooks";
import { buildAutomationBody, createAutomation, deleteAutomation, listMaipaiAutomationIds, newAutomationId, readHouseTimeZone } from "@/lib/house/automations";
import { checkTargets, instancesOf, isUnknownReason, loadScheduleRegistry, scheduleActor } from "./guard";
import { pauseTask } from "./executor";
import { automationDeps, automationSpecOf, instanceOfRow, pendingAutomationIds, type ScheduleDeps } from "./store";

export type ReconcileReport = { recreated: number; orphansRemoved: number; grantRevoked: number; sceneChanged: number; finished: number };
export type ReconcileResult = { ran: false; reason: "no_connection" | "unreadable" | "busy" } | { ran: true; report: ReconcileReport };

const ISSUE_SOURCE = "schedules";
const UNREADABLE_KEY = "schedules_unreadable";
const KEYS = { recreated: "drift-missing", orphansRemoved: "drift-orphan", grantRevoked: "drift-grant-revoked", sceneChanged: "drift-scene-changed" } as const;
const WORDS: Record<keyof typeof KEYS, { title: string; one: string; many: string }> = {
  recreated: { title: "Home Assistant schedules were put back", one: "1 schedule was missing from Home Assistant and Home made it again.", many: "schedules were missing from Home Assistant and Home made them again." },
  orphansRemoved: { title: "Home Assistant had schedules Home does not know", one: "1 automation made by Home had no schedule in Home and was removed.", many: "automations made by Home had no schedule in Home and were removed." },
  grantRevoked: { title: "Schedules paused: access changed", one: "1 schedule is paused because its owner can no longer control the device.", many: "schedules are paused because their owners can no longer control the device." },
  sceneChanged: { title: "Schedules paused: a scene changed", one: "1 scheduled scene is paused because it now sets something a schedule may not run.", many: "scheduled scenes are paused because they now set something a schedule may not run." },
};

const inFlight = new Map<string, Promise<ReconcileResult>>();

export function reconcileSchedules(instance: string, deps: ScheduleDeps = {}): Promise<ReconcileResult> {
  const running = inFlight.get(instance);
  if (running) return running.then(() => ({ ran: false as const, reason: "busy" as const }));
  const work = reconcileOnce(instance, deps).finally(() => { inFlight.delete(instance); });
  inFlight.set(instance, work);
  return work;
}

async function reconcileOnce(instance: string, deps: ScheduleDeps): Promise<ReconcileResult> {
  const connection = houseInstanceLanFetch(instance, automationDeps(deps));
  if (!connection.ok) return { ran: false, reason: "no_connection" };
  const listed = await listMaipaiAutomationIds({ lanFetch: connection.lanFetch, token: connection.token });
  if (!listed.ok) {
    // Visible, count-free, and it changes nothing: a list that cannot be read is never treated as an empty one.
    await raiseIssue({ source: ISSUE_SOURCE, key: UNREADABLE_KEY, severity: "warning", title: "Home could not check its Home Assistant schedules", detail: "Home Assistant did not return a list Home could read. Home will try again in a few minutes.", fix: null });
    return { ran: false, reason: "unreadable" };
  }
  resolveIssue(ISSUE_SOURCE, UNREADABLE_KEY, { suppressNotification: true });
  const present = new Set(listed.ids);
  const now = (deps.now ?? (() => new Date()))();
  const report: ReconcileReport = { recreated: 0, orphansRemoved: 0, grantRevoked: 0, sceneChanged: 0, finished: 0 };
  const remove = (id: string) => deleteAutomation({ lanFetch: connection.lanFetch, token: connection.token, id });

  const live = db.select().from(scheduledTasks).where(and(eq(scheduledTasks.executor, "home_assistant"), isNull(scheduledTasks.deletedAt))).all()
    .filter((row) => instanceOfRow(row) === instance);

  // A one-shot whose time has passed is done; its automation is no longer needed.
  for (const row of live.filter((item) => item.state === "active" && item.onceAt !== null && Date.parse(item.onceAt) < now.getTime() - 60_000)) {
    if (row.externalRef !== null && present.has(row.externalRef)) { await remove(row.externalRef); present.delete(row.externalRef); }
    db.update(scheduledTasks).set({ state: "done", externalRef: null, updatedAt: now.toISOString(), hlc: nextHlc() }).where(eq(scheduledTasks.id, row.id)).run();
    report.finished += 1;
  }

  // (c) and (d): access is checked from the live registry; a registry that cannot be read pauses nothing.
  const registry = await (deps.loadRegistry ? deps.loadRegistry() : loadScheduleRegistry([instance]));
  const active = db.select().from(scheduledTasks).where(and(eq(scheduledTasks.executor, "home_assistant"), eq(scheduledTasks.state, "active"), isNull(scheduledTasks.deletedAt))).all()
    .filter((row) => instanceOfRow(row) === instance);
  const entities = registry.ok ? registry.entities : null;
  for (const row of entities ? active : []) {
    const person = db.select({ id: people.id, role: people.role, deletedAt: people.deletedAt, enabled: people.enabled }).from(people).where(eq(people.id, row.person)).get();
    const actor = person && person.deletedAt === null && person.enabled ? scheduleActor(person) : null;
    const snapshot = JSON.parse(row.grantSnapshot) as string[];
    const checked = actor
      ? checkTargets({ actor, permissions: (deps.permissionsOf ?? effectivePermissions)(row.person), entities: entities!, targets: snapshot })
      : ({ ok: false, reason: "no_access" } as const);
    // A target or scene member the registry could not show (a partial read, Home Assistant restarting) is not a revoked grant: skip.
    if (checked.ok || isUnknownReason(checked.reason)) continue;
    const sceneChange = checked.reason === "scene_changed";
    if (row.externalRef !== null && present.has(row.externalRef)) { await remove(row.externalRef); present.delete(row.externalRef); }
    pauseTask(row.id, sceneChange ? "scene_changed" : "grant_revoked", now);
  }

  // (a) recreate what is missing from the tasks that are still active, in Home Assistant's own zone only.
  const stillActive = db.select().from(scheduledTasks).where(and(eq(scheduledTasks.executor, "home_assistant"), eq(scheduledTasks.state, "active"), isNull(scheduledTasks.deletedAt))).all()
    .filter((row) => instanceOfRow(row) === instance);
  const missing = stillActive.filter((row) => row.externalRef === null || !present.has(row.externalRef));
  const automationZone = missing.length ? await readHouseTimeZone({ lanFetch: connection.lanFetch, token: connection.token }) : null;
  for (const row of missing) {
    // The task's stored zone is the one its time was meant in; a changed person zone never rebuilds it.
    if (automationZone === null || row.zone !== automationZone) continue;
    const spec = automationSpecOf(row);
    const body = spec ? buildAutomationBody(spec) : null;
    if (!body) continue;
    const fresh = row.externalRef === null;
    const id = row.externalRef ?? (deps.newAutomationId ?? newAutomationId)();
    pendingAutomationIds.add(id);
    const made = await createAutomation({ lanFetch: connection.lanFetch, token: connection.token, id, body });
    if (!made.ok) {
      // A timeout can follow a write that finished; a fresh id is removed so it cannot fire beside a later retry.
      if (fresh) await remove(id);
      pendingAutomationIds.delete(id);
      continue;
    }
    if (fresh) db.update(scheduledTasks).set({ externalRef: id, updatedAt: now.toISOString(), hlc: nextHlc() }).where(eq(scheduledTasks.id, row.id)).run();
    pendingAutomationIds.delete(id);
    present.add(id);
    report.recreated += 1;
  }

  // (b) an automation Home made that no schedule row owns.
  const owned = new Set(db.select({ ref: scheduledTasks.externalRef, deletedAt: scheduledTasks.deletedAt, state: scheduledTasks.state }).from(scheduledTasks).all()
    .flatMap((row) => row.ref !== null && row.deletedAt === null && row.state === "active" ? [row.ref] : []));
  for (const id of present) {
    if (owned.has(id) || pendingAutomationIds.has(id)) continue;
    if ((await remove(id)).ok) report.orphansRemoved += 1;
  }

  await reportDrift(report);
  return { ran: true, report };
}

/** One Repairs issue per drift kind, a count only. Paused kinds count the rows that are paused now, so the issue clears when they do. */
async function reportDrift(report: ReconcileReport): Promise<void> {
  const paused = db.select({ reason: scheduledTasks.pausedReason }).from(scheduledTasks).where(and(eq(scheduledTasks.state, "paused"), isNull(scheduledTasks.deletedAt))).all();
  const counts: Record<keyof typeof KEYS, number> = {
    recreated: report.recreated,
    orphansRemoved: report.orphansRemoved,
    grantRevoked: paused.filter((row) => row.reason === "grant_revoked").length,
    sceneChanged: paused.filter((row) => row.reason === "scene_changed").length,
  };
  for (const kind of Object.keys(KEYS) as Array<keyof typeof KEYS>) {
    const count = counts[kind];
    if (count === 0) { resolveIssue(ISSUE_SOURCE, KEYS[kind], { suppressNotification: true }); continue; }
    const words = WORDS[kind];
    await raiseIssue({ source: ISSUE_SOURCE, key: KEYS[kind], severity: "warning", title: words.title, detail: count === 1 ? words.one : `${count} ${words.many}`, fix: null });
  }
}

const MIN_GAP_MS = 5 * 60_000;
const lastRun = new Map<string, number>();

/** Registers the reconciler on the connect hook. A connect from the events socket always runs; the registry cache's refreshes run at most every five minutes per instance. */
export function registerScheduleReconcile(deps: ScheduleDeps = {}): () => void {
  return onHouseConnected(async (instance, { force }) => {
    const at = Date.now();
    if (!force && at - (lastRun.get(instance) ?? 0) < MIN_GAP_MS) return;
    lastRun.set(instance, at);
    await reconcileSchedules(instance, deps);
  });
}

/** True when at least one active home_assistant task exists, so the periodic pass costs nothing otherwise. */
export function hasActiveAutomationTasks(): boolean {
  return db.select({ id: scheduledTasks.id }).from(scheduledTasks).where(and(eq(scheduledTasks.executor, "home_assistant"), eq(scheduledTasks.state, "active"), isNull(scheduledTasks.deletedAt))).get() !== undefined;
}

/** Every enabled Home Assistant instance, now. The core job `schedules.reconcile` (every 5 minutes) and the access-change recheck both call this, so a revoked grant never waits for a reconnect. */
export async function reconcileAllInstances(deps: ScheduleDeps = {}): Promise<void> {
  if (!hasActiveAutomationTasks()) return;
  for (const { instance } of listInstances("home_assistant", deps.house)) await reconcileSchedules(instance, deps);
}

/** Registers the access-change recheck: a house grant created or revoked, a role change, or a deleted person reconciles at once. */
export function registerScheduleRecheck(deps: ScheduleDeps = {}): () => void {
  return onScheduleRecheck(() => reconcileAllInstances(deps));
}

export function __resetReconcileForTests(): void { lastRun.clear(); inFlight.clear(); }
