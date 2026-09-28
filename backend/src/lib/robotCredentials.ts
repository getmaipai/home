// ROBOT-DEVICE-01: the rotated SSH credential for a paired robot, one row
// per device (schema.ts's own comment has the encryption rationale). The
// vendor's own published default is a caller-supplied value only, never
// read from or written to this store - only the password this hub itself
// generated survives past the rotation call.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { robotCredentials } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/secrets";

export function storeRobotCredential(deviceId: string, sshUsername: string, password: string): void {
  const now = new Date().toISOString();
  const passwordEncrypted = encryptSecret(password);
  db.insert(robotCredentials)
    .values({ deviceId, sshUsername, passwordEncrypted, rotatedAt: now })
    .onConflictDoUpdate({
      target: robotCredentials.deviceId,
      set: { sshUsername, passwordEncrypted, rotatedAt: now },
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

export function hasRotatedRobotCredential(deviceId: string): boolean {
  return db.select({ deviceId: robotCredentials.deviceId }).from(robotCredentials).where(eq(robotCredentials.deviceId, deviceId)).get() != null;
}

/** Called only from devices.ts's deleteDevice() - this table's device_id
 * references devices with no cascade, same FK shape received_backups had
 * (see that table's own comment in deleteDevice). */
export function deleteRobotCredential(deviceId: string): void {
  db.delete(robotCredentials).where(eq(robotCredentials.deviceId, deviceId)).run();
}
