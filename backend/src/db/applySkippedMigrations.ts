// Drizzle's migrator applies only the migrations whose journal `when` is newer than the newest one already applied. A migration that two
// sessions numbered at the same time can carry an older `when` than one that landed before it, and then it is silently skipped on a
// database that already has the newer one (2026-11-07: 0182 and 0184 never ran on the live hub, so cloned_voices had no `kind` column).
// Run before migrate(): every journal entry that is older than the newest applied one and is not recorded is applied now, then recorded.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";

const BENIGN = /duplicate column name|already exists/i;

export function applySkippedMigrations(sqlite: Database, folder: string): string[] {
  const table = sqlite.query("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!table) return [];
  const recorded = (sqlite.query("SELECT created_at FROM __drizzle_migrations").all() as Array<{ created_at: number | string | null }>)
    .map((row) => Number(row.created_at)).filter((value) => Number.isFinite(value));
  if (recorded.length === 0) return [];
  const newest = Math.max(...recorded);
  const have = new Set(recorded);
  const journalPath = join(folder, "meta", "_journal.json");
  if (!existsSync(journalPath)) return [];
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number; tag: string; when: number }> };
  const applied: string[] = [];
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    if (entry.when > newest || have.has(entry.when)) continue;
    const file = join(folder, `${entry.tag}.sql`);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    try {
      sqlite.transaction(() => {
        for (const statement of text.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
          try { sqlite.exec(statement); } catch (error) { if (!BENIGN.test(String((error as Error).message))) throw error; }
        }
        sqlite.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(createHash("sha256").update(text).digest("hex"), entry.when);
      })();
      applied.push(entry.tag);
    } catch (error) {
      // Leave it unrecorded and keep booting: a hub that starts with one missing column is better than one that does not start.
      console.warn(`[migrations] could not apply skipped migration ${entry.tag}: ${(error as Error).message}`);
    }
  }
  if (applied.length > 0) console.log(`[migrations] applied skipped migrations: ${applied.join(", ")}`);
  return applied;
}
