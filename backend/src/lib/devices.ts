// Mirrors spec/schemas/device.schema.json (session-f-platform-and-trust.md
// step 6): a physical device the household has paired, created the
// moment a device token is minted for it (lib/deviceTokens.ts). Not a
// device management feature on its own - just the record shape Wave 3's
// link will pair a robot into, laid now because device tokens and Quick
// Connect both need somewhere to hang a name/kind/area.
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { devices, deviceTokens, sessions, memoryRecords, memoryEmbeddings, pendingEmbeddings, pendingMemoryWork } from "@/db/schema";
import { newDeviceId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { deleteReceivedBackupsForDevice } from "@/lib/receivedBackups";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";

export type DeviceKind = "robot" | "pod" | "tv" | "phone" | "desktop" | "browser";

export interface Device {
  id: string;
  kind: DeviceKind;
  name: string;
  area: string | null;
  capabilities: string[];
  offlineScope: string[];
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
    offlineScope: parseOfflineScope(row.offlineScope),
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
export function createDevice(kind: DeviceKind, name: string, personId: string, capabilities: string[] = []): Device {
  const now = new Date().toISOString();
  const cleanName = name.trim().slice(0, 60) || "A device";
  const row = {
    id: newDeviceId(),
    kind,
    name: kind === "robot" ? availableRobotName(cleanName) : cleanName,
    area: null,
    capabilities: JSON.stringify(capabilities),
    personId,
    offlineScope: "[]",
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

/** Any device by id, household-wide - unlike listDevicesForPerson, not scoped
 * to a person: an admin route (ROBOT-DEVICE-01's password rotation, or a
 * future household-wide Devices page) looks a device up this way. */
export function getDeviceById(id: string): Device | null {
  const row = db.select().from(devices).where(eq(devices.id, id)).get();
  return row ? toDevice(row) : null;
}

/** Create a device record before its first token is issued (hosted robots). */
export function createHostedRobot(name: string, personId: string): Device {
  return createDevice("robot", name, personId, ["no_vendor_login"]);
}

/** Update only the admin-editable display fields; undefined leaves a field unchanged. */
export type UpdateDeviceResult =
  | { ok: true; device: Device }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "robot_name_taken"; existingName: string };

export function updateDevice(id: string, input: { name?: string; area?: string | null }): UpdateDeviceResult {
  const current = getDeviceById(id);
  if (!current) return { ok: false, reason: "not_found" };
  if (input.name !== undefined && current.kind === "robot") {
    const taken = findRobotName(input.name, id);
    if (taken) return { ok: false, reason: "robot_name_taken", existingName: taken };
  }
  const changes: Partial<typeof devices.$inferInsert> = { updatedAt: new Date().toISOString(), hlc: nextHlc() };
  if (input.name !== undefined) changes.name = input.name.trim().slice(0, 60);
  if (input.area !== undefined) changes.area = input.area;
  db.update(devices).set(changes).where(eq(devices.id, id)).run();
  const device = getDeviceById(id);
  return device ? { ok: true, device } : { ok: false, reason: "not_found" };
}

/** Robot names are spoken to, so only robot peers participate in uniqueness. */
function findRobotName(name: string, exceptId?: string): string | null {
  const normalized = name.trim().toLowerCase();
  const rows = db.select({ id: devices.id, name: devices.name }).from(devices)
    .where(exceptId ? and(eq(devices.kind, "robot"), ne(devices.id, exceptId)) : eq(devices.kind, "robot"))
    .all();
  return rows.find((row) => row.name.trim().toLowerCase() === normalized)?.name ?? null;
}

function availableRobotName(name: string): string {
  if (!findRobotName(name)) return name;
  for (let number = 2; ; number++) {
    const suffix = ` ${number}`;
    const candidate = `${name.slice(0, 60 - suffix.length).trimEnd()}${suffix}`;
    if (!findRobotName(candidate)) return candidate;
  }
}

/** Every device of one kind, household-wide - unlike listDevicesForPerson,
 * not scoped to whoever paired it. ROBOT-DEVICE-01's password-rotation UI
 * needs this: Quick Connect mints a robot's device under whichever admin
 * approved the pairing, so a different admin still needs to see it to
 * rotate its password. Robots are a household concern the way a personal
 * phone or TV isn't, so this stays kind-scoped rather than a general
 * household-wide device list. */
export function listDevicesByKind(kind: DeviceKind): Device[] {
  return db.select().from(devices).where(eq(devices.kind, kind)).all().map(toDevice);
}

/** Deletes the Device row and every token pointing at it - revoking a
 * device revokes its access, full stop, not just its current token. */
export function deleteDevice(id: string, personId: string): boolean {
  const row = db.select({ personId: devices.personId }).from(devices).where(eq(devices.id, id)).get();
  if (!row || row.personId !== personId) return false;
  db.delete(deviceTokens).where(eq(deviceTokens.deviceId, id)).run();
  // Step 8: received_backups.device_id references this row with no
  // cascade - a code review (2026-09-06) found the delete below throwing
  // a foreign-key violation the moment a device that had ever pushed a
  // backup (POST /api/backups/received) was revoked, since nothing
  // cleared this table first.
  deleteReceivedBackupsForDevice(id);
  // FACE-03: a revoked device's already-issued sessions must not keep
  // authenticating for up to 7 more days (sessions.expiresAt's own TTL) -
  // a real gap for a device whose whole reason to be revoked might be
  // "it's compromised," found while wiring the device-gated biometric
  // sync route. Deleting the rows here isn't enough on its own while the
  // 10s in-memory session cache (middleware/auth.ts) could still hand
  // back a cached hit for one of them - invalidateSessionCacheForPerson()
  // covers that, the same "DB delete alone doesn't propagate fast
  // enough" gap its own doc comment already names for the `enabled` flag.
  db.delete(sessions).where(eq(sessions.deviceId, id)).run();
  // Robot memories are private to this device. Delete explicitly as well
  // as relying on the FK cascade so this remains correct for every DB path.
  // Embedding and pending-work rows reference the record, so they go first.
  const boundIds = db.select({ id: memoryRecords.id }).from(memoryRecords).where(eq(memoryRecords.deviceId, id)).all().map((r) => r.id);
  if (boundIds.length > 0) {
    db.delete(memoryEmbeddings).where(inArray(memoryEmbeddings.memoryId, boundIds)).run();
    db.delete(pendingEmbeddings).where(inArray(pendingEmbeddings.memoryId, boundIds)).run();
    db.delete(pendingMemoryWork).where(inArray(pendingMemoryWork.memoryId, boundIds)).run();
    db.delete(memoryRecords).where(inArray(memoryRecords.id, boundIds)).run();
  }
  invalidateSessionCacheForPerson(personId);
  // robot_credentials.device_id is deliberately NOT a foreign key (a code
  // review, 2026-09-28): a rotated password needs to survive its device
  // row's own deletion so a re-pair of the same physical unit can find
  // it again by host (robotCredentials.ts's own comment has the story).
  // Nothing to clear here - that row staying behind is the whole point.
  db.delete(devices).where(eq(devices.id, id)).run();
  return true;
}

/** Corrupt or unrecognised scope data grants nothing. */
function parseOfflineScope(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((scope) => scope === "media.offline" || scope === "offline.records") ? parsed : [];
  } catch { return []; }
}

export function setDeviceOfflineScope(id: string, scopes: Array<"media.offline" | "offline.records">): void {
  db.update(devices).set({ offlineScope: JSON.stringify([...new Set(scopes)]), updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(devices.id, id)).run();
}

/** Shared surfaces (the robot, a TV, a pod) never keep media: they would read one person's library for everyone in the room. */
export const OFFLINE_NEVER_KINDS: readonly DeviceKind[] = ["robot", "tv", "pod"];
export function mayHoldMediaOffline(device: Pick<Device, "kind">): boolean {
  return !OFFLINE_NEVER_KINDS.includes(device.kind);
}
