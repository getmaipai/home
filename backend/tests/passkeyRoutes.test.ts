import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { db } from "@/db";
import { people, passkeyCredentials } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

async function owner(): Promise<{ client: TestClient; personId: string }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, personId: person.id };
}

describe("POST /api/auth/passkeys/register/options", () => {
  test("requires auth", async () => {
    const anon = new TestClient();
    expect((await anon.post("/api/auth/passkeys/register/options")).status).toBe(401);
  });

  test("returns real WebAuthn creation options for me", async () => {
    const { client } = await owner();
    const res = await client.post("/api/auth/passkeys/register/options");
    expect(res.status).toBe(200);
    const options = (await res.json()) as { rp: { id: string }; challenge: string };
    expect(options.rp.id).toBe("maipai.local");
    expect(typeof options.challenge).toBe("string");
  });
});

describe("GET/DELETE /api/auth/passkeys", () => {
  test("lists and deletes only my own passkeys", async () => {
    const { client, personId } = await owner();
    const now = new Date().toISOString();
    db.insert(passkeyCredentials)
      .values({ id: "cred-1", personId, publicKey: "x", counter: 0, transports: "[]", deviceType: "singleDevice", backedUp: false, name: "iPhone", createdAt: now })
      .run();

    const listRes = await client.get("/api/auth/passkeys");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>;
    expect(list).toEqual([{ id: "cred-1", name: "iPhone", createdAt: now, lastUsedAt: null }]);

    const deleteRes = await client.request("/api/auth/passkeys/cred-1", { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
    expect(await client.get("/api/auth/passkeys").then((r) => r.json())).toEqual([]);
  });

  test("404 deleting a passkey that isn't mine", async () => {
    const { client: ownerClient, personId: ownerPersonId } = await owner();
    const now = new Date().toISOString();
    db.insert(passkeyCredentials)
      .values({ id: "cred-1", personId: ownerPersonId, publicKey: "x", counter: 0, transports: "[]", deviceType: "singleDevice", backedUp: false, name: "Owner's passkey", createdAt: now })
      .run();

    const created = await ownerClient.post("/api/people", { displayName: "Bramble", role: "adult" });
    const other = (await created.json()) as { id: string };
    const attacker = new TestClient();
    await attacker.post("/api/auth/select", { personId: other.id });

    const res = await attacker.request("/api/auth/passkeys/cred-1", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/auth/passkeys/authenticate/options", () => {
  test("404 for an unknown profile", async () => {
    const client = new TestClient();
    const res = await client.post("/api/auth/passkeys/authenticate/options", { personId: "person-doesnotexist" });
    expect(res.status).toBe(404);
  });

  // A code review (2026-09-06) found this route unthrottled - an
  // attacker who knows a victim's personId (from the public
  // GET /api/auth/profiles) could hammer it to keep clobbering their
  // pending challenge (lib/passkeys.ts stores one per personId, one-shot
  // and overwriting), denying that person's own concurrent sign-in.
  test("is rate limited per target personId", async () => {
    const { personId } = await owner();
    let sawTooMany = false;
    for (let i = 0; i < 15; i++) {
      const res = await new TestClient().post("/api/auth/passkeys/authenticate/options", { personId });
      if (res.status === 429) {
        sawTooMany = true;
        break;
      }
    }
    expect(sawTooMany).toBe(true);
  });

  test("returns real WebAuthn request options scoped to that person's own passkeys", async () => {
    const { personId } = await owner();
    const now = new Date().toISOString();
    db.insert(passkeyCredentials)
      .values({ id: "cred-1", personId, publicKey: "x", counter: 0, transports: "[]", deviceType: "singleDevice", backedUp: false, name: "iPhone", createdAt: now })
      .run();

    const client = new TestClient();
    const res = await client.post("/api/auth/passkeys/authenticate/options", { personId });
    expect(res.status).toBe(200);
    const options = (await res.json()) as { allowCredentials: Array<{ id: string }> };
    expect(options.allowCredentials.map((c) => c.id)).toEqual(["cred-1"]);
  });
});

describe("POST /api/auth/passkeys/authenticate/verify", () => {
  test("401 for a malformed/unverifiable response, and no session is set", async () => {
    const { personId } = await owner();
    const client = new TestClient();
    await client.post("/api/auth/passkeys/authenticate/options", { personId });

    const res = await client.post("/api/auth/passkeys/authenticate/verify", { personId, response: { id: "garbage" } });
    expect(res.status).toBe(401);
    expect((await client.get("/api/auth/me")).status).toBe(401);
  });

  // A code review (2026-09-06) found this falling into
  // ensureCredentialRowExists(personId) - which INSERTs a row referencing
  // people.id under a foreign key constraint - before ever checking
  // personId is real, turning a routine "unknown profile" probe into an
  // unhandled 500 instead of a clean 404.
  test("404 (not a crash) for a personId that doesn't exist", async () => {
    const client = new TestClient();
    const res = await client.post("/api/auth/passkeys/authenticate/verify", {
      personId: "person-doesnotexist",
      response: { id: "garbage" },
    });
    expect(res.status).toBe(404);
  });
});
