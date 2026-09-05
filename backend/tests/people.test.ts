import { describe, expect, test, beforeEach } from "bun:test";
import { Person } from "@maipai/spec/gen/ts/person.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { sqlite } from "@/db";
import { remember } from "@/lib/memory";
import { logTurn } from "@/lib/conversationHistory";
import { setValue } from "@/lib/settings";
import { scheduleJob } from "@/lib/scheduler";
import type { PersonRow } from "@/types";

/** The real PersonRow for someone already created through the API, so
 * these tests drive lib functions the same way a request would rather
 * than hand-building a person shape. */
function toPersonRow(id: string): PersonRow {
  return sqlite.query("SELECT * FROM people WHERE id = ?").get(id) as unknown as PersonRow;
}

function countRows(table: string, column: string, value: string): number {
  return (sqlite.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(value) as { n: number }).n;
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", {
    displayName: "Sage",
    secret: "correcthorse",
  });
  expect(res.status).toBe(201);
  return client;
}

describe("creating people", () => {
  test("owner can create any role, including another owner", async () => {
    const owner = await ownerClient();
    for (const role of ["owner", "admin", "adult", "teen", "child", "guest"]) {
      const needsSecret = role === "owner" || role === "admin";
      const res = await owner.post("/api/people", {
        displayName: `Test ${role}`,
        role,
        secret: needsSecret ? "correcthorse2" : undefined,
      });
      expect(res.status).toBe(201);
    }
  });

  test("a created person's roster shape validates against the spec, minus birthdate", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const body = (await res.json()) as Record<string, unknown>;
    // Never returned by this API surface (3.1: birthdate is core-only).
    expect(body.birthdate).toBeUndefined();
    // Filling it back in with null (its schema default) must still satisfy
    // Person, proving nothing else drifted from the spec shape.
    expect(() => Person.parse({ ...body, birthdate: null })).not.toThrow();
  });

  test("admin cannot create another admin or an owner", async () => {
    const owner = await ownerClient();
    const adminRes = await owner.post("/api/people", {
      displayName: "Nova",
      role: "admin",
      secret: "correcthorse2",
    });
    expect(adminRes.status).toBe(201);
    const admin = (await adminRes.json()) as { id: string };

    const adminClient = new TestClient();
    const login = await adminClient.post("/api/auth/verify-secret", {
      personId: admin.id,
      secret: "correcthorse2",
    });
    expect(login.status).toBe(200);

    const tryAdmin = await adminClient.post("/api/people", {
      displayName: "Marlow",
      role: "admin",
      secret: "correcthorse3",
    });
    expect(tryAdmin.status).toBe(403);

    const tryOwner = await adminClient.post("/api/people", {
      displayName: "Marsh",
      role: "owner",
      secret: "correcthorse3",
    });
    expect(tryOwner.status).toBe(403);

    const tryChild = await adminClient.post("/api/people", {
      displayName: "Rover",
      role: "child",
    });
    expect(tryChild.status).toBe(201);
  });

  test("non-admin roles cannot create people at all", async () => {
    const owner = await ownerClient();
    const childRes = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await childRes.json()) as { id: string };

    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });

    const res = await childClient.post("/api/people", { displayName: "Quill", role: "guest" });
    expect(res.status).toBe(403);
  });

  test("an owner or admin profile without a secret is refused", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/people", { displayName: "Nova", role: "admin" });
    expect(res.status).toBe(400);
  });

  test("an invalid role is refused", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/people", { displayName: "Quill", role: "superuser" });
    expect(res.status).toBe(400);
  });

  test("an invalid birthdate is rejected before it reaches the database", async () => {
    // A code review (2026-09-04) found this used to insert an invalid
    // birthdate straight into SQLite (only displayName/secret were
    // checked), which then crashed every later GET /api/people. Proving
    // the 400 here isn't enough on its own; the next test proves the
    // roster survives.
    const owner = await ownerClient();
    const res = await owner.post("/api/people", {
      displayName: "Bramble",
      role: "child",
      birthdate: "09/03/2026",
    });
    expect(res.status).toBe(400);
  });

  test("a rejected candidate never corrupts the roster for later reads", async () => {
    const owner = await ownerClient();
    await owner.post("/api/people", {
      displayName: "Bramble",
      role: "child",
      birthdate: "not-a-date",
    });
    const res = await owner.get("/api/people");
    expect(res.status).toBe(200);
  });
});

describe("listing people", () => {
  test("any signed-in person can see the household roster", async () => {
    const owner = await ownerClient();
    await owner.post("/api/people", { displayName: "Bramble", role: "child" });

    const res = await owner.get("/api/people");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body.every((p) => !("birthdate" in p))).toBe(true);
  });
});

// Helpers for the edit/delete blocks below, in the same shape the tests
// above already use inline (POST /api/people to create, then
// select/verify-secret to act as that person).
async function ownerSession(): Promise<TestClient> {
  return ownerClient();
}

async function addPerson(
  client: TestClient,
  displayName: string,
  role: string,
  secret?: string,
): Promise<{ id: string }> {
  const res = await client.post("/api/people", { displayName, role, secret });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function sessionFor(personId: string, secret?: string): Promise<TestClient> {
  const client = new TestClient();
  if (secret) {
    await client.post("/api/auth/verify-secret", { personId, secret });
  } else {
    await client.post("/api/auth/select", { personId });
  }
  return client;
}

// Editing and deleting a person (2026-09-05). The rules under test are
// the ones that decide whether a household can be taken over, locked
// out, or left holding data it was told had been erased.
describe("PATCH /api/people/:id", () => {
  test("anyone may edit their own name and nickname", async () => {
    const ownerClient = await ownerSession();
    const child = await addPerson(ownerClient, "Bramble", "child");
    const childClient = await sessionFor(child.id);

    const res = await childClient.request(`/api/people/${child.id}`, {
      method: "PATCH",
      body: { displayName: "Bram", nickname: "Bee" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { display_name: string; nickname: string };
    expect(body.display_name).toBe("Bram");
    expect(body.nickname).toBe("Bee");
  });

  test("a child cannot edit somebody else's profile", async () => {
    const ownerClient = await ownerSession();
    const child = await addPerson(ownerClient, "Bramble", "child");
    const other = await addPerson(ownerClient, "Clover", "teen");
    const childClient = await sessionFor(child.id);

    const res = await childClient.request(`/api/people/${other.id}`, {
      method: "PATCH",
      body: { displayName: "Hacked" },
    });
    expect(res.status).toBe(403);
  });

  // The takeover hole, closed at the same ladder POST already uses.
  test("an admin cannot edit another admin or the owner", async () => {
    const ownerClient = await ownerSession();
    const admin = await addPerson(ownerClient, "Marlow", "admin", "adminpin1");
    const admin2 = await addPerson(ownerClient, "Nadia", "admin", "adminpin2");
    const adminClient = await sessionFor(admin.id, "adminpin1");

    expect(
      (await adminClient.request(`/api/people/${admin2.id}`, { method: "PATCH", body: { displayName: "x" } })).status,
    ).toBe(403);
    const ownerId = ((await (await ownerClient.get("/api/auth/me")).json()) as { id: string }).id;
    expect(
      (await adminClient.request(`/api/people/${ownerId}`, { method: "PATCH", body: { displayName: "x" } })).status,
    ).toBe(403);
  });

  test("nobody changes their own role, not even the owner", async () => {
    const ownerClient = await ownerSession();
    const ownerId = ((await (await ownerClient.get("/api/auth/me")).json()) as { id: string }).id;
    const res = await ownerClient.request(`/api/people/${ownerId}`, {
      method: "PATCH",
      body: { role: "child" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/your own role/);
  });

  test("an admin cannot hand out roles at all", async () => {
    const ownerClient = await ownerSession();
    const admin = await addPerson(ownerClient, "Marlow", "admin", "adminpin1");
    const child = await addPerson(ownerClient, "Bramble", "child");
    const adminClient = await sessionFor(admin.id, "adminpin1");

    const res = await adminClient.request(`/api/people/${child.id}`, { method: "PATCH", body: { role: "adult" } });
    expect(res.status).toBe(403);
  });

  // POST already refuses to create a PIN-free owner or admin ("a
  // one-request takeover for anyone who can reach the API"). Promotion
  // has to honour the same rule or it is only enforced on one path.
  test("nobody is promoted to admin or owner without a PIN", async () => {
    const ownerClient = await ownerSession();
    const child = await addPerson(ownerClient, "Bramble", "child");

    const res = await ownerClient.request(`/api/people/${child.id}`, { method: "PATCH", body: { role: "admin" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/PIN or password/);
  });

  test("the owner may promote someone who does have a PIN", async () => {
    const ownerClient = await ownerSession();
    const adult = await addPerson(ownerClient, "Marlow", "adult", "theirpin1");

    const res = await ownerClient.request(`/api/people/${adult.id}`, { method: "PATCH", body: { role: "admin" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { role: string }).role).toBe("admin");
  });

  // A whole request is refused, not half-applied: the name must not
  // change just because it was sent alongside a role that was rejected.
  test("a rejected role change does not quietly apply the rest of the edit", async () => {
    const ownerClient = await ownerSession();
    const child = await addPerson(ownerClient, "Bramble", "child");

    await ownerClient.request(`/api/people/${child.id}`, {
      method: "PATCH",
      body: { displayName: "Renamed", role: "admin" },
    });

    const roster = (await (await ownerClient.get("/api/people")).json()) as Array<{ id: string; display_name: string }>;
    expect(roster.find((p) => p.id === child.id)?.display_name).toBe("Bramble");
  });

  test("an invalid birthdate is refused rather than written", async () => {
    const ownerClient = await ownerSession();
    const child = await addPerson(ownerClient, "Bramble", "child");

    const res = await ownerClient.request(`/api/people/${child.id}`, {
      method: "PATCH",
      body: { birthdate: "not-a-date" },
    });
    expect(res.status).toBe(400);
    // The roster still loads, which is the real regression this guards:
    // a bad row used to crash every later GET, not just its own write.
    expect((await ownerClient.get("/api/people")).status).toBe(200);
  });
});

describe("DELETE /api/people/:id", () => {
  test("an owner can delete a child, and they leave the roster", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");

    const res = await owner.request(`/api/people/${child.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const roster = (await (await owner.get("/api/people")).json()) as Array<{ id: string }>;
    expect(roster.some((p) => p.id === child.id)).toBe(false);
  });

  test("a child cannot delete anyone at all", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    const other = await addPerson(owner, "Clover", "teen");
    const childClient = await sessionFor(child.id);

    expect((await childClient.request(`/api/people/${other.id}`, { method: "DELETE" })).status).toBe(403);
  });

  test("an admin cannot delete another admin or the owner", async () => {
    const owner = await ownerSession();
    const admin = await addPerson(owner, "Marlow", "admin", "adminpin1");
    const admin2 = await addPerson(owner, "Nadia", "admin", "adminpin2");
    const ownerId = ((await (await owner.get("/api/auth/me")).json()) as { id: string }).id;
    const adminClient = await sessionFor(admin.id, "adminpin1");

    expect((await adminClient.request(`/api/people/${admin2.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await adminClient.request(`/api/people/${ownerId}`, { method: "DELETE" })).status).toBe(403);
  });

  test("nobody deletes their own profile", async () => {
    const owner = await ownerSession();
    const ownerId = ((await (await owner.get("/api/auth/me")).json()) as { id: string }).id;

    const res = await owner.request(`/api/people/${ownerId}`, { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/your own profile/);
  });

  // A household with no owner has nobody who can promote anyone, which
  // cannot be recovered from through the UI.
  test("the household's only owner cannot be deleted", async () => {
    const owner = await ownerSession();
    const secondOwner = await addPerson(owner, "Marlow", "owner", "ownerpin2");
    const ownerId = ((await (await owner.get("/api/auth/me")).json()) as { id: string }).id;
    const secondClient = await sessionFor(secondOwner.id, "ownerpin2");

    // Two owners: deleting one is fine.
    expect((await secondClient.request(`/api/people/${ownerId}`, { method: "DELETE" })).status).toBe(200);
    // One left: they cannot be deleted, by anyone.
    const admin = await addPerson(secondClient, "Nadia", "admin", "adminpin3");
    const adminClient = await sessionFor(admin.id, "adminpin3");
    const res = await adminClient.request(`/api/people/${secondOwner.id}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  test("a deleted person cannot sign in again", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    await owner.request(`/api/people/${child.id}`, { method: "DELETE" });

    const profiles = (await (await new TestClient().get("/api/auth/profiles")).json()) as Array<{ id: string }>;
    expect(profiles.some((p) => p.id === child.id)).toBe(false);
  });
});

// The erasure itself. These are the tests that make "deleted" mean
// deleted rather than "hidden from one list".
describe("deleting a person erases what the household held about them", () => {
  test("their memories, conversations, settings and jobs are really gone", async () => {
    const owner = await ownerSession();
    const person = await addPerson(owner, "Bramble", "teen", "theirpin1");
    const client = await sessionFor(person.id, "theirpin1");

    // Real data through the real paths, not rows poked into tables.
    remember(toPersonRow(person.id), {
      text: "Bramble likes trains",
      category: "preference",
      tier: "durable",
      scope: "person",
      person: person.id,
      source: "hub",
      importance: 0.5,
    });
    logTurn(toPersonRow(person.id), "chat", "hello", {
      reply: { text: "hi" },
      source: "model",
      safety: {
        flagged: false,
        categories: [],
        action: "allow",
        notify_parent: false,
        matched_signals: [],
        checked_at: new Date().toISOString(),
      },
    });
    setValue(toPersonRow(person.id), `person:${person.id}`, "tts.voice_id", "alba");
    scheduleJob(toPersonRow(person.id), "joke", "tell", "every:1d", {});
    expect((await client.get("/api/auth/me")).status).toBe(200);

    const res = await owner.request(`/api/people/${person.id}`, { method: "DELETE" });
    const { erased } = (await res.json()) as { erased: Record<string, number> };
    expect(erased.memories).toBeGreaterThan(0);
    expect(erased.conversations).toBeGreaterThan(0);
    expect(erased.settings).toBeGreaterThan(0);
    expect(erased.scheduledJobs).toBeGreaterThan(0);

    expect(countRows("memory_records", "person", person.id)).toBe(0);
    expect(countRows("conversation_turns", "person_id", person.id)).toBe(0);
    expect(countRows("settings_values", "scope", `person:${person.id}`)).toBe(0);
    expect(countRows("scheduled_jobs", "person_id", person.id)).toBe(0);
    expect(countRows("person_credentials", "person_id", person.id)).toBe(0);
  });

  // Their session dies with them: a deleted person holding a live cookie
  // would keep making requests as somebody the household removed.
  test("their signed-in session stops working immediately", async () => {
    const owner = await ownerSession();
    const person = await addPerson(owner, "Bramble", "teen", "theirpin1");
    const client = await sessionFor(person.id, "theirpin1");
    expect((await client.get("/api/auth/me")).status).toBe(200);

    await owner.request(`/api/people/${person.id}`, { method: "DELETE" });
    expect((await client.get("/api/auth/me")).status).toBe(401);
  });

  // The tombstone, and why it is kept: a row that simply vanishes is
  // indistinguishable to a robot syncing later from one it has not been
  // told about yet, so the delete would undo itself on the next sync.
  // What is kept is the fact of the person, not their details.
  test("the tombstone keeps who it was but not their nickname or birthdate", async () => {
    const owner = await ownerSession();
    const person = await addPerson(owner, "Bramble", "child");
    await owner.request(`/api/people/${person.id}`, {
      method: "PATCH",
      body: { nickname: "Bee", birthdate: "2015-04-02" },
    });

    await owner.request(`/api/people/${person.id}`, { method: "DELETE" });

    const row = sqlite.query("SELECT * FROM people WHERE id = ?").get(person.id) as {
      display_name: string;
      nickname: string | null;
      birthdate: string | null;
      deleted_at: string | null;
    };
    expect(row.deleted_at).not.toBeNull();
    expect(row.display_name).toBe("Bramble");
    expect(row.nickname).toBeNull();
    expect(row.birthdate).toBeNull();
  });

  // The test that keeps this honest as the schema grows: every table
  // holding a column that points at a person has to be handled by
  // erasePersonData, or a delete quietly stops being a delete.
  test("no table is left holding rows about a deleted person", async () => {
    const owner = await ownerSession();
    const person = await addPerson(owner, "Bramble", "teen", "theirpin1");
    await sessionFor(person.id, "theirpin1");
    remember(toPersonRow(person.id), {
      text: "Bramble likes trains",
      category: "preference",
      tier: "durable",
      scope: "person",
      person: person.id,
      source: "hub",
      importance: 0.5,
    });
    setValue(toPersonRow(person.id), `person:${person.id}`, "tts.voice_id", "alba");

    await owner.request(`/api/people/${person.id}`, { method: "DELETE" });

    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    for (const { name } of tables) {
      // `people` itself holds the tombstone on purpose.
      if (name === "people" || name.startsWith("__drizzle")) continue;
      const columns = sqlite.query(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
      for (const col of columns) {
        const isPersonColumn = col.name === "person_id" || col.name === "person" || col.name === "creator_id";
        const isScopeColumn = col.name === "scope";
        if (!isPersonColumn && !isScopeColumn) continue;
        const needle = isScopeColumn ? `person:${person.id}` : person.id;
        const left = (
          sqlite.query(`SELECT COUNT(*) AS n FROM ${name} WHERE ${col.name} = ?`).get(needle) as { n: number }
        ).n;
        expect(left, `${name}.${col.name} still holds rows for a deleted person`).toBe(0);
      }
    }
  });
});

// The cached-role case auth.ts's invalidateSessionCacheForPerson was
// written for, and which nothing called until now: a session caches the
// whole PersonRow, so a demotion that does not evict it leaves the
// demoted person acting with their old role until the cache expires.
describe("a role change takes effect immediately", () => {
  test("a demoted admin loses admin access on their very next request", async () => {
    const owner = await ownerSession();
    const admin = await addPerson(owner, "Marlow", "admin", "adminpin1");
    const adminClient = await sessionFor(admin.id, "adminpin1");
    expect((await adminClient.get("/api/backups")).status).toBe(200);

    await owner.request(`/api/people/${admin.id}`, { method: "PATCH", body: { role: "adult" } });

    expect((await adminClient.get("/api/backups")).status).toBe(403);
  });
});

// Batch delete (docs/UI.md > Batch actions, added 2026-09-05 at Jesse's
// request: every list of things a household can delete offers a
// multi-select).
describe("POST /api/people/batch-delete", () => {
  test("deletes everyone selected, and erases each one's data", async () => {
    const owner = await ownerSession();
    const a = await addPerson(owner, "Bramble", "child");
    const b = await addPerson(owner, "Clover", "teen");
    remember(toPersonRow(a.id), {
      text: "Bramble likes trains",
      category: "preference",
      tier: "durable",
      scope: "person",
      person: a.id,
      source: "hub",
      importance: 0.5,
    });

    const res = await owner.post("/api/people/batch-delete", { ids: [a.id, b.id] });
    expect(res.status).toBe(200);
    const { outcomes } = (await res.json()) as { outcomes: Array<{ id: string; deleted: boolean }> };
    expect(outcomes.every((o) => o.deleted)).toBe(true);

    const roster = (await (await owner.get("/api/people")).json()) as Array<{ id: string }>;
    expect(roster.some((p) => p.id === a.id || p.id === b.id)).toBe(false);
    expect(countRows("memory_records", "person", a.id)).toBe(0);
  });

  // Partial success: one refusal must not take the whole batch down with
  // it, or a family selecting five people and hitting one protected
  // profile gets nothing done and no idea why.
  test("deletes what it can and says why it left the rest alone", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    const ownerId = ((await (await owner.get("/api/auth/me")).json()) as { id: string }).id;

    const res = await owner.post("/api/people/batch-delete", { ids: [child.id, ownerId] });
    const { outcomes } = (await res.json()) as {
      outcomes: Array<{ id: string; deleted: boolean; reason?: string }>;
    };
    expect(outcomes.find((o) => o.id === child.id)?.deleted).toBe(true);
    const refused = outcomes.find((o) => o.id === ownerId);
    expect(refused?.deleted).toBe(false);
    expect(refused?.reason).toMatch(/your own profile/);
  });

  test("every person in a batch is held to the same rules as a single delete", async () => {
    const owner = await ownerSession();
    const admin = await addPerson(owner, "Marlow", "admin", "adminpin1");
    const admin2 = await addPerson(owner, "Nadia", "admin", "adminpin2");
    const child = await addPerson(owner, "Bramble", "child");
    const adminClient = await sessionFor(admin.id, "adminpin1");

    const res = await adminClient.post("/api/people/batch-delete", { ids: [child.id, admin2.id] });
    const { outcomes } = (await res.json()) as {
      outcomes: Array<{ id: string; deleted: boolean; reason?: string }>;
    };
    expect(outcomes.find((o) => o.id === child.id)?.deleted).toBe(true);
    // An admin may not delete a peer here either.
    expect(outcomes.find((o) => o.id === admin2.id)?.deleted).toBe(false);
  });

  test("refuses a request that selected nobody, or that is not a list of ids", async () => {
    const owner = await ownerSession();
    expect((await owner.post("/api/people/batch-delete", { ids: [] })).status).toBe(400);
    expect((await owner.post("/api/people/batch-delete", { ids: "everyone" })).status).toBe(400);
    expect((await owner.post("/api/people/batch-delete", {})).status).toBe(400);
  });

  test("a child cannot batch-delete anyone", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    const other = await addPerson(owner, "Clover", "teen");
    const childClient = await sessionFor(child.id);

    expect((await childClient.post("/api/people/batch-delete", { ids: [other.id] })).status).toBe(403);
  });
});
