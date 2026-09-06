// Mirrors spec/schemas/device.schema.json (session-f-platform-and-trust.md
// step 6): a physical device the household has paired, created the
// moment a device token is minted for it (lib/deviceTokens.ts). Not a
// device management feature on its own - just the record shape Wave 3's
// link will pair a robot into, laid now because device tokens and Quick
// Connect both need somewhere to hang a name/kind/area.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices, deviceTokens } from "@/db/schema";
import { newDeviceId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";

export type DeviceKind = "robot" | "pod" | "tv" | "phone" | "desktop" | "browser";

export interface Device {
  id: string;
  kind: DeviceKind;
  name: string;
  area: string | null;
  capabilities: string[];
  personId: string;
  watermarks: Record<string, unknown>;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  hlc: string;
}

function toDevice(row: typeof devices.$inferSelect): Device {
  return {
    id: row.id,
    kind: row.kind as DeviceKind,
    name: row.name,
    area: row.area,
    capabilities: JSON.parse(row.capabilities) as string[],
    personId: row.personId,
    watermarks: JSON.parse(row.watermarks) as Record<string, unknown>,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hlc: row.hlc,
  };
}

/** Creates the Device row a fresh device token points at. Called only
 * from lib/deviceTokens.ts's issueDeviceToken() - there is no standalone
 * "register a device" route; pairing and token issuance are the same
 * moment. */
export function createDevice(kind: DeviceKind, name: string, personId: string): Device {
  const now = new Date().toISOString();
  const row = {
    id: newDeviceId(),
    kind,
    name: name.trim().slice(0, 60) || "A device",
    area: null,
    capabilities: "[]",
    personId,
    watermarks: "{}",
    lastSeenAt: null,
    createdAt: now,
    updatedAt: now,
    hlc: nextHlc(),
  };
  db.insert(devices).values(row).run();
  return toDevice(row);
}

export function touchDevice(id: string): void {
  db.update(devices).set({ lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(devices.id, id)).run();
}

/** Every device paired to `personId` - the "Devices" list under Profile.
 * A device with no live token (its last token expired and was pruned) is
 * still listed until this person or an admin explicitly removes it: a
 * TV that hasn't been used in months should still show up to revoke, not
 * silently vanish. */
export function listDevicesForPerson(personId: string): Device[] {
  return db.select().from(devices).where(eq(devices.personId, personId)).all().map(toDevice);
}

/** Deletes the Device row and every token pointing at it - revoking a
 * device revokes its access, full stop, not just its current token. */
export function deleteDevice(id: string, personId: string): boolean {
  const row = db.select({ personId: devices.personId }).from(devices).where(eq(devices.id, id)).get();
  if (!row || row.personId !== personId) return false;
  db.delete(deviceTokens).where(eq(deviceTokens.deviceId, id)).run();
  db.delete(devices).where(eq(devices.id, id)).run();
  return true;
}
