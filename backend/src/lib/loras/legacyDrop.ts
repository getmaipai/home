// STACK-LORAS-01 slice 6 (docs/plans/stack-owns-loras-2026-11-25.md, "Home removal"; docs/dev/loras-legacy-drop.md): the one place that still names Home's old
// `loras`, `video_adapter_prefs` and `picture_adapter_prefs` tables. It runs once at hub start, in the background, and it is the only thing that ever drops them.
//
// Migration 0213 is a numbered marker that changes nothing: an SQL migration cannot ask the Stack anything and would keep no copy. This step does both.
//   1. No old table left: nothing to do (every later start, a fresh install, a test database with the tables already gone).
//   2. Rows in `loras`: the Stack must list every one of their ids (live and trash). The Stack cannot be read, or one id is missing: REFUSE, keep every table, say why.
//   3. Archive every row of the three tables to a JSON file (checked by re-reading it) and to the `legacy_table_archive` table, in one transaction with the people copy.
//   4. Copy each style's named adults (`availability.people`) into `lora_people` (which is Home's, kept) unless a row already exists for that id.
//   5. Drop the three tables, in the same transaction. Any failure rolls the lot back.
// It never reads the archive again and never deletes a legacy file on disk.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LEGACY_TABLES = ["loras", "video_adapter_prefs", "picture_adapter_prefs"] as const;
export const ARCHIVE_TABLE = "legacy_table_archive";
const KEYS: Record<(typeof LEGACY_TABLES)[number], string> = { loras: "id", video_adapter_prefs: "adapter_id", picture_adapter_prefs: "adapter_id" };

export type LegacyDropResult =
  | { state: "nothing" }
  | { state: "dropped"; rows: Record<string, number>; file: string | null; fileSha256: string | null; peopleCopied: number }
  | { state: "refused"; reason: "stack_unreachable" | "missing_ids" | "archive_failed"; missing?: string[]; detail: string };

export interface LegacyDropDeps {
  sqlite: Database;
  /** Every LoRA id the Stack lists, live and in its trash. Throws when the Stack cannot be read. */
  listStackIds: () => Promise<string[]>;
  /** The folder the JSON archive goes in (created, owner-only). */
  archiveDir: string;
  now?: () => Date;
  /** A new hybrid logical clock stamp for a `lora_people` row. */
  hlc: () => string;
}

const PERSON = /^person-[a-z0-9]{6,}$/;

function existingTables(sqlite: Database): (typeof LEGACY_TABLES)[number][] {
  const names = (sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  return LEGACY_TABLES.filter((t) => names.includes(t));
}

/** The named adults of one stored record, or an empty list when the record does not parse or names none. */
function peopleOf(record: string): string[] {
  try {
    const parsed = JSON.parse(record) as { availability?: { people?: unknown } };
    const list = parsed.availability?.people;
    return Array.isArray(list) ? [...new Set(list.filter((p): p is string => typeof p === "string" && PERSON.test(p)))] : [];
  } catch { return []; }
}

export async function dropLegacyLoraTables(deps: LegacyDropDeps): Promise<LegacyDropResult> {
  const { sqlite } = deps;
  const tables = existingTables(sqlite);
  if (tables.length === 0) return { state: "nothing" };

  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const table of tables) rows[table] = sqlite.query(`SELECT * FROM "${table}" ORDER BY "${KEYS[table]}"`).all() as Record<string, unknown>[];

  // Step 2: the Stack must hold every style Home holds.
  const loraRows = rows.loras ?? [];
  if (loraRows.length > 0) {
    let stackIds: Set<string>;
    try { stackIds = new Set(await deps.listStackIds()); }
    catch (error) { return { state: "refused", reason: "stack_unreachable", detail: `The Stack could not be read (${(error as Error).message}); the old tables are kept.` }; }
    const missing = loraRows.map((r) => String(r.id)).filter((id) => !stackIds.has(id));
    if (missing.length > 0) return { state: "refused", reason: "missing_ids", missing, detail: `The Stack does not list ${missing.length} of ${loraRows.length} styles; the old tables are kept.` };
  }

  // Step 3 (file half): a JSON copy, checked by reading it back.
  const at = (deps.now?.() ?? new Date()).toISOString();
  let file: string | null = null;
  let fileSha256: string | null = null;
  const total = tables.reduce((sum, t) => sum + rows[t]!.length, 0);
  if (total > 0) {
    try {
      mkdirSync(deps.archiveDir, { recursive: true, mode: 0o700 });
      file = join(deps.archiveDir, `loras-legacy-${at.replace(/[:.]/g, "-")}.json`);
      const body = JSON.stringify({ archived_at: at, note: "Home's old LoRA tables before STACK-LORAS-01 slice 6 dropped them. Restore: docs/dev/loras-legacy-drop.md", tables: rows }, null, 1);
      fileSha256 = createHash("sha256").update(body).digest("hex");
      writeFileSync(file, body, { mode: 0o600 });
      chmodSync(file, 0o600);
      if (createHash("sha256").update(readFileSync(file)).digest("hex") !== fileSha256) throw new Error("the archive file did not read back the same");
    } catch (error) { return { state: "refused", reason: "archive_failed", detail: `The archive file could not be written (${(error as Error).message}); the old tables are kept.` }; }
  }

  // Steps 3 (table half), 4 and 5, all or nothing.
  let peopleCopied = 0;
  try {
    sqlite.transaction(() => {
      sqlite.exec(`CREATE TABLE IF NOT EXISTS ${ARCHIVE_TABLE} (source_table TEXT NOT NULL, row_key TEXT NOT NULL, row_json TEXT NOT NULL, archived_at TEXT NOT NULL, PRIMARY KEY (source_table, row_key))`);
      const put = sqlite.query(`INSERT OR IGNORE INTO ${ARCHIVE_TABLE} (source_table, row_key, row_json, archived_at) VALUES (?, ?, ?, ?)`);
      for (const table of tables) for (const row of rows[table]!) put.run(table, String(row[KEYS[table]]), JSON.stringify(row), at);
      for (const table of tables) {
        const kept = (sqlite.query(`SELECT count(*) AS n FROM ${ARCHIVE_TABLE} WHERE source_table = ?`).get(table) as { n: number }).n;
        if (kept < rows[table]!.length) throw new Error(`archive of ${table} holds ${kept} of ${rows[table]!.length} rows`);
      }
      const hasPeople = sqlite.query("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'lora_people'").get() !== null;
      if (hasPeople) {
        const insert = sqlite.query("INSERT OR IGNORE INTO lora_people (lora_id, people, updated_at, hlc, provenance) VALUES (?, ?, ?, ?, ?)");
        for (const row of loraRows) {
          const people = peopleOf(String(row.record));
          if (people.length === 0) continue;
          peopleCopied += insert.run(String(row.id), JSON.stringify(people), at, deps.hlc(), "migration:stack-loras-slice6").changes;
        }
      }
      for (const table of tables) sqlite.exec(`DROP TABLE "${table}"`);
    })();
  } catch (error) { return { state: "refused", reason: "archive_failed", detail: `The archive or drop failed and was rolled back (${(error as Error).message}); the old tables are kept.` }; }

  return { state: "dropped", rows: Object.fromEntries(tables.map((t) => [t, rows[t]!.length])), file, fileSha256, peopleCopied };
}
