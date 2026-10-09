// ADMIN-HOME-SETTINGS-01: People > a child's settings never returns a key
// whose selector is `location` (the weather and maps place lists and
// defaults), for any role. Owner rule 2026-10-08: no one but the person sees
// their places, a child's included. The settings route resolves every key of
// a scope for whoever may read it, so this reads the lib the route calls.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { listValues } from "@/lib/settings";
import { getRegistry } from "@/lib/settingsRegistry";
import { db } from "@/db";
import { people } from "@/db/schema";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

// `location` joins the key selector enum with the places spec tag; until the
// pin carries it the enum type does not name it, so the comparison is on the
// string.
const locationKeys = () => new Set(getRegistry().filter((k) => (k.selector as string) === "location").map((k) => k.key));

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const ids: Record<string, string> = {};
  for (const [name, role, secret] of [
    ["Marlow", "admin", "correcthorse2"],
    ["Rover", "adult", "correcthorse3"],
    ["Wren", "teen", undefined],
    ["Bramble", "child", undefined],
    ["Visitor", "guest", undefined],
  ] as const) {
    const res = await owner.post("/api/people", { displayName: name, role, ...(secret ? { secret } : {}), ...(role === "guest" ? { guestExpiresAt: new Date(Date.now() + 86_400_000).toISOString() } : {}) });
    if (res.status !== 201) throw new Error(`${role}: ${res.status} ${await res.text()}`);
    ids[role] = ((await res.json()) as { id: string }).id;
  }
  const row = (id: string) => db.select().from(people).where(eq(people.id, id)).get()!;
  const ownerRow = db.select().from(people).where(eq(people.role, "owner")).get()!;
  return { ownerRow, row, ids };
}

describe("People > a child's settings and the location selector", () => {
  test.each(["owner", "admin", "adult", "teen", "child", "guest"] as const)("%s reading a child's person scope is never given a location-selector key", async (role) => {
    const { ownerRow, row, ids } = await household();
    const actor = role === "owner" ? ownerRow : row(ids[role]!);
    const result = listValues(actor, `person:${ids.child}`);
    if (!result.ok) {
      // A refusal returns no key at all, which is also "none".
      expect([400, 403]).toContain(result.status);
      return;
    }
    const names = locationKeys();
    expect(result.value.filter((v) => names.has(v.key)).map((v) => v.key)).toEqual([]);
  });

  test("an owner and an admin do read the child's scope, so the check above has something to check", async () => {
    const { ownerRow, row, ids } = await household();
    for (const actor of [ownerRow, row(ids.admin!)]) {
      const result = listValues(actor, `person:${ids.child}`);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.length).toBeGreaterThan(0);
    }
  });
});
