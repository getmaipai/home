import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDir } from "@/lib/paths";
import { encryptFile } from "@/lib/backupCrypto";
import { restoreBackup } from "@/lib/backup";

const migration = readFileSync(join(import.meta.dir, "../src/db/migrations/0126_mild_otter.sql"), "utf8")
  .split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);

function legacyDatabase(path: string): Database {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE settings_values (scope TEXT, key TEXT, value TEXT);
    INSERT INTO settings_values VALUES ('household', 'likeness.adults', 'true');
    INSERT INTO settings_values VALUES ('household', 'likeness.adult_content', 'true');
    CREATE TABLE likeness_adapters (state TEXT);
    INSERT INTO likeness_adapters VALUES ('removal_queued');
    CREATE TABLE likeness_consent_events (id TEXT PRIMARY KEY);
    CREATE INDEX likeness_consent_events_person_idx ON likeness_consent_events(id);
    CREATE TABLE likeness_uses (id TEXT PRIMARY KEY);
    CREATE INDEX likeness_uses_subject_idx ON likeness_uses(id);
  `);
  return database;
}

function applyMigration(database: Database): void {
  for (const statement of migration) database.exec(statement);
}

describe("0126 likeness simplification migration", () => {
  test("removes legacy permissions and agreement tables while preserving unavailable style tombstones", () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE settings_values (scope TEXT, key TEXT, value TEXT);
        INSERT INTO settings_values VALUES ('household', 'likeness.adults', 'true');
        INSERT INTO settings_values VALUES ('household', 'likeness.adult_content', 'true');
        CREATE TABLE likeness_adapters (state TEXT);
        INSERT INTO likeness_adapters VALUES ('removal_queued');
        CREATE TABLE likeness_consent_events (id TEXT PRIMARY KEY);
        CREATE INDEX likeness_consent_events_person_idx ON likeness_consent_events(id);
        CREATE TABLE likeness_uses (id TEXT PRIMARY KEY);
        CREATE INDEX likeness_uses_subject_idx ON likeness_uses(id);
      `);
      applyMigration(database);
      expect(database.query("SELECT key FROM settings_values").all()).toEqual([]);
      expect(database.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('likeness_consent_events','likeness_uses')").all()).toEqual([]);
      expect(database.query("SELECT state FROM likeness_adapters").get()).toEqual({ state: "removed" });
    } finally { database.close(); }
  });

  test("a pre-migration encrypted backup restores, then migration removes its old permissions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "likeness-old-backup-"));
    const source = join(dir, "old.db");
    const archive = `backup-likeness-${Date.now()}.db.enc`;
    const restoredPath = join(dir, "restored.db");
    const sourceDb = legacyDatabase(source);
    sourceDb.close();
    try {
      await encryptFile(source, join(backupDir, archive));
      await restoreBackup(archive, restoredPath);
      const restored = new Database(restoredPath);
      try {
        expect(restored.query("SELECT value FROM settings_values WHERE key='likeness.adults'").get()).toEqual({ value: "true" });
        applyMigration(restored);
        expect(restored.query("SELECT key FROM settings_values").all()).toEqual([]);
        expect(restored.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('likeness_consent_events','likeness_uses')").all()).toEqual([]);
      } finally { restored.close(); }
    } finally {
      rmSync(join(backupDir, archive), { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
