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
import type { Device } from "@/lib/devices";
import { encryptSecret, decryptSecret } from "@/lib/secrets";

export function storeRobotCredential(deviceId: string, host: string, sshUsername: string, password: string, sshHostKey: string | null = null): void {
  const now = new Date().toISOString();
  const passwordEncrypted = encryptSecret(password);
  db.insert(robotCredentials)
    .values({ deviceId, host, sshHostKey, sshUsername, passwordEncrypted, rotatedAt: now })
    .onConflictDoUpdate({
      target: robotCredentials.deviceId,
      set: { host, sshHostKey, sshUsername, passwordEncrypted, rotatedAt: now },
    })
    .run();
}

export interface RobotCredential {
  sshUsername: string;
  password: string;
  rotatedAt: string;
  sshHostKey: string | null;
}

export function getRobotCredential(deviceId: string): RobotCredential | null {
  const row = db.select().from(robotCredentials).where(eq(robotCredentials.deviceId, deviceId)).get();
  if (!row) return null;
  return { sshUsername: row.sshUsername, password: decryptSecret(row.passwordEncrypted), rotatedAt: row.rotatedAt, sshHostKey: row.sshHostKey };
}

/** Finds a surviving credential only by the robot's verified SSH key. */
export function getRobotCredentialForHostKey(sshHostKey: string): RobotCredential | null {
  const row = db.select().from(robotCredentials).where(eq(robotCredentials.sshHostKey, sshHostKey)).orderBy(desc(robotCredentials.rotatedAt)).get();
  if (!row) return null;
  return { sshUsername: row.sshUsername, password: decryptSecret(row.passwordEncrypted), rotatedAt: row.rotatedAt, sshHostKey: row.sshHostKey };
}

export function hasRotatedRobotCredential(deviceId: string): boolean {
  return db.select({ deviceId: robotCredentials.deviceId }).from(robotCredentials).where(eq(robotCredentials.deviceId, deviceId)).get() != null;
}

/** The redeem gate follows the robot body: only an explicit capability
 * reporting no published vendor login skips password rotation. */
export function robotNeedsPasswordRotation(device: Pick<Device, "kind" | "capabilities">): boolean {
  return device.kind === "robot" && !device.capabilities.includes("no_vendor_login");
}
