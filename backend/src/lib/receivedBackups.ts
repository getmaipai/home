// Step 8: "hub as the interface a robot will use" (2.5's backup-agent
// targets: local, smb, hub). A paired device (the robot, per its own
// device.schema.json - though nothing here actually checks `kind`, since
// any paired device could conceivably want off-device backup storage)
// pushes its OWN already-encrypted archive here; this hub never holds
// that device's backup key, so a received file is cold storage only -
// never listed alongside, decrypted with, or restorable through this
// hub's own `local`/`smb` backups.
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { receivedBackups } from "@/db/schema";
import { receivedBackupsDir } from "@/lib/paths";
import { newReceivedBackupId } from "@/lib/id";

export interface ReceivedBackupInfo {
  id: string;
  deviceId: string;
  filename: string;
  bytes: number;
  createdAt: string;
}

function toInfo(row: typeof receivedBackups.$inferSelect): ReceivedBackupInfo {
  return { id: row.id, deviceId: row.deviceId, filename: row.filename, bytes: row.bytes, createdAt: row.createdAt };
}

function deviceDir(deviceId: string): string {
  return join(receivedBackupsDir, deviceId);
}

export class ReceivedBackupRefused extends Error {}

/** A device's filename is theirs to pick (their own backup naming
 * scheme, opaque to this hub), so two different devices choosing the
 * identical name must never collide - each gets its own subdirectory,
 * keyed by deviceId rather than trusted filename uniqueness alone.
 *
 * A code review (2026-09-06) found the slash-stripping below insufficient
 * on its own: a filename of exactly ".." (no slash to replace) still
 * resolves via join() to the device directory's PARENT, not a file
 * inside it - writeFileSync then throws an uncaught EISDIR instead of
 * a clean refusal. Checked directly rather than trusting the stripped
 * name alone. */
export function storeReceivedBackup(deviceId: string, filename: string, contents: Buffer): ReceivedBackupInfo {
  const safeFilename = filename.replace(/[/\\]/g, "_");
  if (safeFilename === "" || safeFilename === "." || safeFilename === "..") {
    throw new ReceivedBackupRefused(`not a valid filename: ${filename}`);
  }
  const dir = deviceDir(deviceId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, safeFilename), contents, { mode: 0o600 });
  const now = new Date().toISOString();
  const row = { id: newReceivedBackupId(), deviceId, filename: safeFilename, bytes: contents.byteLength, createdAt: now };
  db.insert(receivedBackups).values(row).run();
  return toInfo(row);
}

export function listReceivedBackups(deviceId?: string): ReceivedBackupInfo[] {
  const rows = db
    .select()
    .from(receivedBackups)
    .where(deviceId ? eq(receivedBackups.deviceId, deviceId) : undefined)
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.map(toInfo);
}

/** Retention is the sending device's own responsibility (it knows its
 * own daily/weekly/monthly scheme the same way this hub's `local` target
 * does for itself) - this hub just deletes whatever archive a device
 * explicitly names for removal, the mirror image of storeReceivedBackup(). */
export function deleteReceivedBackup(deviceId: string, id: string): boolean {
  const row = db.select().from(receivedBackups).where(eq(receivedBackups.id, id)).get();
  if (!row || row.deviceId !== deviceId) return false;
  const path = join(deviceDir(deviceId), row.filename);
  if (existsSync(path)) unlinkSync(path);
  db.delete(receivedBackups).where(eq(receivedBackups.id, id)).run();
  return true;
}

/** Test/ops visibility only: confirms a stored row's file is really on
 * disk and the right size, the same "don't just trust the DB row" the
 * rest of this backup story insists on (lib/backup.ts's own restore path
 * actually opens and queries a restored file rather than assuming a
 * successful decrypt proves it). */
export function receivedBackupFileExists(deviceId: string, filename: string): boolean {
  const path = join(deviceDir(deviceId), filename);
  return existsSync(path) && statSync(path).isFile();
}

/** Called by lib/devices.ts's deleteDevice() and lib/personLifecycle.ts's
 * revokeAllCredentialsAndSessions() before they delete the owning device
 * row - a code review (2026-09-06) found received_backups.device_id's
 * foreign key (`ON DELETE no action`) throwing an uncaught constraint
 * violation on both paths the moment a device that had ever pushed one
 * backup was revoked or its owner deleted, since neither call site
 * cleaned this table up first. Removes the files too, not just the
 * rows: an orphaned archive on disk with no device left to own it is
 * exactly the kind of undead state this whole story tries to avoid. */
export function deleteReceivedBackupsForDevice(deviceId: string): void {
  const dir = deviceDir(deviceId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  db.delete(receivedBackups).where(eq(receivedBackups.deviceId, deviceId)).run();
}
