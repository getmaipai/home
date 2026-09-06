// Step 8: "partial restore of one person's data" (2.5). Full restore
// (restoreStaging.ts) replaces the whole household database and needs a
// restart; this is the narrower, same-request operation - one person's
// memories, conversation history and settings come back from an old
// backup while everyone else's live data is untouched, no restart
// required. Deliberately narrow in what it restores: never credentials,
// sessions, passkeys, device tokens, grants, or role - those are live
// security state, and reintroducing an old password hash or a
// since-revoked grant from a stale backup would be a real security
// regression dressed up as a recovery feature.
//
// Scoped to the CURRENT schema only, unlike full restore (which accepts
// any backup this build's schema version can still open): every copied
// table's column list is read fresh from PRAGMA table_info() rather than
// hand-typed, so a backup whose schema for one of these tables has since
// changed fails that one table with a clear SQL error instead of a
// silent partial write - a real, honest limitation for a backup old
// enough to predate a since-added column, not a promise this makes and
// breaks quietly.
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { db, sqlite } from "@/db";
import { pendingEmbeddings } from "@/db/schema";
import { backupDir } from "@/lib/paths";
import { decryptFile } from "@/lib/backupCrypto";
import { CURRENT_SCHEMA_VERSION } from "@/db/schema-version";
import { randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";

export class PartialRestoreRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartialRestoreRefused";
  }
}

export interface PartialRestoreResult {
  memories: number;
  conversations: number;
  conversationThreads: number;
  settings: number;
}

/** Same posture as restoreStaging.ts's verifyRestorable(), narrowed to
 * what this operation actually needs: a real, openable, not-too-new
 * database that genuinely contains the person being restored. Unlike
 * full restore it does NOT require the backup to have at least one
 * living person overall - only that THIS one is in it. */
function verifyContainsPerson(path: string, personId: string): void {
  let probe: Database;
  try {
    probe = new Database(path, { readonly: true });
  } catch {
    throw new PartialRestoreRefused("that file is not a MaiPai Home backup, so nothing was restored");
  }
  try {
    let version: number;
    try {
      version = (probe.query("PRAGMA user_version").get() as { user_version: number } | undefined)?.user_version ?? 0;
    } catch {
      throw new PartialRestoreRefused("that file is not a MaiPai Home backup, so nothing was restored");
    }
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new PartialRestoreRefused(
        `that backup was made by a newer version of MaiPai Home (data version ${version}, this build reads ${CURRENT_SCHEMA_VERSION}). Update MaiPai Home first.`,
      );
    }
    let found: number;
    try {
      found = (probe.query("SELECT COUNT(*) AS n FROM people WHERE id = ?").get(personId) as { n: number } | undefined)?.n ?? 0;
    } catch {
      throw new PartialRestoreRefused("that file is not a MaiPai Home backup, so nothing was restored");
    }
    if (found === 0) {
      throw new PartialRestoreRefused("that backup does not contain this person, so nothing was restored");
    }
  } finally {
    probe.close();
  }
}

function copyPersonScopedRows(table: string, whereClause: string, param: string): number {
  const columns = (sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
  const colList = columns.join(", ");
  return sqlite
    .query(`INSERT OR IGNORE INTO ${table} (${colList}) SELECT ${colList} FROM restore_src.${table} WHERE ${whereClause}`)
    .run(param).changes;
}

/** Restores one living person's memories, conversation history and
 * settings from an old backup file into the live database. The person
 * must already exist live (this is "bring back what I lost", never
 * "resurrect someone deleted" - a genuinely different, riskier
 * operation this does not attempt). Safe to run twice on the same
 * backup: every insert is `OR IGNORE` against the same primary keys the
 * backup itself assigned, so a repeat restore adds nothing a second
 * time rather than erroring or duplicating. */
export function restorePersonFromBackup(filename: string, personId: string): PartialRestoreResult {
  const livingPerson = sqlite.query("SELECT id FROM people WHERE id = ? AND deleted_at IS NULL").get(personId);
  if (!livingPerson) throw new PartialRestoreRefused("no such person (or they were deleted)");

  const inPath = join(backupDir, filename);
  if (!existsSync(inPath)) throw new PartialRestoreRefused(`no such backup: ${filename}`);

  const tmpPath = join(tmpdir(), `maipai-partial-restore-${randomSuffix(8)}.db`);
  try {
    decryptFile(inPath, tmpPath);
  } catch {
    throw new PartialRestoreRefused("that backup could not be read. Try another one.");
  }

  try {
    verifyContainsPerson(tmpPath, personId);

    sqlite.exec(`ATTACH DATABASE '${tmpPath.replace(/'/g, "''")}' AS restore_src`);
    try {
      // All four tables restored atomically - ATTACH itself cannot run
      // inside a transaction (SQLite refuses it with an open one), so it
      // stays outside; everything that actually writes runs inside
      // sqlite.transaction() so a failure partway through (a schema
      // mismatch on a later table) rolls back everything already copied
      // rather than leaving the household with memories restored but
      // conversations and settings silently missing, and an error
      // response that looks like nothing happened at all.
      const restore = sqlite.transaction(() => {
        // memory_records handled by hand, not the generic column-list
        // helper: embedding_space is deliberately overwritten to NULL
        // (embeddings themselves never sync or restore - memory-record
        // schema's own comment - a stale vector from before is worse
        // than none), and every restored row is queued in
        // pending_embeddings so the existing memory.embedding_retry core
        // job (already scheduled every minute) re-embeds it for real
        // rather than this function inventing a second embed path.
        const hlc = nextHlc();
        const restoredMemoryIds = sqlite
          .query(
            `INSERT OR IGNORE INTO memory_records
               (id, record_kind, text, category, tier, status, scope, person, source, importance, pinned, sensitive, uses, created_at, last_used_at, valid_from, valid_to, expired_at, superseded_by, embedding_space, hlc, deleted_at)
             SELECT id, record_kind, text, category, tier, status, scope, person, source, importance, pinned, sensitive, uses, created_at, last_used_at, valid_from, valid_to, expired_at, superseded_by, NULL, ?, deleted_at
             FROM restore_src.memory_records WHERE scope = 'person' AND person = ?
             RETURNING id`,
          )
          .all(hlc, personId) as Array<{ id: string }>;
        for (const row of restoredMemoryIds) {
          db.insert(pendingEmbeddings)
            .values({ memoryId: row.id, queuedAt: new Date().toISOString() })
            .onConflictDoNothing()
            .run();
        }

        const conversationThreads = copyPersonScopedRows("conversations", "person_id = ?", personId);
        const conversations = copyPersonScopedRows("conversation_turns", "person_id = ?", personId);
        const settings = copyPersonScopedRows("settings_values", "scope = ?", `person:${personId}`);

        return { memories: restoredMemoryIds.length, conversations, conversationThreads, settings };
      });
      return restore();
    } finally {
      sqlite.exec("DETACH DATABASE restore_src");
    }
  } finally {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  }
}
