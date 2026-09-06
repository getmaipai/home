import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { backupDir, dataDir, ensureDataDir } from "@/lib/paths";
import { decryptFile } from "@/lib/backupCrypto";
import { CURRENT_SCHEMA_VERSION } from "@/db/schema-version";

// ---------------------------------------------------------------------
// Restore: staged, applied at boot.
//
// Restoring means replacing the whole household database. This process
// holds an open handle to it (db/index.ts opens `hub.db` once at import
// and every query in the hub is bound to that handle), so swapping the
// file underneath a running hub is not something a route can safely do:
// in-flight requests would be reading a file that no longer exists, and
// SQLite's WAL for the old database would still be sitting next to the
// new one.
//
// So restore is staged, not applied live. A route decrypts the chosen
// backup to `hub.db.pending-restore`, checks it is a real, openable,
// this-build-can-read-it database, and stops there. The swap happens in
// applyPendingRestore(), called by db/index.ts before it opens anything,
// which is the one moment in the hub's life when no handle is open and
// no request is in flight. The family restarts the hub to finish; the UI
// says so plainly.
//
// The alternative (quiesce requests, close the handle, replace, reopen)
// is a bigger change with a much worse failure mode: a restore that
// fails halfway leaves a running process bound to a database that is no
// longer there. Staging's worst case is that nothing happens yet.
const PENDING_DB = "hub.db.pending-restore";
const PENDING_META = "hub.db.pending-restore.json";
const PRE_RESTORE_DB = "hub.db.pre-restore";

// Defined in @/wire (alias-free) so the frontend imports the real shape,
// the same pattern BackupInfo already uses.
import type { PendingRestore } from "@/wire";
export type { PendingRestore } from "@/wire";

/** A refusal written for the person reading it. Anything else that goes
 * wrong (a crypto failure, a filesystem error carrying a server path) is
 * NOT one of these, and a route must never pass those through to a
 * browser (code review, 2026-09-05). */
export class RestoreRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreRefused";
  }
}


// Every function here takes the data directory as an argument,
// defaulting to the real one. Not for flexibility: applyPendingRestore()
// renames and deletes the very files a live SQLite handle owns, so the
// only way to test it honestly is to point it at a throwaway directory
// and check the filesystem afterward. Running it against the real
// dataDir from inside a test process breaks that process's own open
// handle, which is precisely the hazard this whole staging design exists
// to keep out of the running hub.
function pendingDbPath(dir: string): string {
  return join(dir, PENDING_DB);
}
function pendingMetaPath(dir: string): string {
  return join(dir, PENDING_META);
}

/** Whatever restore is staged and waiting for the next restart, if any. */
export function pendingRestore(dir: string = dataDir): PendingRestore | null {
  if (!existsSync(pendingDbPath(dir)) || !existsSync(pendingMetaPath(dir))) return null;
  try {
    return JSON.parse(readFileSync(pendingMetaPath(dir), "utf-8")) as PendingRestore;
  } catch {
    return null;
  }
}

export function cancelPendingRestore(dir: string = dataDir): boolean {
  const had = existsSync(pendingDbPath(dir));
  for (const p of [pendingDbPath(dir), pendingMetaPath(dir)]) {
    if (existsSync(p)) unlinkSync(p);
  }
  return had;
}

// Moves a main SQLite file and its -wal/-shm siblings together, as one
// call - shared with lib/factoryReset.ts (a code review, 2026-09-06,
// found and fixed the identical crash-ordering hazard in both files: see
// applyPendingRestore()'s own comment on `dbSetExists()`'s use below for
// the full failure scenario). Exported so factoryReset.ts reuses this
// exact implementation rather than a second hand-copy that could drift.
export function moveDbSet(fromBase: string, toBase: string): void {
  if (existsSync(fromBase)) renameSync(fromBase, toBase);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(fromBase + suffix)) renameSync(fromBase + suffix, toBase + suffix);
  }
}

export function dbSetExists(base: string): boolean {
  return existsSync(base) || existsSync(`${base}-wal`) || existsSync(`${base}-shm`);
}

// A second, subtler crash window a review (2026-09-06) surfaced while
// verifying the moveDbSet() fix above with a real regression test: at
// the moment `moveDbSet(fromBase, toBase)` moves a main file BEFORE its
// own -wal/-shm (the only order it uses), a crash between those two
// steps leaves the main file already at `toBase` while its -wal/-shm
// are still sitting under `fromBase`'s OLD name - not yet renamed, and
// so invisible to a `dbSetExists(toBase)` check looking for THEM at the
// NEW name. A naive retry would then archive that lone main file away
// (there being nothing else at `toBase` to associate the stragglers
// with), then reunite the stragglers with the empty slot left behind -
// splitting a database from its own journal exactly the way the
// original bug did, just one crash-window over. Detected here (main
// file gone from `fromBase`, but its -wal/-shm still there, AND a main
// file already present at `toBase`) so the caller can finish that exact
// move instead of archiving: this is the only partially-moved state
// `moveDbSet()`'s own order can ever leave behind, so there is nothing
// ambiguous about where these stragglers belong.
export function partialMoveInProgress(fromBase: string, toBase: string): boolean {
  return !existsSync(fromBase) && (existsSync(`${fromBase}-wal`) || existsSync(`${fromBase}-shm`)) && existsSync(toBase);
}

/** Everything that must be true before a file is allowed to become the
 * household's database at the next boot. Each check exists because
 * failing it turns a restore into a hub that will not start:
 *
 * - It has to open as SQLite at all. A truncated or wrong-key decrypt
 *   would otherwise be discovered only after the swap.
 * - Its schema version cannot be newer than this build understands.
 *   `checkSchemaVersion` refuses a too-new database on purpose, so
 *   swapping one in would brick the hub in exactly the way that guard
 *   exists to prevent - and it would do it at boot, after the old
 *   database had already been moved aside.
 * - It has to contain at least one person. A database with an empty
 *   roster has nobody who can sign in, which locks the family out of
 *   their own hub with no way back through the UI.
 */
function verifyRestorable(path: string): void {
  let probe: Database;
  try {
    probe = new Database(path, { readonly: true });
  } catch {
    throw new RestoreRefused("that backup did not open as a database, so it was not staged");
  }
  try {
    // The version is read and checked FIRST, in its own guard. A backup
    // from a newer build may legitimately have a `people` table this
    // build cannot query, so counting people before checking the version
    // reports "this is not a MaiPai Home backup" for a file that is one
    // (caught by the tests for this function, 2026-09-05).
    let version: number;
    try {
      version = (probe.query("PRAGMA user_version").get() as { user_version: number } | undefined)?.user_version ?? 0;
    } catch {
      throw new RestoreRefused("that file is not a MaiPai Home backup, so it was not staged");
    }
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new RestoreRefused(
        `that backup was made by a newer version of MaiPai Home (data version ${version}, this build reads ${CURRENT_SCHEMA_VERSION}). ` +
          "Update MaiPai Home first, then restore it.",
      );
    }

    let people: number;
    try {
      // `deleted_at IS NULL` is the whole point: every sign-in path
      // filters tombstones out (middleware/auth.ts, routes/auth.ts), so
      // a backup whose people are all deleted has nobody who can sign in
      // and would produce exactly the lockout this check exists to
      // prevent. Found in a code review, 2026-09-05.
      people =
        (probe.query("SELECT COUNT(*) AS n FROM people WHERE deleted_at IS NULL").get() as
          | { n: number }
          | undefined)?.n ?? 0;
    } catch {
      throw new RestoreRefused("that file is not a MaiPai Home backup, so it was not staged");
    }
    if (people === 0) {
      throw new RestoreRefused("that backup contains no people, so restoring it would lock everyone out. It was not staged.");
    }
  } finally {
    probe.close();
  }
}

/** Stages one backup to become the household's database at the next
 * restart. Verifies before it commits to anything: a backup that fails
 * any check leaves no staged file behind, so a failed attempt cannot
 * quietly become a pending restore. */
export function stageRestore(
  filename: string,
  stagedByPersonId: string,
  dir: string = dataDir,
): PendingRestore {
  const inPath = join(backupDir, filename);
  if (!existsSync(inPath)) throw new RestoreRefused(`no such backup: ${filename}`);
  // One at a time. Without this, staging a second backup silently
  // replaces an already-confirmed pending restore, and a failed attempt
  // wipes it entirely through the cleanup path below (code review,
  // 2026-09-05). The UI hides the buttons while one is pending; the
  // route must not depend on that.
  if (pendingRestore(dir)) {
    throw new RestoreRefused(
      "a restore is already waiting for the next restart. Cancel it first if you want to choose a different backup.",
    );
  }
  ensureDataDir(dir);

  // Straight to the pending path, then verified in place: a separate
  // temp file would only move the same cleanup problem somewhere else,
  // and every failure path below removes it.
  const pending: PendingRestore = {
    filename,
    stagedAt: new Date().toISOString(),
    stagedByPersonId,
  };
  try {
    decryptFile(inPath, pendingDbPath(dir));
    verifyRestorable(pendingDbPath(dir));
    // The meta write is inside the guard too. Outside it, a failure here
    // (disk full, permissions) left a full copy of the database staged
    // with no meta file beside it: pendingRestore() needs both, so it
    // reported nothing staged, the UI offered no Cancel, and the orphan
    // was never cleaned up.
    writeFileSync(pendingMetaPath(dir), JSON.stringify(pending), { mode: 0o600 });
  } catch (err) {
    cancelPendingRestore(dir);
    throw err;
  }
  return pending;
}

/** Applies a staged restore, if there is one. Called by db/index.ts
 * before the database is opened, which is the only safe moment for it.
 *
 * The old database is moved aside rather than deleted: a restore is the
 * one action a family cannot undo from the UI, and `hub.db.pre-restore`
 * is what makes it undoable by hand. The WAL and shared-memory files are
 * removed, not kept - they belong to the database being replaced, and
 * SQLite would apply that stale journal on top of the restored file. */
export function applyPendingRestore(dir: string = dataDir): PendingRestore | null {
  const pending = pendingRestore(dir);
  if (!pending) return null;

  // Verified again, here, not just when it was staged. Nothing has
  // re-checked this file since: decryptFile's writeFileSync never
  // fsyncs, so a power cut right after staging - which is exactly how a
  // family "restarts MaiPai Home to finish" an appliance restore - can
  // leave a truncated file behind. Without this check the good database
  // is moved aside first and the truncated one renamed into place, and
  // then checkSchemaVersion refuses to open it at import time: a hub
  // that will not start at all, fixable only by renaming files by hand.
  // The staging checks exist to prevent exactly that, so they run at the
  // moment it counts too (code review, 2026-09-05).
  try {
    verifyRestorable(pendingDbPath(dir));
  } catch (err) {
    // The live database is left completely untouched. The staged file
    // stays where it is rather than being deleted: it is evidence, and
    // an owner can cancel it from the UI once the hub is up.
    console.error(
      `[restore] refusing to apply ${pending.filename}: ${(err as Error).message}. The current database was left alone.`,
    );
    return null;
  }

  const livePath = join(dir, "hub.db");
  const preRestorePath = join(dir, PRE_RESTORE_DB);

  // Never clobber an earlier pre-restore copy. Restore A, restart,
  // realise it was the wrong one, restore B, restart: overwriting here
  // would leave the household's ORIGINAL database gone for good, with
  // A's data sitting in the file that is supposed to be the way back.
  //
  // A code review (2026-09-06), on lib/factoryReset.ts's own copy of
  // this exact same shape, found that gating the archive step on the
  // main file's existence ALONE could split a database from its own
  // WAL/SHM across a crash: a crash between renaming the main file here
  // and renaming its -wal/-shm below leaves them under the OLD names on
  // the next boot's retry, so THIS check (looking only at
  // `preRestorePath` itself) misses them, archives the bare main file
  // alone, and the later loop then renames the orphaned -wal/-shm onto
  // the now-empty pre-restore slot - a main file with no journal next to
  // a journal with no main file, on the one copy this feature promises
  // is recoverable by hand. Fixed the same way there: move a main file
  // and its -wal/-shm together, as one call, keyed off whether ANY of
  // the three exist rather than the main file alone.
  // A second crash window (also caught by the same review pass, with a
  // regression test): if THIS retry is itself resuming a previously
  // crashed attempt (partialMoveInProgress() - see its own header),
  // finish reuniting that main file with its still-straggling -wal/-shm
  // instead of archiving it away from them.
  if (partialMoveInProgress(livePath, preRestorePath)) {
    moveDbSet(livePath, preRestorePath);
    renameSync(pendingDbPath(dir), livePath);
    if (existsSync(pendingMetaPath(dir))) unlinkSync(pendingMetaPath(dir));
    return pending;
  }

  if (dbSetExists(preRestorePath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    moveDbSet(preRestorePath, `${preRestorePath}-${stamp}`);
  }

  // The journal files move WITH the database they belong to, rather than
  // being deleted. In WAL mode a committed transaction lives in the
  // -wal until a checkpoint, and auto-checkpoint only fires at 1000
  // pages, so a hub that was power-cycled rather than shut down cleanly
  // can have real, committed data sitting only in that journal.
  // Unlinking it silently emptied the one undo a family has for a
  // restore. SQLite's own naming convention means renaming them beside
  // hub.db.pre-restore keeps that copy complete and recoverable, and
  // leaves nothing stale next to the restored database (code review,
  // 2026-09-05, verified against a real 1.2 MB journal).
  moveDbSet(livePath, preRestorePath);
  renameSync(pendingDbPath(dir), livePath);
  if (existsSync(pendingMetaPath(dir))) unlinkSync(pendingMetaPath(dir));
  return pending;
}
