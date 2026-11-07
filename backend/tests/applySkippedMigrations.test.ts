import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySkippedMigrations } from "@/db/applySkippedMigrations";

function folder(entries: Array<{ idx: number; tag: string; when: number; sql: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), "skipped-mig-"));
  mkdirSync(join(dir, "meta"));
  writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: entries.map((e) => ({ idx: e.idx, version: "6", when: e.when, tag: e.tag, breakpoints: true })) }));
  for (const e of entries) writeFileSync(join(dir, `${e.tag}.sql`), e.sql);
  return dir;
}

describe("a migration older than the newest applied one is not lost", () => {
  test("applies a skipped ALTER, records it, and does nothing the second time", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)");
    db.exec("CREATE TABLE voices (id text)");
    db.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('a', 1000), ('c', 3000)").run();
    const dir = folder([
      { idx: 0, tag: "0000_a", when: 1000, sql: "SELECT 1;" },
      { idx: 1, tag: "0001_skipped", when: 2000, sql: "ALTER TABLE `voices` ADD `kind` text;--> statement-breakpoint\nALTER TABLE `voices` ADD `level` text;" },
      { idx: 2, tag: "0002_c", when: 3000, sql: "SELECT 1;" },
    ]);
    try {
      expect(applySkippedMigrations(db, dir)).toEqual(["0001_skipped"]);
      expect((db.query("PRAGMA table_info(voices)").all() as Array<{ name: string }>).map((c) => c.name)).toEqual(["id", "kind", "level"]);
      expect(db.query("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE created_at = 2000").get()).toEqual({ n: 1 });
      expect(applySkippedMigrations(db, dir)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("tolerates a column or table that already exists and still records the migration", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)");
    db.exec("CREATE TABLE voices (id text, kind text)");
    db.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('c', 3000)").run();
    const dir = folder([{ idx: 1, tag: "0001_skipped", when: 2000, sql: "ALTER TABLE `voices` ADD `kind` text;--> statement-breakpoint\nCREATE TABLE `voices` (`id` text);" }]);
    try { expect(applySkippedMigrations(db, dir)).toEqual(["0001_skipped"]); } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a fresh database with no migration table is left to the migrator", () => {
    const dir = folder([{ idx: 0, tag: "0000_a", when: 1000, sql: "SELECT 1;" }]);
    try { expect(applySkippedMigrations(new Database(":memory:"), dir)).toEqual([]); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
