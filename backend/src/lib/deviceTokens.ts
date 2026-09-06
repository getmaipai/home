// Per-device credentials that outlive a change of address. Ported from
// the archived legacy hub's lib/deviceToken.ts (principle 8: hard-won
// logic, reused), adapted to this repo's synchronous drizzle/bun:sqlite
// pattern and to the new devices table (legacy stored label/platform
// inline on the token; here they live on the Device row lib/devices.ts
// owns, since a device token and its Device are the same pairing moment
// and this platform's own Device record needs to exist regardless).
//
// The session cookie is scoped to one origin. A native client that fails
// over from https://hub.example.com to http://192.168.1.50:8787 lands on
// an empty cookie jar and looks signed out, which turns "the network
// changed" into "everyone has to sign in again". So a native client
// keeps a long-lived device token in its own OS keystore and trades it
// for a session cookie on whichever address answered (POST
// /api/auth/devices/redeem, routes/devices.ts) - a token minted by THIS
// hub instance only, refused by any other (bound to the instance id via
// the hub's own device row, not stored separately here since the token
// hash itself is only ever valid against this hub's own database).
import { randomBytes, createHash } from "node:crypto";
import { eq, lt, asc } from "drizzle-orm";
import { db } from "@/db";
import { deviceTokens } from "@/db/schema";
import { newDeviceTokenId } from "@/lib/id";
import { createDevice, touchDevice, type DeviceKind } from "@/lib/devices";

const TTL_MS = 365 * 24 * 60 * 60 * 1000; // a year - a family TV should not be re-paired quarterly
const MAX_PER_PERSON = 20;

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Bounds the per-person token set: a client stuck in a re-pair loop
 * cannot grow the table without limit. Oldest first, never the row about
 * to be inserted (that happens after this runs). */
function pruneOldestIfOverLimit(personId: string): void {
  const existing = db
    .select({ id: deviceTokens.id, personId: deviceTokens.personId })
    .from(deviceTokens)
    .where(eq(deviceTokens.personId, personId))
    .orderBy(asc(deviceTokens.createdAt))
    .all();
  if (existing.length < MAX_PER_PERSON) return;
  const overflow = existing.slice(0, existing.length - MAX_PER_PERSON + 1);
  for (const row of overflow) db.delete(deviceTokens).where(eq(deviceTokens.id, row.id)).run();
}

/** Mints a device token AND the Device row it points at - pairing and
 * token issuance are the same moment (there is no standalone "register a
 * device" step). The raw token is returned exactly once; only its hash
 * is ever stored. */
export function issueDeviceToken(
  personId: string,
  kind: DeviceKind,
  label: string,
): { token: string; deviceId: string; expiresAt: string } {
  pruneExpiredDeviceTokens();
  pruneOldestIfOverLimit(personId);

  const device = createDevice(kind, label, personId);
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  db.insert(deviceTokens)
    .values({
      id: newDeviceTokenId(),
      deviceId: device.id,
      personId,
      tokenHash: hashDeviceToken(token),
      expiresAt,
      lastSeenAt: null,
      lastSeenUrl: null,
      createdAt: new Date().toISOString(),
    })
    .run();
  return { token, deviceId: device.id, expiresAt };
}

/** Resolves a device token to its person, stamping where it came in from
 * on both the token and its Device row. Null for unknown or expired
 * tokens - the client's cue to walk the person through pairing again
 * (Quick Connect or a fresh passkey sign-in), never a silent retry. */
export function redeemDeviceToken(token: string, seenUrl: string | null): { personId: string; deviceId: string } | null {
  const tokenHash = hashDeviceToken(token);
  const row = db.select().from(deviceTokens).where(eq(deviceTokens.tokenHash, tokenHash)).get();
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.delete(deviceTokens).where(eq(deviceTokens.id, row.id)).run();
    return null;
  }
  db.update(deviceTokens)
    .set({ lastSeenAt: new Date().toISOString(), lastSeenUrl: seenUrl })
    .where(eq(deviceTokens.id, row.id))
    .run();
  touchDevice(row.deviceId);
  return { personId: row.personId, deviceId: row.deviceId };
}

export function pruneExpiredDeviceTokens(): void {
  db.delete(deviceTokens).where(lt(deviceTokens.expiresAt, new Date().toISOString())).run();
}
