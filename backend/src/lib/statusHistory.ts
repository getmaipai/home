import { desc, eq } from "drizzle-orm";
import { StatusEvent, type StatusEvent as StatusEventRecord } from "@maipai/spec/gen/ts/status-event.js";
import type { StatusComponent } from "@maipai/spec/gen/ts/status-component.js";
import { db } from "@/db";
import { statusEvents, statusHeartbeat } from "@/db/schema";
import { collectHealth, type HealthSnapshot } from "@/lib/healthSnapshot";
import { activeMaintenanceComponents } from "@/lib/statusBoard";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@maipai/core/src/id";
import type { InternetState } from "@/lib/internetProbe";
import { knownServiceComponents } from "@/lib/serviceHealth";
import { reconcileServiceBlockIssues, serviceState } from "@/lib/serviceHealth";
import { roleHealth } from "@/lib/roleHealth";
import { configuredServiceComponents } from "@/lib/appNeeds";
import { isRemoteStackSelected } from "@/lib/stackEngine";
import { getEngineLink } from "@/lib/stack/link";
import type { LinkState as EngineLinkState } from "@maipai/spec/gen/ts/link-state";

export type StatusState = StatusEventRecord["state"];
type ComponentStateMap = Partial<Record<StatusComponent, StatusState>>;
const baseComponents: StatusComponent[] = ["chat", "embed", "background", "voice", "library", "hub", "internet"];
type HistoryState = StatusState | "none";
const statePriority: Record<StatusState, number> = { operational: 1, maintenance: 2, degraded: 3, outage: 4 };

/** Build the public, detail-free UTC history view from component transitions. */
export function buildStatusHistory(days: number, now: Date = new Date()) {
  const end = now.getTime();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const windowStart = todayStart - (days - 1) * 86_400_000;
  const startIso = new Date(windowStart).toISOString();
  const rows = db.select({ component: statusEvents.component, state: statusEvents.state, at: statusEvents.at })
    .from(statusEvents).orderBy(statusEvents.at).all();
  const serviceComponents = configuredServiceComponents();
  const components = [...baseComponents, ...(isRemoteStackSelected() ? ["engine_computer" as const] : []), ...serviceComponents] as StatusComponent[];
  const generated_at = now.toISOString();
  const output = components.map((component) => {
    const all = rows.filter((row) => row.component === component);
    const prior = all.filter((row) => row.at < startIso).at(-1);
    const inWindow = all.filter((row) => row.at >= startIso && Date.parse(row.at) <= end);
    const first = prior ?? inWindow[0];
    const currentRow = all.filter((row) => Date.parse(row.at) <= end).at(-1);
    const buckets = Array.from({ length: days }, (_, index) => ({
      date: new Date(windowStart + index * 86_400_000).toISOString().slice(0, 10),
      worst: "none" as HistoryState,
      minutes: { operational: 0, degraded: 0, outage: 0, maintenance: 0 },
    }));
    let operational = 0;
    let known = 0;
    let maintenance = 0;
    if (first) {
      const timeline = all.filter((row) => Date.parse(row.at) <= end);
      for (let i = 0; i < timeline.length; i++) {
        const row = timeline[i]!;
        const from = Math.max(windowStart, Date.parse(row.at));
        const next = timeline[i + 1];
        const to = Math.min(end, next ? Date.parse(next.at) : end);
        if (to <= from) continue;
        let cursor = from;
        while (cursor < to) {
          const dayIndex = Math.floor((cursor - windowStart) / 86_400_000);
          if (dayIndex < 0 || dayIndex >= days) break;
          const segmentEnd = Math.min(to, windowStart + (dayIndex + 1) * 86_400_000);
          const minutes = Math.floor(segmentEnd / 60_000) - Math.floor(cursor / 60_000);
          if (minutes <= 0) { cursor = segmentEnd; continue; }
          const bucket = buckets[dayIndex]!;
          bucket.minutes[row.state] += minutes;
          bucket.worst = bucket.worst === "none" || statePriority[row.state] > statePriority[bucket.worst as StatusState] ? row.state : bucket.worst;
          known += minutes;
          if (row.state === "operational") operational += minutes;
          if (row.state === "maintenance") maintenance += minutes;
          cursor = segmentEnd;
        }
      }
    }
    return {
      component,
      uptime_percent: known - maintenance > 0 ? Number((operational / (known - maintenance) * 100).toFixed(3)) : null,
      days: buckets,
      current: currentRow ? { state: currentRow.state as HistoryState, since: currentRow.at } : { state: "none" as const, since: null },
    };
  });

  const incidents: Array<{ component: StatusComponent; started_at: string; ended_at: string | null; minutes: number; ongoing: boolean }> = [];
  for (const component of components) {
    const timeline = rows.filter((row) => row.component === component && Date.parse(row.at) <= end);
    for (let i = 0; i < timeline.length; i++) {
      const row = timeline[i]!;
      if (row.state !== "outage") continue;
      const next = timeline.slice(i + 1).find((candidate) => candidate.state !== "outage");
      const from = Math.max(windowStart, Date.parse(row.at));
      const to = Math.min(end, next ? Date.parse(next.at) : end);
      if (to <= from) continue;
      incidents.push({ component, started_at: row.at, ended_at: next?.at ?? null,
        minutes: Math.round((to - Math.max(windowStart, Date.parse(row.at))) / 60_000), ongoing: !next });
    }
  }
  incidents.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return { generated_at, days, components: output, incidents: incidents.slice(0, 20) };
}

// Keep this mapping aligned with frontend/src/apps/chat/chatAvailability.ts.
// That function is the UI's single definition of engine availability.
export function componentStatesFrom(health: HealthSnapshot, maintenanceParts: Set<string>, engineComputer: EngineLinkState["state"] | null = isRemoteStackSelected() ? getEngineLink()?.snapshot().state ?? "offline" : null): ComponentStateMap {
  const result: ComponentStateMap = {};
  for (const role of ["chat", "embed", "background", "voice"] as const) {
    const { kind, alive } = health.engines[role]!;
    const state: StatusState = ["blocked", "failed", "stalled", "stopped"].includes(kind) ||
      (["url", "override", "selection", "spawned"].includes(kind) && alive === false) ? "outage"
      : ["starting", "restarting"].includes(kind) ? "degraded" : "operational";
    result[role] = maintenanceParts.has(role) ? "maintenance" : state;
  }

  const library = health.sidecars.find((sidecar) => sidecar.id === "kiwix-serve");
  if (maintenanceParts.has("library")) {
    result.library = "maintenance";
  } else if (library) {
    const libraryState: StatusState | undefined = library.status === "running" ? "operational"
      : library.status === "starting" ? "degraded"
      : library.status === "unhealthy" || library.status === "crashed" ? "outage" : undefined;
    if (libraryState) result.library = libraryState;
  }
  result.hub = maintenanceParts.has("hub") ? "maintenance" : "operational";
  if (engineComputer) result.engine_computer = engineComputer === "ready" ? "operational"
    : engineComputer === "degraded" ? "degraded" : engineComputer === "offline" ? "outage" : "degraded";
  return result;
}

async function liveComponentStatesFrom(health: HealthSnapshot, maintenanceParts: Set<string>): Promise<ComponentStateMap> {
  const result = componentStatesFrom(health, maintenanceParts);
  for (const role of ["chat", "embed", "background", "voice"] as const) {
    const availability = await roleHealth(role);
    if (maintenanceParts.has(role)) result[role] = "maintenance";
    else result[role] = availability.availability === "unavailable" ? "outage"
      : availability.availability === "starting" ? "degraded" : "operational";
  }
  return result;
}

let healthForTests: HealthSnapshot | undefined;
export function __setStatusHistoryHealthForTests(health: HealthSnapshot | undefined): void {
  healthForTests = health;
}

function upsertHeartbeat(now: Date): void {
  db.insert(statusHeartbeat).values({ id: 1, lastSeenAt: now.toISOString() })
    .onConflictDoUpdate({ target: statusHeartbeat.id, set: { lastSeenAt: now.toISOString() } }).run();
}

function writeEvent(component: StatusComponent, state: StatusState, at: Date, source: StatusEventRecord["source"]): void {
  const event = StatusEvent.parse({
    id: `sev-${randomSuffix(10)}`,
    component,
    state,
    at: at.toISOString(),
    source,
    detail: null,
    hlc: nextHlc(),
  });
  db.insert(statusEvents).values(event).run();
}

function lastState(component: StatusComponent): StatusState | undefined {
  return db.select({ state: statusEvents.state }).from(statusEvents).where(eq(statusEvents.component, component))
    .orderBy(desc(statusEvents.at)).limit(1).get()?.state;
}

/** Store only state transitions and keep the heartbeat fresh. Sampling must never interrupt startup or the interval caller. */
export async function recordStatusSample(now: Date = new Date(), internet?: InternetState | null): Promise<void> {
  try {
    const health = healthForTests ?? await collectHealth();
    const maintenance = activeMaintenanceComponents(now);
    const states = await liveComponentStatesFrom(health, maintenance);
    const configuredServices = new Set(configuredServiceComponents());
    const serviceComponents = knownServiceComponents().filter((component) => configuredServices.has(component));
    for (const component of [...baseComponents, ...(isRemoteStackSelected() ? ["engine_computer" as const] : []), ...new Set(serviceComponents)] as StatusComponent[]) {
      const service = component.startsWith("service:") ? serviceState(component, now.getTime()) : null;
      const state: StatusState | undefined = service ? service === "unknown" ? undefined : service === "outage" ? "outage" : service : states[component];
      if (!state || state === lastState(component)) continue;
      writeEvent(component, state, now, state === "maintenance" ? "maintenance" : "sample");
    }
    if (internet) {
      const state: StatusState = maintenance.has("internet") ? "maintenance" : internet === "down" ? "outage" : internet;
      if (state !== lastState("internet")) writeEvent("internet", state, now, "sample");
      await reconcileServiceBlockIssues(now, internet);
    } else {
      await reconcileServiceBlockIssues(now);
    }
    upsertHeartbeat(now);
  } catch (err) {
    console.error(`[status-history] sample failed: ${(err as Error).message}`);
  }
}

/** Record a missing interval across a stopped hub, then establish this boot's heartbeat. */
export async function recordBootGap(now: Date = new Date()): Promise<void> {
  try {
    const heartbeat = db.select().from(statusHeartbeat).where(eq(statusHeartbeat.id, 1)).get();
    if (heartbeat) {
      const previous = new Date(heartbeat.lastSeenAt);
      if (now.getTime() - previous.getTime() > 120_000) {
        writeEvent("hub", "outage", previous, "boot_gap");
        writeEvent("hub", "operational", now, "boot_gap");
      }
    }
    upsertHeartbeat(now);
  } catch (err) {
    console.error(`[status-history] boot-gap record failed: ${(err as Error).message}`);
  }
}

/** Keep each component's most recent pre-window event as the state at the window edge. */
export function pruneStatusEvents(now: Date = new Date()): void {
  try {
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const oldRows = db.select().from(statusEvents).all();
    const candidates = oldRows.filter((row) => row.at < cutoff).sort((a, b) => b.at.localeCompare(a.at));
    const keep = new Set<string>();
    for (const row of candidates) {
      if (!keep.has(row.component)) keep.add(row.component);
      else db.delete(statusEvents).where(eq(statusEvents.id, row.id)).run();
    }
  } catch (err) {
    console.error(`[status-history] prune failed: ${(err as Error).message}`);
  }
}
