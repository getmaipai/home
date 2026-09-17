import { describe, expect, test, beforeEach } from "bun:test";
import { sqlite } from "@/db";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { generateDiagnostics } from "@/lib/diagnostics";
import { setValue, setHouseholdSettingValue } from "@/lib/settings";
import { getHubInstanceId, __resetHubIdentityForTests, setHubName } from "@/lib/hubIdentity";
import { CURRENT_SCHEMA_VERSION } from "@/db/schema-version";
import type { PersonRow } from "@/types";

function toPersonRow(id: string): PersonRow {
  return sqlite.query("SELECT * FROM people WHERE id = ?").get(id) as unknown as PersonRow;
}

async function owner(): Promise<{ id: string }> {
  // Diagnostics is a pure lib function (its one route, GET /api/storage,
  // is already covered in storage.test.ts); seed people the same way
  // that file does, without the TestClient overhead.
  const now = new Date().toISOString();
  const id = "diag-owner-1";
  sqlite.query("INSERT INTO people (id, display_name, nickname, role, avatar_seed, source, enabled, hlc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, "Sage Torres", "Dad", "owner", "diag", "local", 1, "hlc-diag", now, now,
  );
  return { id };
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetHubIdentityForTests();
});

describe("generateDiagnostics()", () => {
  test("reports the hub instanceId, never the hub display name", async () => {
    await owner();
    const before = getHubInstanceId();
    setHubName("The Torres House");
    const report = generateDiagnostics();
    expect(report.hub.instanceId).toBe(before);
    expect(report.hub.instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(JSON.stringify(report.hub)).not.toContain("Torres");
  });

  test("reports person id, role, enabled, source, createdAt - never a display name or nickname", async () => {
    const { id } = await owner();
    const report = generateDiagnostics();
    const person = report.people.find((p) => p.id === id);
    expect(person).toBeDefined();
    expect(person?.role).toBe("owner");
    expect(person?.enabled).toBe(true);
    expect(person?.source).toBe("local");
    expect(typeof person?.createdAt).toBe("string");
    // Structural redaction: the fields the schema even has are simply
    // not in the report shape at all.
    const keys = Object.keys(person ?? {}).sort();
    expect(keys).toEqual(["createdAt", "enabled", "id", "role", "source"]);
    const dump = JSON.stringify(report);
    expect(dump).not.toContain("Sage Torres");
    expect(dump).not.toContain("Dad");
  });

  test("reports endpointCount, never an endpoint name, URL, or private address", async () => {
    await owner();
    const now = new Date().toISOString();
    sqlite.query("INSERT INTO hub_endpoints (id, name, url, kind, priority, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "endpoint-1",
      "Living room router",
      "https://192.168.1.50:8787",
      "lan", 0, 1, now, now,
    );
    const report = generateDiagnostics();
    expect(report.endpointCount).toBe(1);
    const dump = JSON.stringify(report);
    expect(dump).not.toContain("Living room router");
    expect(dump).not.toContain("192.168.1.50");
  });

  test("reports issues by source, key, severity, timestamps - never title or detail", async () => {
    const { id } = await owner();
    const now = new Date().toISOString();
    sqlite.query("INSERT INTO issues (id, source, key, severity, title, detail, hlc, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "issue-1", "backup", "smb", "warn", "Sage Torres cannot mount the NAS", "password is hunter2", "hlc-diag", now, null,
    );
    const report = generateDiagnostics();
    const issue = report.issues.find((i) => i.key === "smb");
    expect(issue).toBeDefined();
    expect(issue?.source).toBe("backup");
    expect(issue?.severity).toBe("warn");
    expect(issue?.resolvedAt).toBeNull();
    const keys = Object.keys(issue ?? {}).sort();
    expect(keys).toEqual(["createdAt", "key", "resolvedAt", "severity", "source"]);
    const dump = JSON.stringify(report);
    expect(dump).not.toContain("Sage Torres");
    expect(dump).not.toContain("hunter2");
  });

  test("reports packages by packageId, status, smokeOk", async () => {
    await owner();
    const now = new Date().toISOString();
    sqlite.query("INSERT INTO package_status (package_id, status, smoke_ok) VALUES (?, ?, ?)").run("catalog/test", "installed", 1);
    const report = generateDiagnostics();
    const pkg = report.packages.find((p) => p.packageId === "catalog/test");
    expect(pkg).toBeDefined();
    expect(pkg?.status).toBe("installed");
    expect(pkg?.smokeOk).toBe(true);
  });

  test("reports every household key, with secret:true values redacted and non-secret values intact", async () => {
    await owner();
    setHouseholdSettingValue("notifications.telegram.bot_token", "super-secret-token-value");
    setHouseholdSettingValue("home.base_url", "http://10.0.0.5:8123/");
    const report = generateDiagnostics();
    const dump = JSON.stringify(report);
    const secret = report.settings.find((s) => s.key === "notifications.telegram.bot_token");
    expect(secret?.value).toBe("[redacted]");
    expect(dump).not.toContain("super-secret-token-value");
    const nonSecret = report.settings.find((s) => s.key === "home.base_url");
    expect(nonSecret?.value).toBe("http://10.0.0.5:8123/");
    // Every household key in the registry appears exactly once.
    const { getRegistry } = await import("@/lib/settingsRegistry");
    const householdKeys = getRegistry().filter((k) => k.scope === "household").map((k) => k.key);
    expect(report.settings.map((s) => s.key).sort()).toEqual([...householdKeys].sort());
  });

  test("never includes any person-scoped setting value", async () => {
    const { id } = await owner();
    setValue(toPersonRow(id), `person:${id}`, "tts.voice_id", "a-distinctive-voice-id-12345");
    const report = generateDiagnostics();
    expect(JSON.stringify(report)).not.toContain("a-distinctive-voice-id-12345");
  });

  test("carries the current schema version and an ISO timestamp", () => {
    const report = generateDiagnostics();
    expect(report.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
  });
});
