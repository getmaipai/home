import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync, utimesSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { runBackup, listBackups, restoreBackup, pruneBackups, cleanupStaleSnapshots } from "@/lib/backup";
import { backupDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";

// backupDir is a real filesystem directory, not a DB table resetDb()
// clears: unlike every other test file, this one has to clean up its own
// on-disk state between tests, or one test's backups leak into the next.
function resetBackupDir(): void {
  if (!existsSync(backupDir)) return;
  for (const f of readdirSync(backupDir)) rmSync(join(backupDir, f), { force: true });
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  resetBackupDir();
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

describe("runBackup() / restoreBackup()", () => {
  test("a real backup restores into a valid, queryable database with the real data", async () => {
    await owner();
    const info = runBackup();
    expect(info.filename).toMatch(/^backup-.*\.db\.enc$/);
    expect(info.bytes).toBeGreaterThan(0);
    expect(existsSync(join(backupDir, info.filename))).toBe(true);

    const restoreDir = mkdtempSync(join(tmpdir(), "maipai-restore-test-"));
    const restoredPath = join(restoreDir, "restored.db");
    restoreBackup(info.filename, restoredPath);

    const restored = new Database(restoredPath, { readonly: true });
    const row = restored.query("SELECT display_name FROM people WHERE display_name = ?").get("Sage") as
      | { display_name: string }
      | undefined;
    expect(row?.display_name).toBe("Sage");
    restored.close();
  });

  test("a tampered archive fails to decrypt rather than silently restoring garbage", async () => {
    await owner();
    const info = runBackup();
    const path = join(backupDir, info.filename);
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff; // flip the last ciphertext byte
    writeFileSync(path, bytes);

    const restoreDir = mkdtempSync(join(tmpdir(), "maipai-restore-test-"));
    expect(() => restoreBackup(info.filename, join(restoreDir, "restored.db"))).toThrow();
  });

  test("restoring an unknown backup throws instead of silently doing nothing", () => {
    expect(() => restoreBackup("does-not-exist.db.enc", "/tmp/whatever.db")).toThrow();
  });
});

// A review (2026-09-04) found runBackup()'s plaintext snapshot only got
// cleaned up by its own `finally` block, which never runs if the process
// dies between VACUUM INTO and encryption: a real, unencrypted copy of
// the whole household database could sit in backupDir indefinitely,
// invisible to listBackups(). This proves the fix: a leftover snapshot
// (simulating a crashed prior run) is swept both by a direct call and by
// the next real runBackup().
describe("cleanupStaleSnapshots()", () => {
  test("removes a leftover plaintext snapshot from a simulated crashed run", () => {
    const stalePath = join(backupDir, ".snapshot-1700000000000-deadbeef.db");
    writeFileSync(stalePath, "not actually a valid sqlite file");
    expect(existsSync(stalePath)).toBe(true);

    const removed = cleanupStaleSnapshots();
    expect(removed).toBe(1);
    expect(existsSync(stalePath)).toBe(false);
  });

  test("never touches a real, finished backup", async () => {
    await owner();
    const info = runBackup();
    cleanupStaleSnapshots();
    expect(existsSync(join(backupDir, info.filename))).toBe(true);
  });

  test("runBackup() itself sweeps a leftover snapshot before making a new one", async () => {
    await owner();
    const stalePath = join(backupDir, ".snapshot-1700000000000-deadbeef.db");
    writeFileSync(stalePath, "leftover from a crash");

    runBackup();
    expect(existsSync(stalePath)).toBe(false);
  });
});

describe("listBackups()", () => {
  test("lists real backups, newest first", async () => {
    await owner();
    const first = runBackup();
    await new Promise((r) => setTimeout(r, 5));
    const second = runBackup();

    const listed = listBackups();
    expect(listed[0]!.filename).toBe(second.filename);
    expect(listed[1]!.filename).toBe(first.filename);
  });
});

// 2.5: "retention seven daily, four weekly, three monthly, oldest pruned
// first." Constructs a controlled set of backup ages (via a real backup
// file's mtime, not mocked) and asserts the exact grandfather-father-son
// keep set.
describe("pruneBackups()", () => {
  function backupAt(daysAgo: number): string {
    const info = runBackup();
    const path = join(backupDir, info.filename);
    const when = new Date(Date.now() - daysAgo * 86_400_000);
    utimesSync(path, when, when);
    return info.filename;
  }

  test("keeps at most 7 daily + 4 weekly + 3 monthly, deleting the rest", async () => {
    await owner();
    // 20 backups, one per day for 20 days: day 0 (today) through day 19.
    const filenames: string[] = [];
    for (let d = 0; d < 20; d++) filenames.push(backupAt(d));

    const result = pruneBackups();
    const survivors = new Set(listBackups().map((b) => b.filename));

    // Days 0-6 (the 7 most recent, distinct calendar days) always land in
    // their own daily bucket regardless of week/month boundary alignment.
    for (let d = 0; d < 7; d++) expect(survivors.has(filenames[d]!)).toBe(true);
    expect(survivors.size + result.deleted).toBe(20);
    expect(survivors.size).toBeLessThanOrEqual(7 + 4 + 3);
    expect(survivors.size).toBeGreaterThanOrEqual(7);
  });

  test("multiple backups on the same day only ever keep one", async () => {
    await owner();
    const a = backupAt(0);
    const b = runBackup().filename; // also "today", no utimesSync: real mtime, same day as `a`
    pruneBackups();
    const survivors = new Set(listBackups().map((x) => x.filename));
    expect(survivors.has(a) || survivors.has(b)).toBe(true);
    expect(survivors.has(a) && survivors.has(b)).toBe(false);
  });

  test("a backup far outside every window is deleted", async () => {
    await owner();
    const old = backupAt(400); // well past 7 daily + 4 weekly + 3 monthly
    backupAt(0); // fills today's daily slot first, since listBackups() sorts newest-first
    pruneBackups();
    expect(listBackups().some((b) => b.filename === old)).toBe(false);
  });

  test("backup.max_total_gb defaulting to 0 adds no extra pruning beyond the tiers", async () => {
    await owner();
    for (let d = 0; d < 5; d++) backupAt(d);
    pruneBackups();
    expect(listBackups().length).toBe(5); // all 5 fit inside the 7-daily tier alone
  });

  // 2.5: "retention... with a size cap per target" - backupKeys.ts's own
  // comment names this as the exact gap this closes.
  test("a size cap trims the tiered-kept set further, oldest pruned first", async () => {
    await owner();
    const filenames: string[] = [];
    for (let d = 0; d < 5; d++) filenames.push(backupAt(d)); // days 0-4: all land in the daily tier
    const beforeCap = listBackups();
    expect(beforeCap.length).toBe(5);
    const totalBytes = beforeCap.reduce((sum, b) => sum + b.bytes, 0);

    // A cap under the real total, but above a single backup's size, so
    // pruning has to stop partway through rather than deleting everything
    // or nothing.
    const capBytes = Math.floor(totalBytes * 0.6);
    setHouseholdSettingValue("backup.max_total_gb", capBytes / (1024 * 1024 * 1024));

    pruneBackups();
    const survivors = listBackups();
    const survivorBytes = survivors.reduce((sum, b) => sum + b.bytes, 0);

    expect(survivorBytes).toBeLessThanOrEqual(capBytes);
    expect(survivors.length).toBeLessThan(5);
    // Day 0 (newest) must survive; day 4 (oldest) must not - proves the
    // cap prunes oldest-first, not by insertion order or arbitrarily.
    expect(survivors.some((b) => b.filename === filenames[0])).toBe(true);
    expect(survivors.some((b) => b.filename === filenames[4])).toBe(false);
  });

  // A code review (2026-09-04) found the cap had no floor: set smaller
  // than even the single newest backup, it would evict every kept
  // backup, leaving the household with zero restorable backups - the
  // opposite of what a backup feature exists to guarantee.
  test("a cap smaller than even the newest backup still leaves at least one", async () => {
    await owner();
    backupAt(1);
    const newest = backupAt(0);
    // 1 byte: guaranteed smaller than any real backup file.
    setHouseholdSettingValue("backup.max_total_gb", 1 / (1024 * 1024 * 1024));

    pruneBackups();
    const survivors = listBackups();

    expect(survivors.length).toBe(1);
    expect(survivors[0]!.filename).toBe(newest);
  });
});

describe("GET /api/backups and POST /api/backups/run", () => {
  test("requires owner or admin", async () => {
    const ownerClient = await owner();
    const created = await ownerClient.post("/api/people", { displayName: "Bramble", role: "child" });
    const childId = ((await created.json()) as { id: string }).id;
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: childId });

    expect((await childClient.get("/api/backups")).status).toBe(403);
    expect((await childClient.post("/api/backups/run", {})).status).toBe(403);
  });

  test("POST /api/backups/run creates a real backup an owner can then list", async () => {
    const client = await owner();
    const res = await client.post("/api/backups/run", {});
    expect(res.status).toBe(200);
    const info = (await res.json()) as { filename: string };

    const list = await client.get("/api/backups");
    const body = (await list.json()) as Array<{ filename: string }>;
    expect(body.some((b) => b.filename === info.filename)).toBe(true);
  });
});
