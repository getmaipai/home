// Backups (platform plan 2.5, split): "integrated, scheduled, secure, on
// every platform." Full 2.5 has real product surface (a Storage page
// showing what a backup contains, an emergency kit at setup printing the
// backup key, restore as onboarding's second screen, `hub`/`smb` targets
// for robots and a NAS, a restore drill wired into the release skill):
// none of that exists yet (shell, chapter 6, hasn't started; no release
// has ever been cut). This is the real backend mechanism underneath: a
// genuine encrypted snapshot, scheduled, retained, and provably
// restorable. Picked as the next slice because the hub has stored real
// family data (people, memories, conversations) for several sessions now
// with zero backup story, a real product gap, and everything it needs
// (the keystore, the scheduler) already exists.
//
// "Built from declarations" (2.5: core and every package declares its own
// persistent store) is deferred: exactly one store exists today (the
// whole hub.db, since Tier 0 packages hold no filesystem state of their
// own beyond calling host.memory.* into the same database), so a
// multi-store declaration registry has nothing real to register yet, the
// same "don't front-load speculative infra" call settings.ts's registry
// made before a second key existed to prove it needed generality.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { backupDir, ensureDataDir } from "@/lib/paths";
import { getOrCreateHexKey } from "@/lib/keystore";
import { randomSuffix } from "@/lib/id";
import { sqlite } from "@/db";

const BACKUP_KEY_NAME = "backup";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const FILE_SUFFIX = ".db.enc";
const SNAPSHOT_PREFIX = ".snapshot-";

// A snapshot is an UNENCRYPTED copy of the whole household database
// (people, memories, conversations), a real plaintext-on-disk exposure
// for the seconds it exists between VACUUM INTO and encryptFile(). A
// review (2026-09-04) pointed out runBackup()'s `finally`-block cleanup
// only runs if the process is alive to run it: a crash, OOM kill, or
// power loss in that window leaves the plaintext file behind
// indefinitely, invisible to listBackups() (it only matches
// `.db.enc`) and to any admin looking at GET /api/backups, a direct
// violation of CLAUDE.md > Credentials and secrets's "a copied database
// must be useless without the key" for exactly the data this feature
// exists to protect. A leftover snapshot is always safe to delete (the
// real data is still in the live hub.db; a snapshot is never the only
// copy of anything): swept here, called both before every backup attempt
// and once at boot (index.ts), so a crash's leftover is cleaned up
// within seconds of the next backup rather than sitting until someone
// happens to look.
export function cleanupStaleSnapshots(): number {
  ensureDataDir(backupDir);
  let removed = 0;
  for (const f of readdirSync(backupDir)) {
    if (f.startsWith(SNAPSHOT_PREFIX)) {
      unlinkSync(join(backupDir, f));
      removed++;
    }
  }
  return removed;
}

/** A safe, consistent snapshot of the live database (2.5: "hot copies
 * live"): SQLite's own `VACUUM INTO`, not a raw file copy of `hub.db`
 * (which could catch a WAL-mode database mid-checkpoint and copy an
 * inconsistent set of pages). A concurrent write mid-backup can never
 * produce a half-written snapshot this way. */
function snapshotToTempFile(): string {
  ensureDataDir(backupDir);
  const tmpPath = join(backupDir, `${SNAPSHOT_PREFIX}${Date.now()}-${randomSuffix(8)}.db`);
  sqlite.query("VACUUM INTO ?").run(tmpPath);
  return tmpPath;
}

// AES-256-GCM, keyed from the keystore, never inside the archive
// (CLAUDE.md > Credentials and secrets; 2.5's own security section says
// the same thing about backups specifically). Format: [12-byte IV][16-byte
// auth tag][ciphertext]. A dedicated "backup" key, not the PIN/password
// pepper: a compromised or rotated pepper must never also invalidate
// every existing backup, and vice versa. Provisional key handling: 2.5's
// real design prints this key as part of an "emergency kit" at setup (a
// wizard screen that doesn't exist, chapter 6); until then it lives in
// the same keystore the pepper does (macOS Keychain / Windows DPAPI / a
// 0600 file), recoverable the same way, just not yet shown to anyone.
function encryptFile(plainPath: string, outPath: string): void {
  const key = Buffer.from(getOrCreateHexKey(BACKUP_KEY_NAME), "hex");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(readFileSync(plainPath)), cipher.final()]);
  writeFileSync(outPath, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
}

function decryptFile(inPath: string, outPath: string): void {
  const key = Buffer.from(getOrCreateHexKey(BACKUP_KEY_NAME), "hex");
  const raw = readFileSync(inPath);
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  // A tampered or corrupted archive fails GCM's tag check right here
  // (2.5: "archives are signed and a tampered one is refused"; GCM's own
  // authentication tag is that check, not a separate signature scheme):
  // decipher.final() throws before any bytes are written to outPath.
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  writeFileSync(outPath, plain, { mode: 0o600 });
}

// Defined in @/wire (alias-free) so a frontend client can import the real
// shape through the @maipai/home-backend workspace dependency, the same
// pattern Roster/TurnValue/ConversationTurnRow/ResolvedSetting already
// use; re-exported here since this is where callers already look for it.
import type { BackupInfo } from "@/wire";
export type { BackupInfo } from "@/wire";

// A random suffix, not just the timestamp: two backups started within the
// same millisecond (a manual "run now" right after a scheduled one, or a
// fast test loop) would otherwise collide on filename and silently
// overwrite each other, quietly losing one backup with no error anywhere.
function backupFilename(now: Date): string {
  return `backup-${now.toISOString().replace(/[:.]/g, "-")}-${randomSuffix(8)}${FILE_SUFFIX}`;
}

function toInfo(filename: string): BackupInfo {
  const stat = statSync(join(backupDir, filename));
  return { filename, createdAt: stat.mtime.toISOString(), bytes: stat.size };
}

/** Every real backup on the `local` target, newest first (2.5's `hub` and
 * `smb` targets don't exist: no robot or NAS integration built yet). */
export function listBackups(): BackupInfo[] {
  ensureDataDir(backupDir);
  return readdirSync(backupDir)
    .filter((f) => f.endsWith(FILE_SUFFIX))
    .map(toInfo)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Runs one real backup: snapshot, encrypt, write to the local target. */
export function runBackup(): BackupInfo {
  cleanupStaleSnapshots();
  const tmpPath = snapshotToTempFile();
  try {
    const filename = backupFilename(new Date());
    encryptFile(tmpPath, join(backupDir, filename));
    return toInfo(filename);
  } finally {
    unlinkSync(tmpPath);
  }
}

/** Decrypts one backup into a fresh, valid SQLite file at `intoPath`.
 * Deliberately not wired to any HTTP route, and never touches the live
 * `data/hub.db`: swapping a running process's live database safely needs
 * the staged verify/backup/migrate/swap/health-check machinery 2.4's
 * updates describe, which doesn't exist yet (no release has ever been
 * cut, so there's no update/rollback path to reuse). This is the real,
 * tested restore primitive underneath that future machinery, proven by
 * actually opening the restored file and querying it (see
 * tests/backup.test.ts), not a placeholder that only claims to work. */
export function restoreBackup(filename: string, intoPath: string): void {
  const inPath = join(backupDir, filename);
  if (!existsSync(inPath)) throw new Error(`no such backup: ${filename}`);
  decryptFile(inPath, intoPath);
}

const DAILY_KEEP = 7;
const WEEKLY_KEEP = 4;
const MONTHLY_KEEP = 3;
const DAY_MS = 86_400_000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function weekKey(d: Date): string {
  // A simple rolling 7-day bucket index from the Unix epoch, not a
  // calendar ISO week: good enough to deduplicate "one backup per
  // 7-day slot," which is all retention needs here, without pulling in
  // a calendar library for ISO week numbers.
  return String(Math.floor(d.getTime() / (7 * DAY_MS)));
}
function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

// 2.5: "retention seven daily, four weekly, three monthly, oldest pruned
// first." A grandfather-father-son scheme, bounded by real, non-
// overlapping time windows, not just bucket counts or a fallback between
// tiers: the daily tier owns only the last 7 days, the weekly tier only
// the 4 weeks immediately after that, the monthly tier only the 3
// (30-day) months after that. A backup's age places it in exactly one
// tier's window (or none, if it's older than all three combined); within
// that tier it's kept only if its own bucket (day/week/month) isn't
// already spent by a newer backup. Two backups taken the same day are
// deliberately NOT allowed to spill the extra one into the weekly tier
// just because that tier's window happens to also cover "today" (an
// earlier version of this function did exactly that with a same-tier-or-
// coarser fallback, caught by tests/backup.test.ts's same-day case): a
// tier represents a distinct time granularity, not an overflow queue for
// same-day duplicates, which get pruned like anything else that loses its
// bucket to a newer backup. No size cap per target yet (2.5 asks for
// one): no settings key exists to declare it, the same "provisional
// until a real key exists" gap `lib/memory.ts`'s decay thresholds
// document for the identical reason.
const DAILY_WINDOW_MS = DAILY_KEEP * DAY_MS;
const WEEKLY_WINDOW_MS = DAILY_WINDOW_MS + WEEKLY_KEEP * 7 * DAY_MS;
const MONTHLY_WINDOW_MS = WEEKLY_WINDOW_MS + MONTHLY_KEEP * 30 * DAY_MS;

export function pruneBackups(): { deleted: number } {
  const all = listBackups();
  const kept = new Set<string>();
  const usedDaily = new Set<string>();
  const usedWeekly = new Set<string>();
  const usedMonthly = new Set<string>();
  const now = Date.now();

  for (const b of all) {
    const created = new Date(b.createdAt);
    const age = now - created.getTime();
    let placed = false;

    if (age < DAILY_WINDOW_MS) {
      const dk = dayKey(created);
      if (!usedDaily.has(dk) && usedDaily.size < DAILY_KEEP) {
        usedDaily.add(dk);
        placed = true;
      }
    } else if (age < WEEKLY_WINDOW_MS) {
      const wk = weekKey(created);
      if (!usedWeekly.has(wk) && usedWeekly.size < WEEKLY_KEEP) {
        usedWeekly.add(wk);
        placed = true;
      }
    } else if (age < MONTHLY_WINDOW_MS) {
      const mk = monthKey(created);
      if (!usedMonthly.has(mk) && usedMonthly.size < MONTHLY_KEEP) {
        usedMonthly.add(mk);
        placed = true;
      }
    }
    if (placed) kept.add(b.filename);
  }

  let deleted = 0;
  for (const b of all) {
    if (!kept.has(b.filename)) {
      unlinkSync(join(backupDir, b.filename));
      deleted++;
    }
  }
  return { deleted };
}
