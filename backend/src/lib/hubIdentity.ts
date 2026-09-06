// Who this hub is, independent of how you reached it (session-f-platform-
// and-trust.md step 5, ported from the archived legacy hub with its own
// reasoning kept verbatim): a client that keeps several addresses for the
// same server has to be able to tell "the hub, via the LAN IP" from "some
// other machine that happens to answer on 192.168.1.50:3000". Without
// that check, a laptop on a cafe network probes its cached LAN address,
// gets a 200 from a stranger's box, and posts credentials at it. So every
// address a client tries must prove the same instance id before the
// client sends anything real.
//
// Stored in its own single-row table (db/schema.ts's own comment has why
// this isn't the household settings store): `instance_id` is minted once
// and never rotated - rotating it would sign out every device that has
// it cached.
import { db } from "@/db";
import { hubIdentity } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hostname } from "node:os";

const ROW_ID = "hub";

let cached: { instanceId: string; name: string } | null = null;

function loadOrCreate(): { instanceId: string; name: string } {
  if (cached) return cached;
  const row = db.select().from(hubIdentity).where(eq(hubIdentity.id, ROW_ID)).get();
  if (row) {
    cached = { instanceId: row.instanceId, name: row.name };
    return cached;
  }
  const instanceId = crypto.randomUUID();
  const name = defaultHubName();
  db.insert(hubIdentity).values({ id: ROW_ID, instanceId, name, createdAt: new Date().toISOString() }).run();
  cached = { instanceId, name };
  return cached;
}

function defaultHubName(): string {
  return hostname().replace(/\.local$/i, "") || "MaiPai Home";
}

/** Stable id for this install, minted once on first read and never
 * rotated. */
export function getHubInstanceId(): string {
  return loadOrCreate().instanceId;
}

/** Display name clients show while connecting ("Connecting to Basement
 * Hub"). */
export function getHubName(): string {
  return loadOrCreate().name;
}

export function setHubName(name: string): void {
  const trimmed = name.trim().slice(0, 60);
  loadOrCreate(); // ensures the row exists before updating it
  db.update(hubIdentity).set({ name: trimmed }).where(eq(hubIdentity.id, ROW_ID)).run();
  cached = { instanceId: getHubInstanceId(), name: trimmed };
}

/** Test-only: cached is module-local state with no other reset hook, the
 * same shape every other module-level cache in this directory uses. */
export function __resetHubIdentityForTests(): void {
  cached = null;
}
