import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function ownerSession(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

async function makeAdult(owner: TestClient, name: string): Promise<{ id: string; client: TestClient }> {
  const res = await owner.post("/api/people", { displayName: name, role: "adult" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  return { id, client };
}

describe("GET /api/people/:id/permissions", () => {
  test("an allow grant shows up as allow", async () => {
    const owner = await ownerSession();
    const { id } = await makeAdult(owner, "Marlow");
    await owner.post("/api/grants", { person: id, action: "backups.run", effect: "allow" });

    const res = await owner.get(`/api/people/${id}/permissions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ action: string; effect: string }>;
    expect(body).toEqual([{ action: "backups.run", effect: "allow" }]);
  });

  test("a deny always wins over an allow on the same action", async () => {
    const owner = await ownerSession();
    const { id } = await makeAdult(owner, "Marlow");
    await owner.post("/api/grants", { person: id, action: "backups.run", effect: "allow" });
    await owner.post("/api/grants", { person: id, action: "backups.run", effect: "deny" });

    const body = (await (await owner.get(`/api/people/${id}/permissions`)).json()) as Array<{ action: string; effect: string }>;
    expect(body).toEqual([{ action: "backups.run", effect: "deny" }]);
  });

  test("an expired grant does not appear in the effective set", async () => {
    const owner = await ownerSession();
    const { id } = await makeAdult(owner, "Marlow");
    await owner.post("/api/grants", {
      person: id,
      action: "backups.run",
      effect: "allow",
      valid_to: new Date(Date.now() - 1000).toISOString(),
    });

    const body = (await (await owner.get(`/api/people/${id}/permissions`)).json()) as unknown[];
    expect(body).toEqual([]);
  });

  test("a person can see their own permissions", async () => {
    const owner = await ownerSession();
    const { id, client } = await makeAdult(owner, "Marlow");
    await owner.post("/api/grants", { person: id, action: "backups.run", effect: "allow" });
    const res = await client.get(`/api/people/${id}/permissions`);
    expect(res.status).toBe(200);
  });

  test("one adult cannot see another adult's permissions", async () => {
    const owner = await ownerSession();
    const a = await makeAdult(owner, "Marlow");
    const b = await makeAdult(owner, "Iris");
    const res = await b.client.get(`/api/people/${a.id}/permissions`);
    expect(res.status).toBe(403);
  });
});
