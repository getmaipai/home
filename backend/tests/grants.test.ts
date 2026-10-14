import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { grantActionClassificationIsComplete } from "@/lib/grants";

beforeEach(() => resetDb());

test("every catalog grant action has exactly one authority classification", () => {
  expect(grantActionClassificationIsComplete()).toBe(true);
});

async function ownerSession(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

async function makeAdult(owner: TestClient, name: string): Promise<{ id: string; client: TestClient }> {
  // Issues #35/#47 made a secret required for role: "adult" (owner/admin
  // already needed one) - a secret-holding profile also stops being a
  // bare-/select profile, so sign in via verify-secret instead.
  const res = await owner.post("/api/people", { displayName: name, role: "adult", secret: "0000" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  return { id, client };
}

async function makeAdmin(owner: TestClient, name: string): Promise<{ id: string; client: TestClient }> {
  const res = await owner.post("/api/people", { displayName: name, role: "admin", secret: "0000" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  return { id, client };
}

describe("POST /api/grants", () => {
  test("an admin cannot grant backups.restore to themselves or another person", async () => {
    const owner = await ownerSession();
    const admin = await makeAdmin(owner, "Marlow");
    const other = await makeAdult(owner, "Iris");

    for (const person of [admin.id, other.id]) {
      const res = await admin.client.post("/api/grants", { person, action: "backups.restore", effect: "allow" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "You can't give someone a permission you don't have. Ask the owner to grant it." });
    }
    expect((await owner.get("/api/grants")).status).toBe(200);
    expect(((await (await owner.get(`/api/grants?person=${admin.id}`)).json()) as unknown[])).toHaveLength(0);
    expect(((await (await owner.get(`/api/grants?person=${other.id}`)).json()) as unknown[])).toHaveLength(0);
  });

  test("an owner can grant backups.restore", async () => {
    const owner = await ownerSession();
    const { id } = await makeAdult(owner, "Marlow");
    const res = await owner.post("/api/grants", { person: id, action: "backups.restore", effect: "allow" });
    expect(res.status).toBe(201);
  });

  test("an admin can grant an action the admin holds", async () => {
    const owner = await ownerSession();
    const admin = await makeAdmin(owner, "Marlow");
    const other = await makeAdult(owner, "Iris");
    await owner.post("/api/grants", { person: admin.id, action: "backups.restore", effect: "allow" });
    const res = await admin.client.post("/api/grants", { person: other.id, action: "backups.restore", effect: "allow" });
    expect(res.status).toBe(201);
  });

  test("an owner can grant an adult a household-management action", async () => {
    const owner = await ownerSession();
    const { id, client } = await makeAdult(owner, "Marlow");

    const res = await owner.post("/api/grants", { person: id, action: "backups.run", effect: "allow" });
    expect(res.status).toBe(201);
    const grant = (await res.json()) as { id: string; action: string; effect: string };
    expect(grant.id).toMatch(/^grant-/);

    const backupsRes = await client.post("/api/backups/run");
    expect(backupsRes.status).toBe(200);
  });

  test("an unknown action is refused", async () => {
    const owner = await ownerSession();
    const { id } = await makeAdult(owner, "Marlow");
    const res = await owner.post("/api/grants", { person: id, action: "no.such.action", effect: "allow" });
    expect(res.status).toBe(400);
  });

  test("an adult cannot grant without holding people.grant themselves", async () => {
    const owner = await ownerSession();
    const { id, client } = await makeAdult(owner, "Marlow");
    const other = await makeAdult(owner, "Iris");
    const res = await client.post("/api/grants", { person: other.id, action: "backups.run", effect: "allow" });
    expect(res.status).toBe(403);
    void id;
  });

  test("chat.unrestricted requires the adult's own acknowledgment", async () => {
    const owner = await ownerSession();
    const { id } = await makeAdult(owner, "Marlow");
    const missingAck = await owner.post("/api/grants", { person: id, action: "chat.unrestricted", effect: "allow" });
    expect(missingAck.status).toBe(400);

    const wrongAck = await owner.post("/api/grants", {
      person: id,
      action: "chat.unrestricted",
      effect: "allow",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by_person_id: "someone-else",
    });
    expect(wrongAck.status).toBe(400);

    const meRes = await owner.get("/api/auth/me");
    const owner_ = (await meRes.json()) as { id: string };
    // Even a correct acknowledgment must be BY the person the grant is about.
    const stillWrong = await owner.post("/api/grants", {
      person: id,
      action: "chat.unrestricted",
      effect: "allow",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by_person_id: owner_.id,
    });
    expect(stillWrong.status).toBe(400);

    const ok = await owner.post("/api/grants", {
      person: id,
      action: "chat.unrestricted",
      effect: "allow",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by_person_id: id,
    });
    expect(ok.status).toBe(201);
  });
});

describe("GET /api/grants", () => {
  test("a person can see their own grants but not someone else's", async () => {
    const owner = await ownerSession();
    const a = await makeAdult(owner, "Marlow");
    const b = await makeAdult(owner, "Iris");
    await owner.post("/api/grants", { person: a.id, action: "backups.run", effect: "allow" });

    const own = await a.client.get("/api/grants");
    expect(own.status).toBe(200);
    expect(((await own.json()) as unknown[]).length).toBe(1);

    const others = await b.client.get(`/api/grants?person=${a.id}`);
    expect(others.status).toBe(403);
  });
});

describe("DELETE /api/grants/:id", () => {
  test("revoking a grant takes the widened access away", async () => {
    const owner = await ownerSession();
    const { id, client } = await makeAdult(owner, "Marlow");
    const created = (await (await owner.post("/api/grants", { person: id, action: "backups.run", effect: "allow" })).json()) as { id: string };

    expect((await client.post("/api/backups/run")).status).toBe(200);
    const revoked = await owner.request(`/api/grants/${created.id}`, { method: "DELETE" });
    expect(revoked.status).toBe(200);
    expect((await client.post("/api/backups/run")).status).toBe(403);
  });
});
