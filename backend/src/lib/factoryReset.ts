// Step 9: "a factory reset behind a typed confirmation and a fresh
// backup" (plan 4.15). Staged, applied at the next boot - the identical
// safety reasoning restoreStaging.ts's own header gives for restore:
// this process holds an open handle on the live hub.db, so nothing a
// route does can safely swap or delete that file out from under itself.
// A factory reset is really just "restore to nothing," so it reuses
// that same staged-then-applied-at-boot shape rather than inventing a
// second one - db/index.ts calls applyPendingFactoryReset() right
// alongside applyPendingRestore(), the one moment in the hub's life
// when no handle is open and no request is in flight.
//
// lib/backup.ts (needed by stageFactoryReset() below, for the real
// backup it takes first) is deliberately a DYNAMIC import inside that
// function, not a static one at the top of this file - the same
// restoreStaging.ts/backupCrypto.ts split this repo already established
// ("lib/backup.ts imports the live sqlite handle... and
// lib/restoreStaging.ts has to run BEFORE that handle is opened"):
// db/index.ts imports THIS file before `db` is defined, so a static
// import of anything that transitively imports `@/db` here would be a
// real circular-import crash at boot ("Cannot access 'db' before
// initialization"), not just a style preference.
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { moveDbSet, dbSetExists, partialMoveInProgress } from "@/lib/restoreStaging";

const MARKER_FILE = "factory-reset-pending.json";
const PRE_RESET_DB = "hub.db.pre-factory-reset";

// A phrase, not the hub's own name: readable and typeable on a phone
// keyboard without hunting for whatever the household called their hub,
// and unambiguous about what is about to happen - the same "type the
// resource's name to confirm" shape a household member has almost
// certainly seen before (deleting a GitHub repo, a cloud project), just
// with a phrase instead of an identifier since there is no single
// "thing" here to name other than the whole house.
export const FACTORY_RESET_CONFIRMATION_PHRASE = "DELETE EVERYTHING";

export interface StageFactoryResetResult {
  ok: boolean;
  error?: string;
  backupFilename?: string;
}

/** Takes a real backup first (never skipped, never optional - "a fresh
 * backup" is not a suggestion in the plan's own text), then stages the
 * reset. A backup failure refuses the whole reset rather than proceeding
 * without one: a factory reset with no way back is not what this button
 * is for. */
export async function stageFactoryReset(typedConfirmation: string, dir: string = dataDir): Promise<StageFactoryResetResult> {
  if (typedConfirmation !== FACTORY_RESET_CONFIRMATION_PHRASE) {
    return { ok: false, error: `type "${FACTORY_RESET_CONFIRMATION_PHRASE}" exactly to confirm` };
  }
  let backupFilename: string;
  try {
    const { runBackupAndMirror } = await import("@/lib/backup");
    const info = await runBackupAndMirror();
    backupFilename = info.filename;
  } catch (err) {
    return { ok: false, error: `could not take a backup first, so nothing was staged: ${err instanceof Error ? err.message : String(err)}` };
  }
  const marker = { stagedAt: new Date().toISOString(), backupFilename };
  writeFileSync(join(dir, MARKER_FILE), JSON.stringify(marker), { mode: 0o600 });
  return { ok: true, backupFilename };
}

export interface PendingFactoryReset {
  stagedAt: string;
  backupFilename: string;
}

export function pendingFactoryReset(dir: string = dataDir): PendingFactoryReset | null {
  const path = join(dir, MARKER_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PendingFactoryReset;
  } catch {
    return null;
  }
}

export function cancelPendingFactoryReset(dir: string = dataDir): boolean {
  const path = join(dir, MARKER_FILE);
  const had = existsSync(path);
  if (had) unlinkSync(path);
  return had;
}

/** Called by db/index.ts before the database is opened. The live
 * database is renamed aside, never deleted outright - the identical
 * "moved aside, not destroyed" reasoning applyPendingRestore() already
 * gives for hub.db.pre-restore, so a factory reset triggered by mistake
 * (or by a child who found the button) is still recoverable by hand from
 * the pre-reset file, on top of the fresh backup stageFactoryReset()
 * already took. A brand-new, empty hub.db is created the same way a
 * fresh install already gets one - db/index.ts's own migrate() call
 * right after this runs against whatever file is (or isn't) at
 * `hub.db`, so simply removing the old one from that path is enough for
 * the rest of boot to do the rest, unchanged. */
export function applyPendingFactoryReset(dir: string = dataDir): PendingFactoryReset | null {
  const pending = pendingFactoryReset(dir);
  if (!pending) return null;

  const livePath = join(dir, "hub.db");
  const preResetPath = join(dir, PRE_RESET_DB);

  // A second crash window a review (2026-09-06) surfaced while testing
  // the fix above (see partialMoveInProgress()'s own header in
  // restoreStaging.ts): if THIS retry is itself resuming a previously
  // crashed attempt, finish reuniting that main file with its still-
  // straggling -wal/-shm instead of archiving it away from them.
  if (partialMoveInProgress(livePath, preResetPath)) {
    moveDbSet(livePath, preResetPath);
    unlinkSync(join(dir, MARKER_FILE));
    return pending;
  }

  if (dbSetExists(preResetPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    moveDbSet(preResetPath, `${preResetPath}-${stamp}`);
  }
  moveDbSet(livePath, preResetPath);

  unlinkSync(join(dir, MARKER_FILE));
  return pending;
}
