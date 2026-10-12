// A bench's disposable database goes back to exactly its starting state between
// repeats and arms. Every user table (rowid tables only, FTS shadow tables left
// to their triggers) is snapshotted by its highest rowid; a restore deletes every
// row added since, with foreign keys off while it runs and back on after. Rows
// that existed before the snapshot (migrations, settings written by setup) stay.
// Only ever call this on the bench's own database under the OS temp root.
import type { Database } from "bun:sqlite";

export type DbSnapshot = Record<string, number>;

function rowidTables(sqlite: Database): string[] {
  const all = sqlite.query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string | null }[];
  const virtuals = all.filter((t) => /CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql ?? "")).map((t) => t.name);
  return all
    .filter((t) => !/WITHOUT\s+ROWID/i.test(t.sql ?? "") && !/CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql ?? ""))
    .filter((t) => !virtuals.some((v) => t.name.startsWith(`${v}_`)))
    .map((t) => t.name);
}

export function snapshotDb(sqlite: Database): DbSnapshot {
  const snap: DbSnapshot = {};
  for (const t of rowidTables(sqlite)) snap[t] = (sqlite.query(`SELECT COALESCE(MAX(rowid), 0) AS m FROM "${t}"`).get() as { m: number }).m;
  return snap;
}

export function restoreDb(sqlite: Database, snap: DbSnapshot): void {
  sqlite.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const [t, max] of Object.entries(snap)) sqlite.query(`DELETE FROM "${t}" WHERE rowid > ?`).run(max);
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
}

/** Row counts of every snapshotted table: equal fingerprints mean equal starting state. */
export function fingerprintDb(sqlite: Database, snap: DbSnapshot): string {
  return Object.keys(snap).sort().map((t) => `${t}=${(sqlite.query(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c}`).join(",");
}
