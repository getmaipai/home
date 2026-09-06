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

async function makeEntity(client: TestClient, kind: string, name: string): Promise<string> {
  const res = await client.post("/api/entities", { kind, name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("POST /api/relationships", () => {
  test("stating parent_of also stores the reciprocal child_of edge", async () => {
    const owner = await ownerSession();
    const parent = await makeEntity(owner, "person", "Sage");
    const child = await makeEntity(owner, "person", "Bramble");

    const res = await owner.post("/api/relationships", { type: "parent_of", from_id: parent, to_id: child });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; type: string; source: string; stated_by_person_id: string };
    expect(created.type).toBe("parent_of");
    expect(created.source).toBe("stated");

    const list = (await (await owner.get(`/api/relationships?entityId=${child}`)).json()) as Array<{ type: string; from_id: string; to_id: string }>;
    const reciprocal = list.find((r) => r.type === "child_of");
    expect(reciprocal).toBeDefined();
    expect(reciprocal!.from_id).toBe(child);
    expect(reciprocal!.to_id).toBe(parent);
  });

  test("a symmetric type (partner_of) stores exactly one row, not two", async () => {
    const owner = await ownerSession();
    const a = await makeEntity(owner, "person", "Sage");
    const b = await makeEntity(owner, "person", "Riff");
    await owner.post("/api/relationships", { type: "partner_of", from_id: a, to_id: b });

    const all = (await (await owner.get("/api/relationships")).json()) as Array<{ type: string }>;
    expect(all.filter((r) => r.type === "partner_of")).toHaveLength(1);
  });

  test("an unknown relationship type is refused", async () => {
    const owner = await ownerSession();
    const a = await makeEntity(owner, "person", "Sage");
    const b = await makeEntity(owner, "person", "Riff");
    const res = await owner.post("/api/relationships", { type: "nonsense_of", from_id: a, to_id: b });
    expect(res.status).toBe(400);
  });

  test("a relationship cannot join an entity to itself", async () => {
    const owner = await ownerSession();
    const a = await makeEntity(owner, "person", "Sage");
    const res = await owner.post("/api/relationships", { type: "partner_of", from_id: a, to_id: a });
    expect(res.status).toBe(400);
  });

  test("an entity kind that the type does not admit is refused", async () => {
    const owner = await ownerSession();
    const pet = await makeEntity(owner, "pet", "Bruno");
    const person = await makeEntity(owner, "person", "Sage");
    // parent_of only admits a person on both ends.
    const res = await owner.post("/api/relationships", { type: "parent_of", from_id: pet, to_id: person });
    expect(res.status).toBe(400);
  });

  test("a non-terminable type refuses a valid_to", async () => {
    const owner = await ownerSession();
    const parent = await makeEntity(owner, "person", "Sage");
    const child = await makeEntity(owner, "person", "Bramble");
    const res = await owner.post("/api/relationships", {
      type: "parent_of",
      from_id: parent,
      to_id: child,
      valid_to: "2026-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(400);
  });

  test("an adult without relationships.manage cannot state one", async () => {
    const owner = await ownerSession();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });

    const a = await makeEntity(owner, "person", "Sage");
    const b = await makeEntity(owner, "person", "Riff");
    const res = await adultClient.post("/api/relationships", { type: "partner_of", from_id: a, to_id: b });
    expect(res.status).toBe(403);
  });

  test("a relationships.manage grant lets a non-admin adult state one", async () => {
    const owner = await ownerSession();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult" });
    const adult = (await adultRes.json()) as { id: string };

    const grantRes = await owner.post("/api/grants", { person: adult.id, action: "relationships.manage", effect: "allow" });
    expect(grantRes.status).toBe(201);

    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });
    const a = await makeEntity(owner, "person", "Sage");
    const b = await makeEntity(owner, "person", "Riff");
    const res = await adultClient.post("/api/relationships", { type: "partner_of", from_id: a, to_id: b });
    expect(res.status).toBe(201);
  });
});

describe("PATCH /api/relationships/:id", () => {
  test("ending a terminable relationship also ends its stored inverse", async () => {
    const owner = await ownerSession();
    const parent = await makeEntity(owner, "person", "Sage");
    const child = await makeEntity(owner, "person", "Bramble");
    const created = (await (await owner.post("/api/relationships", { type: "parent_of", from_id: parent, to_id: child })).json()) as { id: string };

    // parent_of cannot end (not terminable), but its status can still
    // change - the "ex-daughter is unsayable, estranged is" case
    // spec/records/ts/validate.ts's own header calls out.
    const patched = await owner.request(`/api/relationships/${created.id}`, { method: "PATCH", body: { status: "estranged" } });
    expect(patched.status).toBe(200);

    const list = (await (await owner.get(`/api/relationships?entityId=${child}`)).json()) as Array<{ type: string; status: string }>;
    const reciprocal = list.find((r) => r.type === "child_of");
    expect(reciprocal!.status).toBe("estranged");
  });

  test("setting valid_to on a non-terminable type is refused", async () => {
    const owner = await ownerSession();
    const parent = await makeEntity(owner, "person", "Sage");
    const child = await makeEntity(owner, "person", "Bramble");
    const created = (await (await owner.post("/api/relationships", { type: "parent_of", from_id: parent, to_id: child })).json()) as { id: string };
    const res = await owner.request(`/api/relationships/${created.id}`, { method: "PATCH", body: { valid_to: "2026-01-01T00:00:00.000Z" } });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/relationships/:id", () => {
  test("removes both the edge and its stored inverse", async () => {
    const owner = await ownerSession();
    const parent = await makeEntity(owner, "person", "Sage");
    const child = await makeEntity(owner, "person", "Bramble");
    const created = (await (await owner.post("/api/relationships", { type: "parent_of", from_id: parent, to_id: child })).json()) as { id: string };

    const del = await owner.request(`/api/relationships/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const list = (await (await owner.get(`/api/relationships?entityId=${child}`)).json()) as Array<{ type: string }>;
    expect(list.some((r) => r.type === "child_of" || r.type === "parent_of")).toBe(false);
  });
});
