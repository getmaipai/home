import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "@/lib/paths";
import { checkSchemaVersion, stampSchemaVersion } from "@/db/schema-version";
import { applyPendingRestore } from "@/lib/restoreStaging";
import * as schema from "@/db/schema";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "migrations");

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true, mode: 0o700 });

// A staged restore is applied here and nowhere else: this is the only
// moment in the hub's life when no handle is open on hub.db and no
// request is in flight (lib/restoreStaging.ts explains why that matters
// and why restore is staged rather than swapped live).
const applied = applyPendingRestore();
if (applied) {
  console.log(`[restore] applied backup ${applied.filename} staged at ${applied.stagedAt}`);
}

const dbPath = join(dataDir, "hub.db");
const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

// Guard first: a too-new database must never be touched, not even by the
// migrator, or a rollback could half-apply a migration meant for a newer
// schema. See db/schema-version.ts.
checkSchemaVersion(sqlite);

export const db = drizzle(sqlite, { schema });

migrate(db, { migrationsFolder });
stampSchemaVersion(sqlite);

export { sqlite };
