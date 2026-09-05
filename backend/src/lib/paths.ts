import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// `data/` lives at the repo root (gitignored there, see .gitignore), the
// same place the legacy hub kept it. `MAIPAI_DATA_DIR` overrides it, used by
// tests to point at a throwaway directory instead of the real one.
export const dataDir =
  process.env.MAIPAI_DATA_DIR ?? resolve(process.cwd(), "../data");

// Backups (2.5) land in a sibling of data/, not inside it: the whole
// point of a backup target is to be somewhere a lost or corrupted data/
// doesn't take it down too, even for this pass's `local` target (a real
// second disk or folder is `MAIPAI_BACKUP_DIR`'s job, same override
// pattern as MAIPAI_DATA_DIR). Tests set MAIPAI_BACKUP_DIR to their own
// throwaway directory (tests/preload.ts), independent of MAIPAI_DATA_DIR's
// throwaway directory, so a test run's backups can never collide with
// another's in the same way a shared `../backups` off two different
// temp data dirs would.
export const backupDir =
  process.env.MAIPAI_BACKUP_DIR ?? resolve(dataDir, "..", "backups");

// Downloaded GGUF weights and llama-server engine binaries (4.11's
// deferred download-job queue): both real household data in the sense
// that a household chose and paid bandwidth/disk for them, but neither is
// ever synced, backed up, or read by anything except the engine
// supervisor, so they get their own subdirectories under data/ rather
// than crowding hub.db's world. `MAIPAI_DATA_DIR` already covers test
// isolation for both (they resolve from dataDir, not a separate env var).
export const modelsDir = resolve(dataDir, "models");
export const enginesDir = resolve(dataDir, "engines");

// The wake-word pipeline's shared feature models (melspectrogram +
// embedding) plus per-phrase detectors (2026-09-04, the wake-word plan
// in docs/dev.md): same shape as models/engines above, `voice/wakewords`
// matching the legacy hub's own directory name exactly (`home-legacy.git`
// download.ts's `WAKEWORD_DIR_REL`) since nothing about that path is
// legacy-specific.
export const wakewordDir = resolve(dataDir, "voice", "wakewords");

// A household member's own uploaded voice-cloning sample (2026-09-04):
// real, irreplaceable family data (unlike wakewordDir's re-downloadable
// base models), but still not synced/backed up yet - lib/backup.ts's
// VACUUM INTO only covers hub.db, a real documented gap (docs/dev.md).
export const clonedVoicesDir = resolve(dataDir, "voice", "cloned");

// Shared by lib/backup.ts's ensureBackupDir() and lib/clonedVoices.ts's
// ensureDir(): a code review (2026-09-04) found both had independently
// hand-rolled the identical "create it, owner-only, if it's not already
// there" check. 0700: every directory under data/ (and its backupDir
// sibling) holds real household data, never a mode a future caller
// should have to remember to pass.
export function ensureDataDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}
