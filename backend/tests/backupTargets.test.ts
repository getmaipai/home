import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, readdirSync, rmSync, mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { runBackupAndMirror, getBackupHealth } from "@/lib/backup";
import { setSmbTarget, getSmbTarget, removeSmbTarget } from "@/lib/backupTargets";
import { listIssues } from "@/lib/issues";
import { listPending } from "@/lib/notifications";
import { backupDir } from "@/lib/paths";
import { sqlite } from "@/db";
import type { PersonRow } from "@/types";

function resetBackupDir(): void {
  if (!existsSync(backupDir)) return;
  for (const f of readdirSync(backupDir)) rmSync(join(backupDir, f), { force: true, recursive: true });
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  resetBackupDir();
  removeSmbTarget();
});

async function owner(): Promise<{ client: TestClient; row: PersonRow }> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const { person } = (await res.json()) as { person: { id: string } };
  const row = sqlite.query("SELECT * FROM people WHERE id = ?").get(person.id) as unknown as PersonRow;
  return { client, row };
}

describe("setSmbTarget()", () => {
  test("refuses a path that does not exist while enabled", () => {
    const result = setSmbTarget("/no/such/path/anywhere", true);
    expect(result.ok).toBe(false);
  });

  test("refuses a path that is a file, not a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-smb-test-"));
    const filePath = join(dir, "not-a-dir");
    Bun.write(filePath, "x");
    const result = setSmbTarget(filePath, true);
    expect(result.ok).toBe(false);
  });

  test("accepts a real directory, and a disabled target skips the existence check", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-smb-test-"));
    expect(setSmbTarget(dir, true).ok).toBe(true);
    expect(getSmbTarget()).toEqual({ path: dir, enabled: true });

    expect(setSmbTarget("/not/mounted/right/now", false).ok).toBe(true);
    expect(getSmbTarget()).toEqual({ path: "/not/mounted/right/now", enabled: false });
  });
});

describe("runBackupAndMirror() mirroring to smb", () => {
  test("mirrors the new backup onto the configured smb target", async () => {
    const { client } = await owner();
    void client;
    const smbDir = mkdtempSync(join(tmpdir(), "maipai-smb-test-"));
    setSmbTarget(smbDir, true);

    const info = await runBackupAndMirror();

    expect(existsSync(join(smbDir, info.filename))).toBe(true);
    expect(getBackupHealth("smb")?.lastSuccessAt).not.toBeNull();
  });

  test("no smb target configured: no mirroring attempted, no smb health row created", async () => {
    await owner();
    await runBackupAndMirror();
    expect(getBackupHealth("smb")).toBeNull();
  });

  test("a disabled smb target is skipped", async () => {
    await owner();
    const smbDir = mkdtempSync(join(tmpdir(), "maipai-smb-test-"));
    setSmbTarget(smbDir, false);
    const info = await runBackupAndMirror();
    expect(existsSync(join(smbDir, info.filename))).toBe(false);
  });

  test("an smb mirror failure is recorded as backup health but never fails the local backup", async () => {
    await owner();
    // A directory that exists at config time but is unwritable at mirror
    // time - existsSync()/statSync() in setSmbTarget() pass, the actual
    // copyFileSync() in mirrorToSmbTarget() does not.
    const smbDir = mkdtempSync(join(tmpdir(), "maipai-smb-test-"));
    setSmbTarget(smbDir, true);
    chmodSync(smbDir, 0o500);

    let info;
    try {
      info = await runBackupAndMirror();
    } finally {
      chmodSync(smbDir, 0o700); // restore so afterEach-style cleanup elsewhere can remove it
    }

    expect(info!.bytes).toBeGreaterThan(0); // the local backup still succeeded
    const health = getBackupHealth("smb");
    expect(health?.consecutiveFailures).toBe(1);
    expect(health?.lastFailureMessage).toBeTruthy();
  });

  test("two consecutive smb failures raise an error-severity issue and notify adults; the third resolves it", async () => {
    const { row } = await owner();
    const smbDir = mkdtempSync(join(tmpdir(), "maipai-smb-test-"));
    setSmbTarget(smbDir, true);
    chmodSync(smbDir, 0o500);

    await runBackupAndMirror();
    let issue = listIssues().find((i) => i.source === "backup" && i.key === "smb");
    expect(issue?.severity).toBe("warning");
    expect(listPending(row).some((n) => n.text.includes("smb"))).toBe(false);

    await runBackupAndMirror();
    issue = listIssues().find((i) => i.source === "backup" && i.key === "smb");
    expect(issue?.severity).toBe("error");
    expect(listPending(row).some((n) => n.text.includes("smb"))).toBe(true);

    chmodSync(smbDir, 0o700);
    await runBackupAndMirror();
    issue = listIssues().find((i) => i.source === "backup" && i.key === "smb");
    expect(issue?.resolved_at).not.toBeNull();
    expect(getBackupHealth("smb")?.consecutiveFailures).toBe(0);
  });
});

describe("GET/PUT/DELETE /api/backups/targets", () => {
  test("configures, reads back, and removes the smb target", async () => {
    const { client } = await owner();
    const dir = mkdtempSync(join(tmpdir(), "maipai-smb-test-"));

    const put = await client.request("/api/backups/targets/smb", { method: "PUT", body: { path: dir, enabled: true } });
    expect(put.status).toBe(200);

    const got = await (await client.get("/api/backups/targets")).json();
    expect((got as { smb: { path: string; enabled: boolean } }).smb.path).toBe(dir);

    const del = await client.request("/api/backups/targets/smb", { method: "DELETE" });
    expect(del.status).toBe(200);
    const gotAfter = await (await client.get("/api/backups/targets")).json();
    expect((gotAfter as { smb: unknown }).smb).toBeNull();
  });

  test("an invalid path is refused with 400", async () => {
    const { client } = await owner();
    const res = await client.request("/api/backups/targets/smb", { method: "PUT", body: { path: "/no/such/path", enabled: true } });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/backups/emergency-kit", () => {
  test("returns the backup key and hub identity to the owner", async () => {
    const { client } = await owner();
    const res = await client.get("/api/backups/emergency-kit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { backupKeyHex: string; hubInstanceId: string; hubName: string };
    expect(body.backupKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.hubInstanceId.length).toBeGreaterThan(0);
  });

  test("is safe to call again - the same key comes back unchanged", async () => {
    const { client } = await owner();
    const first = (await (await client.get("/api/backups/emergency-kit")).json()) as { backupKeyHex: string };
    const second = (await (await client.get("/api/backups/emergency-kit")).json()) as { backupKeyHex: string };
    expect(second.backupKeyHex).toBe(first.backupKeyHex);
  });

  test("an admin cannot see the emergency kit, even with backups.restore granted", async () => {
    const { client } = await owner();
    const adminRes = await client.post("/api/people", { displayName: "Marlow", role: "admin", secret: "correcthorse2" });
    const admin = (await adminRes.json()) as { id: string };
    await client.post("/api/grants", { person: admin.id, action: "backups.restore", effect: "allow" });

    const adminClient = new TestClient();
    await adminClient.post("/api/auth/verify-secret", { personId: admin.id, secret: "correcthorse2" });
    const res = await adminClient.get("/api/backups/emergency-kit");
    expect(res.status).toBe(403);
  });
});
