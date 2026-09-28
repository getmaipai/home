// ROBOT-DEVICE-01: the rotated SSH credential for a paired robot, one row
// per device that was ever paired (schema.ts's own comment has the
// encryption rationale and why the row deliberately outlives its device
// row's own deletion). The vendor's own published default is a
// caller-supplied value only, never read from or written to this store -
// only the password this hub itself generated survives past the
// rotation call.
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { robotCredentials } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/secrets";

export function storeRobotCredential(deviceId: string, host: string, sshUsername: string, password: string): void {
  const now = new Date().toISOString();
  const passwordEncrypted = encryptSecret(password);
  db.insert(robotCredentials)
    .values({ deviceId, host, sshUsername, passwordEncrypted, rotatedAt: now })
    .onConflictDoUpdate({
      target: robotCredentials.deviceId,
      set: { host, sshUsername, passwordEncrypted, rotatedAt: now },
    })
    .run();
}

export interface RobotCredential {
  sshUsername: string;
  password: string;
  rotatedAt: string;
}

export function getRobotCredential(deviceId: string): RobotCredential | null {
  const row = db.select().from(robotCredentials).where(eq(robotCredentials.deviceId, deviceId)).get();
  if (!row) return null;
  return { sshUsername: row.sshUsername, password: decryptSecret(row.passwordEncrypted), rotatedAt: row.rotatedAt };
}

/** A code review (2026-09-27) found re-pairing a revoked-and-rediscovered
 * robot could never complete: its rotated password lived only under the
 * old, now-deleted device row, orphaned the moment that row was gone, so
 * the new pairing's own rotation demanded a vendor default that no
 * longer opened the unit. `host` is the practical "same physical unit"
 * signal available today (schema.ts's own comment has the rest of the
 * reasoning); the most recently rotated credential at that address is
 * what a fresh pairing tries before ever asking the admin for the
 * default. */
export function getMostRecentRobotCredentialForHost(host: string): RobotCredential | null {
  const row = db.select().from(robotCredentials).where(eq(robotCredentials.host, host)).orderBy(desc(robotCredentials.rotatedAt)).get();
  if (!row) return null;
  return { sshUsername: row.sshUsername, password: decryptSecret(row.passwordEncrypted), rotatedAt: row.rotatedAt };
}

export function hasRotatedRobotCredential(deviceId: string): boolean {
  return db.select({ deviceId: robotCredentials.deviceId }).from(robotCredentials).where(eq(robotCredentials.deviceId, deviceId)).get() != null;
}
