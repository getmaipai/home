// Architecture review 2026-10-06, 4.4: 89 migrations run at start-up and
// CURRENT_SCHEMA_VERSION is bumped by hand, but no test applied the chain
// to a database that already held rows, and nothing noticed a schema change
// that forgot the bump (a rollback then opens a newer database it does not
// understand; db/schema-version.ts). Two promises, one test each:
// - a household's database from an older build upgrades through every
//   later migration, with the hub's own foreign keys on, keeping its rows
//   and ending in the same schema a fresh install gets;
// - the schema a fresh install gets is pinned to the version number that
//   names it (fixtures/schema-version.json), so a schema change without a
//   bump fails here.
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CURRENT_SCHEMA_VERSION } from "@/db/schema-version";

const MIGRATIONS = join(import.meta.dir, "../src/db/migrations");
/** The last migration of the older build the upgrade starts from. */
const OLD_BUILD_LAST_MIGRATION = "0070_dry_blackheart";

type Journal = { entries: Array<{ idx: number; tag: string }> };

function openDb(path: string): Database {
  const sqlite = new Database(path);
  // The hub's own connection settings (db/index.ts).
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  return sqlite;
}

/** Every table's columns and keys, and the stored definition of every
 * table, index, trigger and view (CHECK constraints, foreign keys, which
 * columns an index covers), in a stable order: what a migration changes. */
function schemaShape(sqlite: Database): string {
  const lines: string[] = [];
  const objects = sqlite.query("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY type, name").all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
  for (const object of objects) {
    lines.push(`${object.type} ${object.name} on ${object.tbl_name}: ${object.sql ?? ""}`);
    if (object.type !== "table") continue;
    const columns = sqlite.query(`PRAGMA table_info("${object.name}")`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
    lines.push(`  columns ${columns.map((c) => `${c.name} ${c.type}${c.notnull ? " not null" : ""}${c.dflt_value !== null ? ` default ${c.dflt_value}` : ""}${c.pk ? ` pk${c.pk}` : ""}`).join(", ")}`);
    const keys = sqlite.query(`PRAGMA foreign_key_list("${object.name}")`).all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
    if (keys.length > 0) lines.push(`  keys ${keys.map((k) => `${k.from}->${k.table}.${k.to} on delete ${k.on_delete}`).join(", ")}`);
  }
  return lines.join("\n");
}

/** One row in `table` with every required column filled, by its type. */
function seedRow(sqlite: Database, table: string, values: Record<string, string | number>): void {
  const columns = sqlite.query(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
  const row: Record<string, string | number> = {};
  for (const c of columns) {
    if (c.name in values) row[c.name] = values[c.name]!;
    else if (c.notnull && c.dflt_value === null) row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : "seeded";
  }
  const names = Object.keys(row);
  sqlite.query(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...names.map((n) => row[n]!));
}

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "maipai-schema-chain-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function freshShape(dir: string): string {
  const sqlite = openDb(join(dir, "fresh.db"));
  try {
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });
    return schemaShape(sqlite);
  } finally {
    sqlite.close();
  }
}

describe("the migration chain (architecture review 4.4)", () => {
  test("an older build's database with a household in it upgrades through every later migration, keeping its rows and its keys", () => {
    withTempDir((dir) => {
      // The older build: the same migrations folder, its journal cut at
      // that build's last migration.
      const oldFolder = join(dir, "old-migrations");
      cpSync(MIGRATIONS, oldFolder, { recursive: true });
      const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as Journal;
      const cut = journal.entries.findIndex((e) => e.tag === OLD_BUILD_LAST_MIGRATION);
      expect(cut).toBeGreaterThan(0);
      expect(cut).toBeLessThan(journal.entries.length - 1);
      writeFileSync(join(oldFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) }));

      const path = join(dir, "hub.db");
      const old = openDb(path);
      migrate(drizzle(old), { migrationsFolder: oldFolder });
      // A household: people, a conversation with a turn, and a memory.
      const now = "2026-09-20T12:00:00.000Z";
      seedRow(old, "people", { id: "person-owner01", display_name: "Willow", role: "owner", created_at: now, updated_at: now, hlc: now });
      seedRow(old, "people", { id: "person-child01", display_name: "Sprout", role: "child", created_at: now, updated_at: now, hlc: now });
      seedRow(old, "conversations", { id: "conv-seeded01", person_id: "person-child01", created_at: now, updated_at: now, hlc: now });
      seedRow(old, "conversation_turns", { id: "turn-seeded01", person_id: "person-child01", conversation_id: "conv-seeded01", user_text: "what do frogs eat", reply_text: "Insects, mostly.", created_at: now });
      seedRow(old, "memory_records", { id: "mem-seeded01", person: "person-child01", scope: "person", text: "Sprout likes frogs", created_at: now, updated_at: now, hlc: now });
      const before = Object.fromEntries(["people", "conversations", "conversation_turns", "memory_records"].map((t) => [t, (old.query(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n]));
      old.close();

      // This build opens it the way db/index.ts does.
      const upgraded = openDb(path);
      try {
        migrate(drizzle(upgraded), { migrationsFolder: MIGRATIONS });
        for (const [table, count] of Object.entries(before)) {
          expect({ table, rows: (upgraded.query(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n }).toEqual({ table, rows: count });
        }
        expect(upgraded.query("SELECT user_text FROM conversation_turns WHERE id = 'turn-seeded01'").get()).toEqual({ user_text: "what do frogs eat" });
        expect(upgraded.query("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(upgraded.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
        // The upgrade ends where a fresh install starts.
        expect(schemaShape(upgraded)).toBe(freshShape(dir));
      } finally {
        upgraded.close();
      }
    });
  }, 60_000);

  test("the schema a fresh install gets is the one CURRENT_SCHEMA_VERSION names: a schema change bumps the version", () => {
    const pinned = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/schema-version.json"), "utf8")) as { version: number; fingerprint: string };
    const fingerprint = createHash("sha256").update(withTempDir(freshShape)).digest("hex");
    if (fingerprint !== pinned.fingerprint && CURRENT_SCHEMA_VERSION === pinned.version) {
      throw new Error(`The schema changed but CURRENT_SCHEMA_VERSION is still ${pinned.version}. Bump it in backend/src/db/schema-version.ts (docs/ENGINEERING.md, schema versions), then set tests/fixtures/schema-version.json to { "version": ${CURRENT_SCHEMA_VERSION + 1}, "fingerprint": "${fingerprint}" }.`);
    }
    expect({ version: CURRENT_SCHEMA_VERSION, fingerprint }).toEqual(pinned);
  }, 60_000);
});
