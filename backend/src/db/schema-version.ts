import type { Database } from "bun:sqlite";

// docs/ENGINEERING.md > Data safety: schema versions. Bump this in the same
// commit as any add/remove/rename of a persisted table or column, even when
// no migration needs to run. A rollback (re-pointing to the previous
// release, see docs/UPDATES.md) that opened a database a newer version had
// already written to would silently corrupt or drop data; refusing to open
// a too-new database is what makes the rollback safe.
export const CURRENT_SCHEMA_VERSION = 7;

export class SchemaTooNewError extends Error {
  constructor(
    public readonly dbVersion: number,
    public readonly appVersion: number,
  ) {
    super(
      `Database schema version ${dbVersion} is newer than this build understands ` +
        `(${appVersion}). Refusing to open it: install the matching release ` +
        `instead of running an older one against this data directory.`,
    );
    this.name = "SchemaTooNewError";
  }
}

// SQLite's own `user_version` pragma holds the stamp: no extra table, no
// query needed before the schema itself exists on a brand new file.
export function checkSchemaVersion(sqlite: Database): void {
  const row = sqlite.query("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  const dbVersion = row?.user_version ?? 0;
  if (dbVersion > CURRENT_SCHEMA_VERSION) {
    throw new SchemaTooNewError(dbVersion, CURRENT_SCHEMA_VERSION);
  }
}

export function stampSchemaVersion(sqlite: Database): void {
  sqlite.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
}
