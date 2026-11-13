import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "@/app";
import { db } from "@/db";
import { maintenanceWindows, statusEvents, statusNotes } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetServiceHealthForTests, recordServiceOutcome } from "@/lib/serviceHealth";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { startStackFixture } from "./stackFixture";
import { __setHostGuardStateDirForTests } from "@/lib/hostGuard";

beforeEach(() => { resetDb(); __resetServiceHealthForTests(); db.delete(statusNotes).run(); db.delete(maintenanceWindows).run(); db.delete(statusEvents).run(); });
afterEach(() => __setHostGuardStateDirForTests(null));

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return client;
}

// A window that starts ten minutes from now and lasts an hour, so it always
// counts as upcoming whenever the suite runs (fixed dates went stale).
function upcomingWindow(): { starts_at: string; ends_at: string } {
  const start = Date.now() + 10 * 60 * 1000;
  return { starts_at: new Date(start).toISOString(), ends_at: new Date(start + 60 * 60 * 1000).toISOString() };
}

describe("status routes", () => {
  test("engine computer state is available to members while path and probe details stay admin-only", async () => {
    const owner = await ownerClient();
    setHouseholdSettingValue("engines.stack.where", "another_computer");
    const ownerStatus = await (await owner.get("/api/status/engine-computer")).json() as Record<string, unknown>;
    expect(ownerStatus).toMatchObject({ configured: true, state: "not_reachable", reason: "The engine computer is not paired yet." });
    expect(ownerStatus.details).toEqual({ path: null, lastProbeAt: null, contract: null });
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "child", secret: "0000" });
    const person = await created.json() as { id: string };
    const child = new TestClient();
    await child.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" });
    const memberStatus = await (await child.get("/api/status/engine-computer")).json() as Record<string, unknown>;
    expect(memberStatus).toMatchObject({ configured: true, state: "not_reachable", reason: "The engine computer is not paired yet." });
    expect(memberStatus).not.toHaveProperty("details");
    expect(JSON.stringify(memberStatus)).not.toMatch(/ssh|192\.0\.2\.|127\.0\.0\.1/i);
  });
  test("app status is signed-in for everyone and need details are owner/admin only", async () => {
    expect((await new TestClient().get("/api/status/apps")).status).toBe(401);
    const owner = await ownerClient();
    const ownerResponse = await owner.get("/api/status/apps");
    expect(ownerResponse.status).toBe(200);
    const ownerApps = await ownerResponse.json() as Array<{ id: string; needs?: unknown[]; history: Array<{ minutes: { operational: number; degraded: number; outage: number; maintenance: number } }> }>;
    // Core apps first, then every installed package of kind "app" (MEDIA-VIDEOS-01 bundles Videos, MEDIA-PODCASTS-01 Podcasts, MEDIA-BOOKS-01 Books, MEDIA-SHOWS-01 Shows and Films, TALENT-02 Talent).
    expect(ownerApps.map((app) => app.id)).toEqual(["home", "chat", "books", "image", "podcasts", "videos", "shows", "talent"]);
    expect(ownerApps.every((app) => app.needs && app.history.length === 90)).toBe(true);
    expect(ownerApps.every((app) => app.history.every((day) => Object.keys(day.minutes).sort().join(",") === "degraded,maintenance,operational,outage"))).toBe(true);
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "child", secret: "0000" });
    const person = await created.json() as { id: string };
    const child = new TestClient();
    expect((await child.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" })).status).toBe(200);
    const childApps = await (await child.get("/api/status/apps")).json() as Array<{ needs?: unknown[] }>;
    expect(childApps.every((app) => !("needs" in app))).toBe(true);
  });

  test("admin app needs include in-memory service diagnostics, members do not", async () => {
    const owner = await ownerClient();
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:8888");
    await recordServiceOutcome("searxng", { ok: false, status: 429 }, new Date());
    const ownerApps = await owner.get("/api/status/apps");
    const apps = await ownerApps.json() as Array<{ id: string; needs?: Array<Record<string, unknown>> }>;
    const search = apps.find((item) => item.id === "chat")?.needs?.find((need) => need.id === "searxng");
    expect(search).toMatchObject({ state: "degraded", last_error_class: "http_429" });
    expect(search).toMatchObject({ success_count: 0, failure_count: 1 });
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "child", secret: "0000" });
    const person = await created.json() as { id: string };
    const child = new TestClient();
    await child.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" });
    const memberApps = await (await child.get("/api/status/apps")).json() as Array<Record<string, unknown>>;
    expect(JSON.stringify(memberApps)).not.toContain("last_error_class");
  });

  test("maintenance accepts the expanded shared status component vocabulary", async () => {
    const owner = await ownerClient();
    const result = await owner.post("/api/status/maintenance", { title: "Internet provider work", components: ["internet", "service:youtube"], ...upcomingWindow() });
    expect(result.status).toBe(201);
    expect((await result.json() as { components: string[] }).components).toEqual(["internet", "service:youtube"]);
  });

  test("history requires sign-in and is available to a child without event details", async () => {
    expect((await new TestClient().get("/api/status/history")).status).toBe(401);
    const owner = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "child", secret: "0000" });
    const person = await created.json() as { id: string };
    const child = new TestClient();
    expect((await child.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" })).status).toBe(200);
    const res = await child.get("/api/status/history?days=30");
    expect(res.status).toBe(200);
    const body = await res.json() as { days: number; components: Array<{ days: unknown[]; uptime_percent: number | null; current: object }>; incidents: unknown[] };
    expect(body.days).toBe(30);
    expect("resource_day" in body).toBe(false);
    expect(body.components[0]?.days).toHaveLength(30);
    expect(body.components.every((part) => part.uptime_percent === null)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("detail");
  });

  test("invalid history day counts return a plain sentence", async () => {
    const owner = await ownerClient();
    const res = await owner.get("/api/status/history?days=0");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("days");
  });

  test("only admins receive yesterday's resource summary", async () => {
    const fixture = startStackFixture({
      "GET /stack/v1/memory/daily": () => Response.json({ days: [
        { date: "today", chat_restarts_by_cause: {}, engine_stops_by_cause: {}, pauses: 0, resumes: 0, forced_resumes: 0, paused_seconds: 0, memory_actions: {}, shrinks: 0, restores: 0, survivors_stopped: 0, sweeps: { runs: 0, freed_bytes: 0 }, canary_restarts: 0 },
        { date: "yesterday", chat_restarts_by_cause: { "memory-watchdog": 1 }, engine_stops_by_cause: {}, pauses: 0, resumes: 0, forced_resumes: 0, paused_seconds: 0, memory_actions: {}, shrinks: 0, restores: 0, survivors_stopped: 0, sweeps: { runs: 0, freed_bytes: 0 }, canary_restarts: 0 },
      ] }),
    });
    __setStackClientForTests(fixture.client);
    try {
      const owner = await ownerClient();
      const ownerBody = await (await owner.get("/api/status/history")).json() as Record<string, unknown>;
      expect(ownerBody.resource_day).toEqual({ date: "yesterday", text: "Yesterday: chat restarted 1 time (most often because of low memory on this computer)." });
      const created = await owner.post("/api/people", { displayName: "Marlow", role: "child", secret: "0000" });
      const person = await created.json() as { id: string };
      const member = new TestClient();
      await member.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" });
      const memberBody = await (await member.get("/api/status/history")).json() as Record<string, unknown>;
      expect(memberBody).not.toHaveProperty("resource_day");
    } finally {
      __setStackClientForTests(null);
      fixture.stop();
    }
  });

  test("host guard history is admin-only and absent for a child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-guard-history-"));
    __setHostGuardStateDirForTests(dir);
    writeFileSync(join(dir, "config.json"), "{}");
    writeFileSync(join(dir, "status.json"), JSON.stringify({ version: 1, owner: "sage", checked_at: Math.floor(Date.now() / 1000), mode: "live", lookup: "ok", spawn: "ok", metal: "ok", hard_fails: 0, metal_fails: 0, uptime_s: 99, note: "healthy" }));
    try {
      const owner = await ownerClient();
      const admin = await (await owner.get("/api/status/history")).json() as Record<string, unknown>;
      expect(admin.host_guard).toMatchObject({ state: "ok", title: "This Mac's self-check" });
      const created = await owner.post("/api/people", { displayName: "Nova", role: "child", secret: "0000" });
      const person = await created.json() as { id: string };
      const child = new TestClient();
      await child.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" });
      const childBody = await (await child.get("/api/status/history")).json() as Record<string, unknown>;
      expect(childBody).not.toHaveProperty("host_guard");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("signed-out board is rejected", async () => {
    expect((await new TestClient().get("/api/status/board")).status).toBe(401);
  });

  test("an authenticated child reads the board without admin fields", async () => {
    const owner = await ownerClient();
    expect((await owner.post("/api/status/note", { body: "Water will be off" })).status).toBe(201);
    expect((await owner.post("/api/status/maintenance", { title: "Updates", components: ["hub"], ...upcomingWindow() })).status).toBe(201);
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "child", secret: "0000" });
    const person = (await created.json()) as { id: string };
    const child = new TestClient();
    expect((await child.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" })).status).toBe(200);
    const res = await child.get("/api/status/board");
    expect(res.status).toBe(200);
    const body = await res.json() as { note: unknown; maintenance: unknown[] };
    expect(body.maintenance).toHaveLength(1);
    expect(Object.keys(body.maintenance[0]!).sort()).toEqual(["components", "description", "ends_at", "id", "starts_at", "status", "title"]);
    expect(body.note).toMatchObject({ body: "Water will be off", posted_by_name: "Sage" });
    expect(Object.keys(body.note as object).sort()).toEqual(["body", "id", "posted_at", "posted_by_name"]);
  });

  test("owner posts a note and maintenance; members cannot post them", async () => {
    const owner = await ownerClient();
    const signedOut = new TestClient();
    expect((await signedOut.post("/api/status/note", { body: "No" })).status).toBe(401);
    expect((await signedOut.request("/api/status/note", { method: "DELETE" })).status).toBe(401);
    expect((await signedOut.post("/api/status/maintenance", {})).status).toBe(401);
    expect((await signedOut.post("/api/status/maintenance/maint-a1b2c3/cancel", {})).status).toBe(401);
    expect((await owner.post("/api/status/note", { body: "Planned work" })).status).toBe(201);
    const maintenance = await owner.post("/api/status/maintenance", { title: "Updates", components: ["hub"], ...upcomingWindow() });
    expect(maintenance.status).toBe(201);
    expect((await new TestClient().post("/api/status/note", { body: "No" })).status).toBe(401);
    expect((await app.request("/api/status/note", { method: "DELETE" })).status).toBe(401);
  });

  test("reports plain errors for invalid and completed maintenance", async () => {
    const owner = await ownerClient();
    const invalid = await owner.post("/api/status/maintenance", { title: "Bad", components: ["hub"], starts_at: "2026-10-02T13:00:00Z", ends_at: "2026-10-02T12:00:00Z" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Maintenance must end after it starts." });
    const created = await owner.post("/api/status/maintenance", { title: "Done", components: ["hub"], starts_at: "2026-09-29T12:00:00Z", ends_at: "2026-09-29T13:00:00Z" });
    expect(created.status).toBe(400);
  });

  test("adult, teen, child and guest cannot use admin routes", async () => {
    const owner = await ownerClient();
    for (const role of ["adult", "teen", "child", "guest"] as const) {
      const created = await owner.post("/api/people", { displayName: `Test ${role}`, role, secret: "0000" });
      expect(created.status).toBe(201);
      const person = await created.json() as { id: string };
      const member = new TestClient();
      expect((await member.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" })).status).toBe(200);
      expect((await member.post("/api/status/note", { body: "No" })).status).toBe(403);
      expect((await member.request("/api/status/note", { method: "DELETE" })).status).toBe(403);
      expect((await member.post("/api/status/maintenance", { title: "No", components: ["hub"], ...upcomingWindow() })).status).toBe(403);
      expect((await member.post("/api/status/maintenance/maint-a1b2c3/cancel", {})).status).toBe(403);
    }
  });
});
