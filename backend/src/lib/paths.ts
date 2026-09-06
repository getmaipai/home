import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// The bundled packages' own source directory - checked into git, never
// per-household data, so it lives here (not under dataDir below) even
// though it's a "path" in the same sense. Moved from lib/plugins.ts
// (session-d-packages-and-store.md step 5) so lib/denoHost.ts can read
// it too without creating a plugins.ts <-> denoHost.ts import cycle
// (plugins.ts's own runPlugin() calls into denoHost.ts for a Tier 1
// package).
export const PACKAGES_DIR = join(import.meta.dir, "..", "..", "packages");

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

// Session C step 5 (session-c-brain-and-voice.md): the STT program's own
// re-downloadable models - the Silero VAD onnx file (utterance
// endpointing, lib/sttSession.ts) and the Moonshine tiny-en archive
// (transcription, lib/stt.ts). Same shape as wakewordDir above.
export const sttDir = resolve(dataDir, "voice", "stt");

// A package's own cached fetch responses (session-d-packages-and-store.md
// step 3, `lib/packageCache.ts`): one subdirectory per package id under
// here, never a spec-shaped record and never synced or backed up - a cache
// entry is, by definition, reconstructible from the third-party service it
// came from.
export const cacheDir = resolve(dataDir, "cache");

// A Tier 1 package's own writable state (session-d-packages-and-store.md
// step 5, `lib/denoHost.ts`) - node:sqlite files, anything the sandboxed
// Deno process itself persists. Deliberately separate from PACKAGES_DIR
// above (the package's checked-in source, read-only from the sandbox's
// own point of view): a package's Deno process gets `--allow-read` on
// both its source and this directory, but `--allow-write` only on this
// one - it can never write into its own source tree. Foreshadows step
// 6's real install layout (`data/packages/<id>/<version>/`) without
// needing that step's versioning yet, since nothing is "installed"
// today, only bundled.
export const tier1PackageDataDir = (packageId: string): string => resolve(dataDir, "packages", packageId);

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
