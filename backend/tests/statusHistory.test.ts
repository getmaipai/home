import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { db } from "@/db";
import { maintenanceWindows, statusEvents, statusHeartbeat } from "@/db/schema";
import { componentStatesFrom, recordBootGap, recordStatusSample, pruneStatusEvents, __setStatusHistoryHealthForTests } from "@/lib/statusHistory";
import type { HealthSnapshot } from "@/lib/healthSnapshot";
import type { StatusComponent } from "@maipai/spec/gen/ts/status-component.js";
import { activeMaintenanceComponents, createMaintenance, type MaintenanceInput } from "@/lib/statusBoard";
import { buildStatusHistory } from "@/lib/statusHistory";
import { resetDb } from "./reset-db";

type EngineKind = HealthSnapshot["engines"]["chat"]["kind"];

const kinds: EngineKind[] = ["url", "override", "selection", "stub", "stopped", "starting", "stalled", "none", "spawned", "restarting", "failed", "blocked"];
const aliveValues: Array<boolean | null> = [true, false, null];
const baseHealth = (): HealthSnapshot => ({
  sidecars: [], brain: "none", voice: "none", ok: true, uptimeSeconds: 1,
  engines: Object.fromEntries(["chat", "embed", "background", "voice"].map((role) => [role, { kind: "none", alive: null, pid: null }])) as HealthSnapshot["engines"],
});

beforeEach(() => {
  resetDb();
  db.delete(statusEvents).run();
  db.delete(statusHeartbeat).run();
  db.delete(maintenanceWindows).run();
  __setStatusHistoryHealthForTests(undefined);
});
afterEach(() => __setStatusHistoryHealthForTests(undefined));

describe("componentStatesFrom", () => {
  test.each(kinds.flatMap((kind) => aliveValues.map((alive) => ({ kind, alive }))))("engine $kind with alive=$alive follows chatAvailability", ({ kind, alive }) => {
    const health = baseHealth();
    health.engines.chat = { kind, alive, pid: null };
    const state = componentStatesFrom(health, new Set()).chat;
    const expected = ["blocked", "failed", "stalled", "stopped"].includes(kind) || (["url", "override", "selection", "spawned"].includes(kind) && alive === false)
      ? "outage"
      : ["starting", "restarting"].includes(kind) ? "degraded" : "operational";
    expect(state).toBe(expected);
  });

  test.each([
    { status: "running", expected: "operational" }, { status: "starting", expected: "degraded" },
    { status: "unhealthy", expected: "outage" }, { status: "crashed", expected: "outage" }, { status: "stopped", expected: undefined },
  ] as const)("library sidecar $status maps to $expected", ({ status, expected }) => {
    const health = baseHealth();
    health.sidecars = [{ id: "kiwix-serve", status, baseUrl: null }];
    expect(componentStatesFrom(health, new Set()).library).toBe(expected);
  });

  test("absent library has no state, hub is operational, and maintenance overrides health", () => {
    const health = baseHealth();
    health.engines.chat = { kind: "failed", alive: false, pid: null };
    expect(componentStatesFrom(health, new Set())).toEqual({ chat: "outage", embed: "operational", background: "operational", voice: "operational", hub: "operational" });
    expect(componentStatesFrom(health, new Set(["chat"])).chat).toBe("maintenance");
    expect(componentStatesFrom(health, new Set()).library).toBeUndefined();
    expect(componentStatesFrom(health, new Set(["library"])).library).toBe("maintenance");
  });
});

describe("status event recording", () => {
  test("a recurring maintenance occurrence is recorded as maintenance minutes and excluded from uptime", async () => {
    const start = new Date("2026-10-01T12:00:00.000Z");
    const finish = new Date("2026-10-01T14:00:00.000Z");
    const actor = { id: "person-owner0001", displayName: "Sage" };
    const input: MaintenanceInput = { title: "Daily restart", components: ["chat"], startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(), rrule: "FREQ=DAILY", until: "2026-10-03" };
    createMaintenance(actor, input, new Date("2026-10-01T11:00:00.000Z"));
    __setStatusHistoryHealthForTests(baseHealth());
    await recordStatusSample(start);
    await recordStatusSample(new Date(start.getTime() + 60 * 60_000));
    const chat = buildStatusHistory(1, finish).components.find((part) => part.component === "chat")!;
    expect(chat.days[0]?.minutes.maintenance).toBe(60);
    expect(chat.days[0]?.minutes.operational).toBe(60);
    expect(chat.days[0]?.minutes.outage).toBe(0);
    expect(chat.uptime_percent).toBe(100);
  });

  test("first sample writes one row per component with a state", async () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    __setStatusHistoryHealthForTests(baseHealth());
    await recordStatusSample(now);
    expect(db.select().from(statusEvents).all().map((row) => row.component).sort()).toEqual(["background", "chat", "embed", "hub", "voice"]);
    expect(db.select().from(statusHeartbeat).all()).toEqual([{ id: 1, lastSeenAt: now.toISOString() }]);
  });

  test("an identical second sample writes nothing", async () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    __setStatusHistoryHealthForTests(baseHealth());
    await recordStatusSample(now);
    const count = db.select().from(statusEvents).all().length;
    await recordStatusSample(new Date(now.getTime() + 30_000));
    expect(db.select().from(statusEvents).all()).toHaveLength(count);
  });

  test("a state change writes exactly one row", async () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    const health = baseHealth();
    __setStatusHistoryHealthForTests(health);
    await recordStatusSample(now);
    health.engines.chat = { kind: "failed", alive: false, pid: null };
    await recordStatusSample(new Date(now.getTime() + 30_000));
    expect(db.select().from(statusEvents).all().filter((row) => row.component === "chat")).toHaveLength(2);
  });

  test("a maintenance window records maintenance, then the underlying state on return", async () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    __setStatusHistoryHealthForTests(baseHealth());
    await recordStatusSample(now);
    const window: MaintenanceInput = { title: "Engine work", components: ["chat"], startsAt: new Date(now.getTime() + 1).toISOString(), endsAt: new Date(now.getTime() + 60_000).toISOString() };
    createMaintenance({ id: "person-owner1", displayName: "Owner" }, window, now);
    __setStatusHistoryHealthForTests(baseHealth());
    await recordStatusSample(new Date(now.getTime() + 2));
    expect(activeMaintenanceComponents(new Date(now.getTime() + 2)).has("chat")).toBe(true);
    __setStatusHistoryHealthForTests(baseHealth());
    await recordStatusSample(new Date(now.getTime() + 70_000));
    const rows = db.select().from(statusEvents).where(eq(statusEvents.component, "chat")).all();
    expect(rows.map((row) => row.state)).toEqual(["operational", "maintenance", "operational"]);
    expect(rows.map((row) => row.source)).toEqual(["sample", "maintenance", "sample"]);
  });
});

describe("boot gaps and pruning", () => {
  test("an old heartbeat produces an outage and recovery pair at its two times", async () => {
    const old = new Date("2026-09-30T11:00:00.000Z");
    const now = new Date("2026-09-30T12:00:00.000Z");
    db.insert(statusHeartbeat).values({ id: 1, lastSeenAt: old.toISOString() }).run();
    await recordBootGap(now);
    expect(db.select().from(statusEvents).where(eq(statusEvents.component, "hub")).all().map((row) => [row.state, row.at, row.source])).toEqual([
      ["outage", old.toISOString(), "boot_gap"], ["operational", now.toISOString(), "boot_gap"],
    ]);
  });

  test("a recent or missing heartbeat writes no gap events", async () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    db.insert(statusHeartbeat).values({ id: 1, lastSeenAt: new Date(now.getTime() - 119_000).toISOString() }).run();
    await recordBootGap(now);
    expect(db.select().from(statusEvents).all()).toHaveLength(0);
    db.delete(statusHeartbeat).run();
    await recordBootGap(now);
    expect(db.select().from(statusEvents).all()).toHaveLength(0);
  });

  test("pruning keeps the newest pre-cutoff row per component and removes older ones", () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    const cutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
    const add = (id: string, component: StatusComponent, at: number) => db.insert(statusEvents).values({ id, component, state: "operational", at: new Date(at).toISOString(), source: "sample", detail: null, hlc: `${at}:0:test` }).run();
    add("sev-chat-old", "chat", cutoff - 2_000);
    add("sev-chat-edge", "chat", cutoff - 1_000);
    add("sev-chat-new", "chat", cutoff + 1_000);
    add("sev-hub-old", "hub", cutoff - 3_000);
    add("sev-hub-edge", "hub", cutoff - 1_500);
    pruneStatusEvents(now);
    expect(db.select().from(statusEvents).all().map((row) => row.id).sort()).toEqual(["sev-chat-edge", "sev-chat-new", "sev-hub-edge"]);
  });
});

test("fresh database migration creates the two status tables", () => {
  const fresh = new Database(":memory:");
  try {
    migrate(drizzle(fresh), { migrationsFolder: join(import.meta.dir, "../src/db/migrations") });
    expect(fresh.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('status_events', 'status_heartbeat') ORDER BY name").all()).toEqual([
      { name: "status_events" }, { name: "status_heartbeat" },
    ]);
  } finally {
    fresh.close();
  }
});

test("the existing health route keeps its current response shape", async () => {
  const { TestClient } = await import("./client");
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const res = await client.get("/api/health");
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["brain", "engines", "ok", "sidecars", "uptimeSeconds", "voice"]);
});
