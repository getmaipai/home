import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { storageSummary, checkPersonQuota, checkDiskFull } from "@/lib/storage";
import { stageFactoryReset, pendingFactoryReset, applyPendingFactoryReset, cancelPendingFactoryReset, FACTORY_RESET_CONFIRMATION_PHRASE } from "@/lib/factoryReset";
import { generateDiagnostics } from "@/lib/diagnostics";
import { setValue, setHouseholdSettingValue } from "@/lib/settings";
import { listIssues } from "@/lib/issues";
import { sqlite } from "@/db";
import { dataDir, backupDir } from "@/lib/paths";
import { readdirSync, rmSync } from "node:fs";
import type { PersonRow } from "@/types";

function toPersonRow(id: string): PersonRow {
  return sqlite.query("SELECT * FROM people WHERE id = ?").get(id) as unknown as PersonRow;
}

function resetBackupDir(): void {
  if (!existsSync(backupDir)) return;
  for (const f of readdirSync(backupDir)) rmSync(join(backupDir, f), { force: true });
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  resetBackupDir();
  cancelPendingFactoryReset();
});

async function owner(): Promise<{ client: TestClient; id: string }> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const { person } = (await res.json()) as { person: { id: string } };
  return { client, id: person.id };
}

describe("storageSummary()", () => {
  test("reports areas, packages and disk usage without throwing on a fresh install", () => {
    const summary = storageSummary();
    expect(summary.areas.length).toBeGreaterThan(0);
    expect(Array.isArray(summary.packages)).toBe(true);
    expect(summary.disk.totalBytes).toBeGreaterThan(0);
  });
});

describe("GET /api/storage", () => {
  test("owner/admin can read it", async () => {
    const { client } = await owner();
    const res = await client.get("/api/storage");
    expect(res.status).toBe(200);
  });

  test("an adult without backups.run is refused", async () => {
    const { client } = await owner();
    const adultRes = await client.post("/api/people", { displayName: "Marlow", role: "adult" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });
    expect((await adultClient.get("/api/storage")).status).toBe(403);
  });
});

describe("checkPersonQuota()", () => {
  test("unlimited (default 0) always allows", () => {
    const { id } = { id: "person-doesnotexist" };
    expect(checkPersonQuota(id, 999_999_999).ok).toBe(true);
  });

  test("refuses when a set quota would be exceeded", async () => {
    const { id } = await owner();
    setValue(toPersonRow(id), `person:${id}`, "storage.person_quota_gb", 1);
    const oneGb = 1024 * 1024 * 1024;
    expect(checkPersonQuota(id, oneGb - 1).ok).toBe(true);
    expect(checkPersonQuota(id, oneGb + 1).ok).toBe(false);
  });
});

describe("checkDiskFull()", () => {
  test("raises a Repairs issue when free space is below the household threshold", () => {
    setHouseholdSettingValue("storage.critical_free_gb", Number.MAX_SAFE_INTEGER);
    checkDiskFull();
    const issue = listIssues().find((i) => i.source === "storage" && i.key === "disk_full");
    expect(issue?.severity).toBe("error");
  });

  test("resolves the issue once space is no longer critical", () => {
    setHouseholdSettingValue("storage.critical_free_gb", Number.MAX_SAFE_INTEGER);
    checkDiskFull();
    setHouseholdSettingValue("storage.critical_free_gb", 0);
    checkDiskFull();
    const issue = listIssues().find((i) => i.source === "storage" && i.key === "disk_full");
    expect(issue?.resolved_at).not.toBeNull();
  });
});

describe("NAS mounts", () => {
  test("declares, lists, and removes a mount pointing at a real directory", async () => {
    const { client } = await owner();
    const dir = mkdtempSync(join(tmpdir(), "maipai-nas-test-"));

    const created = await client.post("/api/storage/nas-mounts", { label: "Media NAS", path: dir, scanPaths: ["movies", "shows"] });
    expect(created.status).toBe(201);
    const mount = (await created.json()) as { id: string };

    const list = (await (await client.get("/api/storage/nas-mounts")).json()) as Array<{ id: string; scanPaths: string[] }>;
    expect(list.some((m) => m.id === mount.id && m.scanPaths.length === 2)).toBe(true);

    const del = await client.request(`/api/storage/nas-mounts/${mount.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  test("refuses a path that does not exist", async () => {
    const { client } = await owner();
    const res = await client.post("/api/storage/nas-mounts", { label: "Nope", path: "/no/such/path", scanPaths: [] });
    expect(res.status).toBe(400);
  });
});

describe("factory reset", () => {
  test("refuses the wrong confirmation phrase", async () => {
    const result = await stageFactoryReset("delete everything");
    expect(result.ok).toBe(false);
  });

  test("stages with a fresh backup on the right phrase, then applies at the next boot", async () => {
    const stageResult = await stageFactoryReset(FACTORY_RESET_CONFIRMATION_PHRASE);
    expect(stageResult.ok).toBe(true);
    expect(stageResult.backupFilename).toBeTruthy();
    expect(existsSync(join(backupDir, stageResult.backupFilename!))).toBe(true);

    const pending = pendingFactoryReset();
    expect(pending?.backupFilename).toBe(stageResult.backupFilename!);

    // Simulate the next boot against a throwaway directory - never the
    // live dataDir, the same reason restoreStaging.test.ts's own
    // applyPendingRestore() tests do this (a real open handle on this
    // process's own hub.db must never be renamed out from under it).
    const throwawayDir = mkdtempSync(join(tmpdir(), "maipai-factory-reset-test-"));
    writeFileSync(join(throwawayDir, "hub.db"), "not a real database, just needs to exist");
    writeFileSync(
      join(throwawayDir, "factory-reset-pending.json"),
      JSON.stringify({ stagedAt: new Date().toISOString(), backupFilename: stageResult.backupFilename }),
    );
    const applied = applyPendingFactoryReset(throwawayDir);
    expect(applied).not.toBeNull();
    expect(existsSync(join(throwawayDir, "hub.db"))).toBe(false); // moved aside
    expect(existsSync(join(throwawayDir, "hub.db.pre-factory-reset"))).toBe(true);
    expect(pendingFactoryReset(throwawayDir)).toBeNull();
  });

  test("cancelling removes the marker without touching the live database", async () => {
    await stageFactoryReset(FACTORY_RESET_CONFIRMATION_PHRASE);
    expect(cancelPendingFactoryReset()).toBe(true);
    expect(pendingFactoryReset()).toBeNull();
    expect(existsSync(join(dataDir, "hub.db"))).toBe(true); // untouched
  });

  // A code review (2026-09-06): a crash right after renaming hub.db to
  // the pre-reset slot, but before its own -wal/-shm got the same
  // treatment, leaves exactly this state - the main file already at
  // `hub.db.pre-factory-reset`, hub.db itself gone, and its -wal still
  // sitting under the OLD `hub.db-wal` name. The buggy version's retry
  // archived that lone main file (since it alone was checked for) to a
  // timestamped name, then separately moved the still-present `hub.db-
  // wal` onto the now-bare `hub.db.pre-factory-reset-wal` - a main file
  // with no journal sitting next to a journal with no main file.
  test("a crash between renaming the main file and its own WAL/SHM does not split them on retry", async () => {
    const throwawayDir = mkdtempSync(join(tmpdir(), "maipai-factory-reset-crash-test-"));
    writeFileSync(join(throwawayDir, "factory-reset-pending.json"), JSON.stringify({ stagedAt: new Date().toISOString(), backupFilename: "backup-x.db.enc" }));

    // State left behind by the crashed first attempt: hub.db already
    // renamed to the pre-reset slot, but its -wal was not yet moved.
    writeFileSync(join(throwawayDir, "hub.db.pre-factory-reset"), "main file from the crashed attempt");
    writeFileSync(join(throwawayDir, "hub.db-wal"), "its own wal, not yet moved when the crash happened");

    const applied = applyPendingFactoryReset(throwawayDir);
    expect(applied).not.toBeNull();

    // Never split: every "-wal" file's own main file (its name minus the
    // "-wal" suffix) must exist too, and vice versa - whatever name each
    // pair ends up under, bare or archived-with-a-timestamp.
    const files = new Set(readdirSync(throwawayDir).filter((f) => f.startsWith("hub.db.pre-factory-reset")));
    for (const f of files) {
      if (f.endsWith("-wal")) expect(files.has(f.slice(0, -"-wal".length))).toBe(true);
    }
    for (const f of files) {
      if (!f.endsWith("-wal") && !f.endsWith("-shm")) expect(files.has(`${f}-wal`)).toBe(true);
    }
  });
});

describe("POST /api/storage/factory-reset", () => {
  test("owner-only, even with backups.restore granted to an admin", async () => {
    const { client } = await owner();
    const adminRes = await client.post("/api/people", { displayName: "Marlow", role: "admin", secret: "correcthorse2" });
    const admin = (await adminRes.json()) as { id: string };
    await client.post("/api/grants", { person: admin.id, action: "backups.restore", effect: "allow" });

    const adminClient = new TestClient();
    await adminClient.post("/api/auth/verify-secret", { personId: admin.id, secret: "correcthorse2" });
    const res = await adminClient.post("/api/storage/factory-reset", { confirmation: FACTORY_RESET_CONFIRMATION_PHRASE });
    expect(res.status).toBe(403);
  });

  test("the owner can stage one over the API", async () => {
    const { client } = await owner();
    const res = await client.post("/api/storage/factory-reset", { confirmation: FACTORY_RESET_CONFIRMATION_PHRASE });
    expect(res.status).toBe(200);
  });
});

describe("generateDiagnostics()", () => {
  test("never includes a family name, a real address, or a secret settings value", async () => {
    const { id } = await owner();
    sqlite.query("UPDATE people SET display_name = ?, nickname = ? WHERE id = ?").run("Sage Torres", "Dad", id);
    sqlite.query("INSERT INTO hub_endpoints (id, name, url, kind, priority, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "endpoint-1",
      "Living room router",
      "https://192.168.1.50:8787",
      "lan",
      0,
      1,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    setHouseholdSettingValue("notifications.telegram.bot_token", "super-secret-token-value");

    const report = generateDiagnostics();
    const dump = JSON.stringify(report);

    expect(dump).not.toContain("Sage Torres");
    expect(dump).not.toContain("Dad");
    expect(dump).not.toContain("Living room router");
    expect(dump).not.toContain("192.168.1.50");
    expect(dump).not.toContain("super-secret-token-value");

    expect(report.endpointCount).toBe(1);
    const botTokenSetting = report.settings.find((s) => s.key === "notifications.telegram.bot_token");
    expect(botTokenSetting?.value).toBe("[redacted]");
  });

  test("never includes any person-scoped setting value", async () => {
    const { id } = await owner();
    setValue(toPersonRow(id), `person:${id}`, "tts.voice_id", "a-distinctive-voice-id-12345");
    const report = generateDiagnostics();
    expect(JSON.stringify(report)).not.toContain("a-distinctive-voice-id-12345");
  });

  test("never includes a custom hub display name", async () => {
    const { setHubName } = await import("@/lib/hubIdentity");
    setHubName("The Torres House");
    const report = generateDiagnostics();
    expect(JSON.stringify(report)).not.toContain("Torres");
  });
});
