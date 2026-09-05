import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync, utimesSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { runBackup, listBackups, restoreBackup, pruneBackups, cleanupStaleSnapshots, stageRestore, pendingRestore, cancelPendingRestore, applyPendingRestore } from "@/lib/backup";
import { encryptFile } from "@/lib/backupCrypto";
import { CURRENT_SCHEMA_VERSION } from "@/db/schema-version";
import { backupDir, dataDir } from "@/lib/paths";
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
  // A staged restore is real state in the run's data directory, not a DB
  // table resetDb() clears. Left behind by a test that failed before its
  // own cleanup, the applyPendingRestore test further down would swap
  // this process's live database out from under its open handle, turning
  // one failure into a cascade that hides the original (code review,
  // 2026-09-05).
  cancelPendingRestore();
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

// Restore, staged and applied at boot (2026-09-05). The rules these pin
// are the ones that decide whether a family gets their data back or a
// hub that will not start.

/** Builds an encrypted archive from a database this test wrote by hand,
 * so the verification checks can be driven with files a real backup
 * could never produce (a future schema version, an empty roster). */
function fakeBackup(name: string, build: (db: Database) => void): string {
  const path = join(dataDir, `${name}.db`);
  rmSync(path, { force: true });
  const db2 = new Database(path);
  build(db2);
  db2.close();
  encryptFile(path, join(backupDir, `${name}.db.enc`));
  rmSync(path, { force: true });
  return `${name}.db.enc`;
}

describe("staged restore", () => {
  test("stages a real backup and reports which one is waiting", async () => {
    await owner();
    const info = runBackup();

    expect(pendingRestore()).toBeNull();
    const staged = stageRestore(info.filename, "person-123");
    expect(staged.filename).toBe(info.filename);
    expect(staged.stagedByPersonId).toBe("person-123");
    expect(pendingRestore()?.filename).toBe(info.filename);

    cancelPendingRestore();
  });

  test("cancelling leaves nothing staged and nothing on disk", async () => {
    await owner();
    const info = runBackup();
    stageRestore(info.filename, "person-123");

    expect(cancelPendingRestore()).toBe(true);
    expect(pendingRestore()).toBeNull();
    expect(existsSync(join(dataDir, "hub.db.pending-restore"))).toBe(false);
    // Cancelling twice is not an error; there is just nothing to cancel.
    expect(cancelPendingRestore()).toBe(false);
  });

  test("refuses a backup that is not there, without staging anything", () => {
    expect(() => stageRestore("does-not-exist.db.enc", "person-123")).toThrow(/no such backup/);
    expect(pendingRestore()).toBeNull();
  });

  // The check that matters most. db/schema-version.ts refuses to open a
  // database newer than the build understands, on purpose. Swapping one
  // in would trip that guard at the next boot, AFTER the live database
  // had already been moved aside: a hub that will not start, from a
  // button labelled "restore".
  test("refuses a backup from a newer version of MaiPai Home", () => {
    const name = fakeBackup("from-the-future", (d) => {
      d.exec("CREATE TABLE people (id TEXT PRIMARY KEY, display_name TEXT, deleted_at TEXT)");
      d.exec("INSERT INTO people (id, display_name) VALUES ('p1', 'Sage')");
      d.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 5}`);
    });

    expect(() => stageRestore(name, "person-123")).toThrow(/newer version of MaiPai Home/);
    expect(pendingRestore()).toBeNull();
    expect(existsSync(join(dataDir, "hub.db.pending-restore"))).toBe(false);
  });

  // A restore that leaves nobody able to sign in locks the family out of
  // their own hub, with no way back through the UI.
  test("refuses a backup with nobody in it", () => {
    const name = fakeBackup("nobody-home", (d) => {
      d.exec("CREATE TABLE people (id TEXT PRIMARY KEY, display_name TEXT, deleted_at TEXT)");
      d.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    });

    expect(() => stageRestore(name, "person-123")).toThrow(/no people/);
    expect(pendingRestore()).toBeNull();
  });

  test("refuses something that is not a database at all", () => {
    writeFileSync(join(dataDir, "junk.bin"), Buffer.from("not a database, just some bytes"));
    encryptFile(join(dataDir, "junk.bin"), join(backupDir, "junk.db.enc"));
    rmSync(join(dataDir, "junk.bin"), { force: true });

    expect(() => stageRestore("junk.db.enc", "person-123")).toThrow(/not a MaiPai Home backup/);
    expect(pendingRestore()).toBeNull();
    expect(existsSync(join(dataDir, "hub.db.pending-restore"))).toBe(false);
  });

  // The swap itself, driven against a throwaway directory rather than
  // the real data dir. That is not test convenience: applyPendingRestore
  // renames and deletes the exact files a live SQLite handle owns, and
  // running it against the data dir this process is connected to breaks
  // that connection mid-suite - which is the whole hazard the staging
  // design exists to keep away from a running hub. Testing it in place
  // would be reproducing the bug, not covering it.
  test("applying a staged restore swaps the database in and keeps the old one", async () => {
    await owner();
    const info = runBackup();
    const dir = mkdtempSync(join(tmpdir(), "maipai-apply-test-"));
    try {
      // A stand-in for the live database, holding data the backup does
      // not: after the swap it must be gone from hub.db and still
      // recoverable from hub.db.pre-restore.
      const live = new Database(join(dir, "hub.db"));
      live.exec("CREATE TABLE people (id TEXT PRIMARY KEY, display_name TEXT)");
      live.exec("INSERT INTO people (id, display_name) VALUES ('p9', 'Juniper')");
      live.close();

      stageRestore(info.filename, "person-123", dir);
      const applied = applyPendingRestore(dir);
      expect(applied?.filename).toBe(info.filename);
      expect(pendingRestore(dir)).toBeNull();

      const restored = new Database(join(dir, "hub.db"), { readonly: true });
      const names = restored
        .query("SELECT display_name FROM people")
        .all()
        .map((r) => (r as { display_name: string }).display_name);
      restored.close();
      expect(names).toContain("Sage");
      expect(names).not.toContain("Juniper");

      // The replaced database is kept, not deleted. It is the only undo
      // a family has for this.
      const kept = new Database(join(dir, "hub.db.pre-restore"), { readonly: true });
      const keptNames = kept
        .query("SELECT display_name FROM people")
        .all()
        .map((r) => (r as { display_name: string }).display_name);
      kept.close();
      expect(keptNames).toContain("Juniper");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A stale write-ahead log belongs to the database being replaced. Left
  // in place, SQLite would replay it on top of the restored file.
  test("applying clears the replaced database's journal files", async () => {
    await owner();
    const info = runBackup();
    const dir = mkdtempSync(join(tmpdir(), "maipai-apply-wal-test-"));
    try {
      writeFileSync(join(dir, "hub.db"), Buffer.from("old database"));
      writeFileSync(join(dir, "hub.db-wal"), Buffer.from("stale journal"));
      writeFileSync(join(dir, "hub.db-shm"), Buffer.from("stale shm"));

      stageRestore(info.filename, "person-123", dir);
      applyPendingRestore(dir);

      expect(existsSync(join(dir, "hub.db-wal"))).toBe(false);
      expect(existsSync(join(dir, "hub.db-shm"))).toBe(false);
      expect(existsSync(join(dir, "hub.db.pre-restore"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applying with nothing staged does nothing at all", () => {
    expect(applyPendingRestore()).toBeNull();
  });
});

describe("the restore routes", () => {
  async function childOf(ownerClient: TestClient): Promise<TestClient> {
    const created = await ownerClient.post("/api/people", { displayName: "Bramble", role: "child" });
    const childId = ((await created.json()) as { id: string }).id;
    const client = new TestClient();
    await client.post("/api/auth/select", { personId: childId });
    return client;
  }

  // Deliberately stricter than the owner/admin gate on listing and
  // running backups. Running one is additive and reversible; restoring
  // replaces every person, memory and conversation in the house,
  // including the roster that decides who is an admin at all.
  test("only the owner may stage or cancel a restore", async () => {
    const ownerClient = await owner();
    const info = runBackup();
    const child = await childOf(ownerClient);

    expect((await child.post(`/api/backups/${info.filename}/restore`, {})).status).toBe(403);
    expect((await child.post("/api/backups/restore/cancel", {})).status).toBe(403);
    expect((await child.get("/api/backups/restore/pending")).status).toBe(403);
  });

  test("staging, reading back, and cancelling, all through the API", async () => {
    const client = await owner();
    const info = runBackup();

    const before = await client.get("/api/backups/restore/pending");
    expect(((await before.json()) as { pending: unknown }).pending).toBeNull();

    const staged = await client.post(`/api/backups/${info.filename}/restore`, {});
    expect(staged.status).toBe(200);
    expect(((await staged.json()) as { pending: { filename: string } }).pending.filename).toBe(info.filename);

    const after = await client.get("/api/backups/restore/pending");
    expect(((await after.json()) as { pending: { filename: string } }).pending.filename).toBe(info.filename);

    const cancelled = await client.post("/api/backups/restore/cancel", {});
    expect(((await cancelled.json()) as { cancelled: boolean }).cancelled).toBe(true);
    const gone = await client.get("/api/backups/restore/pending");
    expect(((await gone.json()) as { pending: unknown }).pending).toBeNull();
  });

  // The filename comes from the URL, so it is checked against the real
  // list rather than joined onto a path.
  test("refuses a filename that is not a real backup, including a traversal attempt", async () => {
    const client = await owner();
    expect((await client.post("/api/backups/nope.db.enc/restore", {})).status).toBe(404);
    expect((await client.post(`/api/backups/${encodeURIComponent("../../etc/passwd")}/restore`, {})).status).toBe(404);
    expect(pendingRestore()).toBeNull();
  });

  // The verification messages are written for the person reading them,
  // so the route passes them through instead of flattening to a generic
  // failure. A parent who restores a backup from a newer version needs
  // to be told to update first.
  test("explains why a backup was refused, in words a parent can act on", async () => {
    const client = await owner();
    const name = fakeBackup("api-from-the-future", (d) => {
      d.exec("CREATE TABLE people (id TEXT PRIMARY KEY, display_name TEXT, deleted_at TEXT)");
      d.exec("INSERT INTO people (id, display_name) VALUES ('p1', 'Sage')");
      d.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 5}`);
    });

    const res = await client.post(`/api/backups/${name}/restore`, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/newer version of MaiPai Home/);
    expect(pendingRestore()).toBeNull();
  });
});

// Every one of these is a code-review finding from 2026-09-05, and each
// is a way a restore could have left a family worse off than before.
describe("what a restore refuses to do", () => {
  test("will not stage a second restore over one already waiting", async () => {
    await owner();
    const first = runBackup();
    const second = runBackup();
    stageRestore(first.filename, "person-123");

    expect(() => stageRestore(second.filename, "person-123")).toThrow(/already waiting/);
    // The confirmed one is untouched, not silently replaced or wiped.
    expect(pendingRestore()?.filename).toBe(first.filename);
    cancelPendingRestore();
  });

  // Every sign-in path filters tombstones out, so a backup whose people
  // are all soft-deleted has nobody who can sign in.
  test("counts only living people, not tombstones", () => {
    const name = fakeBackup("all-tombstones", (d) => {
      d.exec("CREATE TABLE people (id TEXT PRIMARY KEY, display_name TEXT, deleted_at TEXT)");
      d.exec("INSERT INTO people VALUES ('p1', 'Sage', '2026-09-05T00:00:00.000Z')");
      d.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    });

    expect(() => stageRestore(name, "person-123")).toThrow(/no people/);
  });

  // decryptFile's writeFileSync never fsyncs, so a power cut right after
  // staging can leave a truncated file. Applying it would move the good
  // database aside and rename the broken one in, and the hub would then
  // refuse to start at all.
  test("refuses at boot to apply a staged file that went bad, and leaves the live database alone", async () => {
    await owner();
    const info = runBackup();
    const dir = mkdtempSync(join(tmpdir(), "maipai-bad-staged-"));
    try {
      const live = new Database(join(dir, "hub.db"));
      live.exec("CREATE TABLE people (id TEXT PRIMARY KEY, display_name TEXT, deleted_at TEXT)");
      live.exec("INSERT INTO people VALUES ('p9', 'Juniper', NULL)");
      live.close();

      stageRestore(info.filename, "person-123", dir);
      // Truncated after staging, the way a power cut would.
      writeFileSync(join(dir, "hub.db.pending-restore"), Buffer.from("half a fi"));

      expect(applyPendingRestore(dir)).toBeNull();

      const stillLive = new Database(join(dir, "hub.db"), { readonly: true });
      const name = (stillLive.query("SELECT display_name FROM people").get() as { display_name: string })
        .display_name;
      stillLive.close();
      expect(name).toBe("Juniper");
      expect(existsSync(join(dir, "hub.db.pre-restore"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Restore A, restart, realise it was wrong, restore B, restart: without
  // this the household's original database is gone for good and the file
  // that is supposed to be the way back holds A's data.
  test("a second restore does not clobber the first pre-restore copy", async () => {
    await owner();
    const info = runBackup();
    const dir = mkdtempSync(join(tmpdir(), "maipai-second-restore-"));
    try {
      const original = new Database(join(dir, "hub.db"));
      original.exec("CREATE TABLE people (id TEXT PRIMARY KEY, display_name TEXT, deleted_at TEXT)");
      original.exec("INSERT INTO people VALUES ('p9', 'TheOriginal', NULL)");
      original.close();

      stageRestore(info.filename, "person-123", dir);
      applyPendingRestore(dir);
      stageRestore(info.filename, "person-123", dir);
      applyPendingRestore(dir);

      const kept = new Database(join(dir, "hub.db.pre-restore"), { readonly: true });
      kept.close();
      // The original was moved aside under a timestamped name rather than
      // being overwritten by the second restore's pre-restore copy.
      const archived = readdirSync(dir).filter((f) => f.startsWith("hub.db.pre-restore-2"));
      expect(archived.length).toBeGreaterThan(0);
      const originalCopy = new Database(join(dir, archived[0]!), { readonly: true });
      const name = (originalCopy.query("SELECT display_name FROM people").get() as { display_name: string })
        .display_name;
      originalCopy.close();
      expect(name).toBe("TheOriginal");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // In WAL mode a committed transaction lives in the journal until a
  // checkpoint. Deleting it emptied the one undo a family has.
  test("the replaced database keeps its journal, so the undo copy is complete", async () => {
    await owner();
    const info = runBackup();
    const dir = mkdtempSync(join(tmpdir(), "maipai-wal-keep-"));
    try {
      writeFileSync(join(dir, "hub.db"), Buffer.from("old database"));
      writeFileSync(join(dir, "hub.db-wal"), Buffer.from("committed but not yet checkpointed"));
      writeFileSync(join(dir, "hub.db-shm"), Buffer.from("shm"));

      stageRestore(info.filename, "person-123", dir);
      applyPendingRestore(dir);

      // Moved alongside the database they belong to, under SQLite's own
      // naming convention, so hub.db.pre-restore is still openable and
      // complete - and nothing stale sits next to the restored database.
      expect(existsSync(join(dir, "hub.db-wal"))).toBe(false);
      expect(existsSync(join(dir, "hub.db.pre-restore-wal"))).toBe(true);
      expect(readFileSync(join(dir, "hub.db.pre-restore-wal")).toString()).toContain("not yet checkpointed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A corrupt archive fails GCM's tag check with Node's own wording, and
  // a filesystem error carries an absolute server path. Neither belongs
  // in a browser.
  test("a raw crypto or filesystem error never reaches the browser", async () => {
    const client = await owner();
    const info = runBackup();
    const path = join(backupDir, info.filename);
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    writeFileSync(path, bytes);

    const res = await client.post(`/api/backups/${info.filename}/restore`, {});
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe("that backup could not be read. Try another one.");
    expect(error).not.toContain("authenticate");
    expect(error).not.toContain("/");
  });
});
