import { describe, expect, test, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { Person } from "@maipai/spec/gen/ts/person.js";
import { app } from "@/app";
import { db } from "@/db";
import { people } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __clearSessionCacheForTests } from "@/middleware/auth";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function setUpOwner(client: TestClient, displayName = "Sage", secret = "correcthorse") {
  const res = await client.post("/api/auth/setup", { displayName, secret });
  expect(res.status).toBe(201);
  return (await res.json()) as { person: Record<string, unknown> };
}

describe("setup (first-run owner creation)", () => {
  test("creates the owner and signs them in", async () => {
    const client = new TestClient();
    const { person } = await setUpOwner(client);
    expect(person.role).toBe("owner");

    // The row this endpoint hands back must actually be a valid Person per
    // home/spec/schemas/person.schema.json: "shared record changes go
    // through the spec first" means the API's shape can't quietly drift
    // from it.
    expect(() => Person.parse(person)).not.toThrow();

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { id: unknown; hasSecret: boolean };
    expect(meBody.id).toBe(person.id);
    expect(meBody.hasSecret).toBe(true);
  });

  test("refuses a second setup once a person exists", async () => {
    const client = new TestClient();
    await setUpOwner(client);
    const second = await client.post("/api/auth/setup", {
      displayName: "Nova",
      secret: "whatever123",
    });
    expect(second.status).toBe(409);
  });

  test("rejects a too-short secret", async () => {
    const client = new TestClient();
    const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "abc" });
    expect(res.status).toBe(400);
  });
});

describe("profiles picker", () => {
  test("lists people without ever exposing a secret hash", async () => {
    const client = new TestClient();
    await setUpOwner(client);
    const res = await app.request("/api/auth/profiles");
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]!.hasSecret).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secretHash");
    expect(JSON.stringify(body)).not.toContain("correcthorse");
  });
});

describe("verify-secret and lockout", () => {
  test("signs in with the correct secret", async () => {
    const setupClient = new TestClient();
    const { person } = await setUpOwner(setupClient);

    const client = new TestClient();
    const res = await client.post("/api/auth/verify-secret", {
      personId: person.id,
      secret: "correcthorse",
    });
    expect(res.status).toBe(200);
    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(200);
  });

  test("rejects a wrong secret and counts the attempt down", async () => {
    const setupClient = new TestClient();
    const { person } = await setUpOwner(setupClient);

    const client = new TestClient();
    const res = await client.post("/api/auth/verify-secret", {
      personId: person.id,
      secret: "wrong",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { attemptsLeft: number };
    expect(body.attemptsLeft).toBe(4);
  });

  test("locks the profile out after five wrong attempts, even with the right secret", async () => {
    const setupClient = new TestClient();
    const { person } = await setUpOwner(setupClient);

    for (let i = 0; i < 5; i++) {
      const client = new TestClient();
      const res = await client.post("/api/auth/verify-secret", {
        personId: person.id,
        secret: "wrong",
      });
      expect(res.status).toBe(401);
    }

    const client = new TestClient();
    const locked = await client.post("/api/auth/verify-secret", {
      personId: person.id,
      secret: "correcthorse",
    });
    expect(locked.status).toBe(429);
  });
});

describe("select (secret-free profile switch)", () => {
  test("signs in a secret-free profile with a bare tap", async () => {
    const owner = new TestClient();
    await setUpOwner(owner);
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    expect(created.status).toBe(201);
    const child = (await created.json()) as { id: string };

    const client = new TestClient();
    const res = await client.post("/api/auth/select", { personId: child.id });
    expect(res.status).toBe(200);
    const me = await client.get("/api/auth/me");
    const meBody = (await me.json()) as { role: string };
    expect(meBody.role).toBe("child");
  });

  test("refuses select for a profile that has a secret", async () => {
    const owner = new TestClient();
    const { person } = await setUpOwner(owner);

    const client = new TestClient();
    const res = await client.post("/api/auth/select", { personId: person.id });
    expect(res.status).toBe(400);
  });
});

describe("logout", () => {
  test("ends the session", async () => {
    const client = new TestClient();
    await setUpOwner(client);
    const logout = await client.post("/api/auth/logout");
    expect(logout.status).toBe(200);
    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(401);
  });

  test("is refused across origins (CSRF)", async () => {
    const client = new TestClient();
    await setUpOwner(client);
    const res = await client.post("/api/auth/logout", undefined, {
      origin: "https://evil.example",
      host: "hub.local",
    });
    expect(res.status).toBe(403);
    // the session must survive the blocked attempt
    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(200);
  });
});

describe("unauthenticated access", () => {
  test("/api/auth/me requires a session", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  test("/api/people requires a session", async () => {
    const res = await app.request("/api/people");
    expect(res.status).toBe(401);
  });
});

// No route soft-deletes a person yet (delete-person is deferred, see
// docs/dev.md), so these tests set deletedAt directly, the same way
// tests/memory.test.ts backdates timestamps to test maintenance. A code
// review (2026-09-04) found both /verify-secret and an existing session's
// resolution never checked this.
describe("soft-deleted people cannot authenticate", () => {
  test("verify-secret refuses a soft-deleted profile even with the correct secret", async () => {
    const setupClient = new TestClient();
    const { person } = await setUpOwner(setupClient);
    db.update(people)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(people.id, person.id as string))
      .run();

    const client = new TestClient();
    const res = await client.post("/api/auth/verify-secret", {
      personId: person.id,
      secret: "correcthorse",
    });
    expect(res.status).toBe(404);
  });

  test("an existing session stops authenticating once the person is soft-deleted", async () => {
    const client = new TestClient();
    const { person } = await setUpOwner(client);
    const meBefore = await client.get("/api/auth/me");
    expect(meBefore.status).toBe(200);

    db.update(people)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(people.id, person.id as string))
      .run();
    // The 10s session cache (documented in middleware/auth.ts) bounds how
    // fast a DB-side deletion propagates to an already-cached session,
    // same as any other profile edit; clear it here to test the read
    // path itself rather than waiting out the TTL in a test.
    __clearSessionCacheForTests();

    const meAfter = await client.get("/api/auth/me");
    expect(meAfter.status).toBe(401);
  });
});

describe("forwarded-header trust (only behind TRUST_PROXY)", () => {
  test("X-Forwarded-Host does not widen the CSRF allowlist when not trusting a proxy", async () => {
    const client = new TestClient();
    await setUpOwner(client);
    const res = await client.post("/api/auth/logout", undefined, {
      origin: "https://evil.example",
      host: "hub.local",
      "x-forwarded-host": "evil.example",
    });
    expect(res.status).toBe(403);
  });

  test("X-Forwarded-Proto does not flip the Secure cookie flag when not trusting a proxy", async () => {
    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ displayName: "Sage", secret: "correcthorse" }),
    });
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie") ?? "";
    // The real connection in this test harness is plain http, so Secure
    // must NOT be set even though a spoofed X-Forwarded-Proto: https was sent.
    expect(setCookie.toLowerCase()).not.toContain("secure");
  });
});

describe("change-secret (self-service PIN/password change)", () => {
  test("changes a PIN with the correct current one, and the new one signs in afterward", async () => {
    const owner = new TestClient();
    const { person } = await setUpOwner(owner);

    const res = await owner.post("/api/auth/change-secret", {
      currentSecret: "correcthorse",
      newSecret: "newpassword123",
    });
    expect(res.status).toBe(200);

    const fresh = new TestClient();
    const signedIn = await fresh.post("/api/auth/verify-secret", {
      personId: person.id,
      secret: "newpassword123",
    });
    expect(signedIn.status).toBe(200);

    // The old secret must no longer work.
    const staleClient = new TestClient();
    const stale = await staleClient.post("/api/auth/verify-secret", {
      personId: person.id,
      secret: "correcthorse",
    });
    expect(stale.status).toBe(401);
  });

  test("rejects a wrong current secret and counts the attempt down, same as verify-secret", async () => {
    const owner = new TestClient();
    await setUpOwner(owner);

    const res = await owner.post("/api/auth/change-secret", {
      currentSecret: "wrong",
      newSecret: "newpassword123",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { attemptsLeft: number };
    expect(body.attemptsLeft).toBe(4);
  });

  test("requires currentSecret when a credential already exists", async () => {
    const owner = new TestClient();
    await setUpOwner(owner);

    const res = await owner.post("/api/auth/change-secret", { newSecret: "newpassword123" });
    expect(res.status).toBe(400);
  });

  test("rejects a too-short new secret before touching the current one", async () => {
    const owner = new TestClient();
    await setUpOwner(owner);

    const res = await owner.post("/api/auth/change-secret", {
      currentSecret: "correcthorse",
      newSecret: "ab",
    });
    expect(res.status).toBe(400);
  });

  test("a PIN-free profile can set one for the first time with no currentSecret", async () => {
    const owner = new TestClient();
    await setUpOwner(owner);
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };

    const childClient = new TestClient();
    const selected = await childClient.post("/api/auth/select", { personId: child.id });
    expect(selected.status).toBe(200);

    const res = await childClient.post("/api/auth/change-secret", { newSecret: "kidpassword1" });
    expect(res.status).toBe(200);

    const fresh = new TestClient();
    const signedIn = await fresh.post("/api/auth/verify-secret", {
      personId: child.id,
      secret: "kidpassword1",
    });
    expect(signedIn.status).toBe(200);
  });

  // Real bug, code review 2026-09-04: personCredentials.personId is the
  // primary key, and the original version branched on a SELECT to decide
  // INSERT vs UPDATE - two concurrent requests for a PIN-free profile
  // could both see no record and both attempt an INSERT, the second
  // throwing a primary-key violation instead of the intended idempotent
  // "set the PIN" outcome. Fixed with a single atomic upsert
  // (onConflictDoUpdate); this proves both concurrent requests succeed.
  test("two concurrent first-time sets for the same PIN-free profile do not race", async () => {
    const owner = new TestClient();
    await setUpOwner(owner);
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };

    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });

    const [first, second] = await Promise.all([
      childClient.post("/api/auth/change-secret", { newSecret: "kidpassword1" }),
      childClient.post("/api/auth/change-secret", { newSecret: "kidpassword2" }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // Whichever write landed last, exactly one of the two secrets works -
    // not both, and not neither.
    const triedFirst = await new TestClient().post("/api/auth/verify-secret", {
      personId: child.id,
      secret: "kidpassword1",
    });
    const triedSecond = await new TestClient().post("/api/auth/verify-secret", {
      personId: child.id,
      secret: "kidpassword2",
    });
    expect([triedFirst.status, triedSecond.status].sort()).toEqual([200, 401]);
  });

  test("locks out after five wrong current-secret attempts, even with the right new one", async () => {
    // Unlike verify-secret's own lockout test, every attempt here has to
    // come from the SAME authenticated client: change-secret requires
    // requireAuth, so this is the realistic threat it defends against - a
    // stolen, already-signed-in session cookie repeatedly guessing the
    // real PIN, not an anonymous attacker who was never signed in at all.
    const owner = new TestClient();
    await setUpOwner(owner);

    for (let i = 0; i < 5; i++) {
      const res = await owner.post("/api/auth/change-secret", {
        currentSecret: "wrong",
        newSecret: "newpassword123",
      });
      expect(res.status).toBe(401);
    }

    const locked = await owner.post("/api/auth/change-secret", {
      currentSecret: "correcthorse",
      newSecret: "newpassword123",
    });
    expect(locked.status).toBe(429);
  });
});
