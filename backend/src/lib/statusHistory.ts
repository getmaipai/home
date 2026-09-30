import { desc, eq } from "drizzle-orm";
import { StatusEvent, type StatusEvent as StatusEventRecord } from "@maipai/spec/gen/ts/status-event.js";
import type { StatusComponent } from "@maipai/spec/gen/ts/status-component.js";
import { db } from "@/db";
import { statusEvents, statusHeartbeat } from "@/db/schema";
import { collectHealth, type HealthSnapshot } from "@/lib/healthSnapshot";
import { activeMaintenanceComponents } from "@/lib/statusBoard";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@maipai/core/src/id";

export type StatusState = StatusEventRecord["state"];
type ComponentStateMap = Partial<Record<StatusComponent, StatusState>>;
const components: StatusComponent[] = ["chat", "embed", "background", "voice", "library", "hub"];

// Keep this mapping aligned with frontend/src/apps/chat/chatAvailability.ts.
// That function is the UI's single definition of engine availability.
export function componentStatesFrom(health: HealthSnapshot, maintenanceParts: Set<string>): ComponentStateMap {
  const result: ComponentStateMap = {};
  for (const role of ["chat", "embed", "background", "voice"] as const) {
    const { kind, alive } = health.engines[role];
    const state: StatusState = ["blocked", "failed", "stalled", "stopped"].includes(kind) ||
      (["url", "override", "selection", "spawned"].includes(kind) && alive === false)
      ? "outage"
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
export async function recordStatusSample(now: Date = new Date()): Promise<void> {
  try {
    const health = healthForTests ?? await collectHealth();
    const states = componentStatesFrom(health, activeMaintenanceComponents(now));
    for (const component of components) {
      const state = states[component];
      if (!state || state === lastState(component)) continue;
      writeEvent(component, state, now, state === "maintenance" ? "maintenance" : "sample");
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
