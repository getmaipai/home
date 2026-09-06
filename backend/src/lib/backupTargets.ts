// Session F, step 8: the `smb` backup target - "a NAS share" (2.5). This
// hub is never an SMB client itself: the admin mounts their NAS share at
// the OS level (Finder's "Connect to Server", Windows' mapped drive,
// Linux's own cifs-utils mount) the same way plan 4.15's NAS mounts for
// storage are "declared with scan paths" rather than dialed by this app.
// A configured target here is just a directory path this hub copies
// already-encrypted archives into and out of - the same trust boundary
// as `local`, one filesystem operation away.
import { eq } from "drizzle-orm";
import { existsSync, statSync } from "node:fs";
import { db } from "@/db";
import { backupTargets } from "@/db/schema";

export type BackupTargetRow = typeof backupTargets.$inferSelect;

const SMB_TARGET_ID = "smb";

export interface SmbTargetConfig {
  path: string;
  enabled: boolean;
}

export function getSmbTarget(): SmbTargetConfig | null {
  const row = db.select().from(backupTargets).where(eq(backupTargets.id, SMB_TARGET_ID)).get();
  if (!row) return null;
  return { path: row.path, enabled: row.enabled };
}

export interface SetSmbTargetResult {
  ok: boolean;
  error?: string;
}

/** Validated against the real filesystem before it's saved: a typo'd or
 * not-yet-mounted path saved blind would silently stop every backup from
 * mirroring, discovered only much later when a household actually needed
 * one. `enabled: false` skips this check - a household pausing a target
 * they know is temporarily unmounted (the NAS is off tonight) shouldn't
 * have to delete and re-type the path to get it back. */
export function setSmbTarget(path: string, enabled: boolean): SetSmbTargetResult {
  const trimmed = path.trim();
  if (!trimmed) return { ok: false, error: "path is required" };
  if (enabled) {
    if (!existsSync(trimmed)) return { ok: false, error: `${trimmed} does not exist - mount the share first` };
    if (!statSync(trimmed).isDirectory()) return { ok: false, error: `${trimmed} is not a directory` };
  }
  const now = new Date().toISOString();
  db.insert(backupTargets)
    .values({ id: SMB_TARGET_ID, path: trimmed, enabled, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: backupTargets.id, set: { path: trimmed, enabled, updatedAt: now } })
    .run();
  return { ok: true };
}

export function removeSmbTarget(): void {
  db.delete(backupTargets).where(eq(backupTargets.id, SMB_TARGET_ID)).run();
}
