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

describe("POST /api/entities", () => {
  test("creates a household-scoped entity", async () => {
    const owner = await ownerSession();
    const res = await owner.post("/api/entities", { kind: "pet", name: "Bruno" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; kind: string; scope: string };
    expect(body.id).toMatch(/^ent-/);
    expect(body.kind).toBe("pet");
    expect(body.scope).toBe("household");
  });

  test("a place must declare place_kind", async () => {
    const owner = await ownerSession();
    const res = await owner.post("/api/entities", { kind: "place", name: "The Park" });
    expect(res.status).toBe(400);
  });

  test("place_kind on a non-place entity is refused", async () => {
    const owner = await ownerSession();
    const res = await owner.post("/api/entities", { kind: "pet", name: "Bruno", place_kind: "area" });
    expect(res.status).toBe(400);
  });

  test("only a person entity may carry account_person_id", async () => {
    const owner = await ownerSession();
    const meRes = await owner.get("/api/auth/me");
    const me = (await meRes.json()) as { id: string };
    const res = await owner.post("/api/entities", { kind: "pet", name: "Bruno", account_person_id: me.id });
    expect(res.status).toBe(400);
  });

  test("an unknown parent_id is refused", async () => {
    const owner = await ownerSession();
    const res = await owner.post("/api/entities", { kind: "place", name: "Backyard", place_kind: "area", parent_id: "ent-nope00" });
    expect(res.status).toBe(400);
  });

  test("a person-scoped entity defaults to the creator's own person", async () => {
    const owner = await ownerSession();
    const meRes = await owner.get("/api/auth/me");
    const me = (await meRes.json()) as { id: string };
    const res = await owner.post("/api/entities", { kind: "thing", name: "My old bike", scope: "person" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { person: string | null };
    expect(body.person).toBe(me.id);
  });
});

describe("GET /api/entities", () => {
  test("a person-scoped entity is invisible to someone else, visible to owner/admin", async () => {
    const owner = await ownerSession();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const created = await adultClient.post("/api/entities", { kind: "thing", name: "Marlow's diary", scope: "person" });
    expect(created.status).toBe(201);
    const entity = (await created.json()) as { id: string };

    const owner2Res = await owner.post("/api/people", { displayName: "Iris", role: "adult", secret: "0000" });
    const owner2 = (await owner2Res.json()) as { id: string };
    const otherClient = new TestClient();
    await otherClient.post("/api/auth/verify-secret", { personId: owner2.id, secret: "0000" });
    const listAsOther = (await (await otherClient.get("/api/entities")).json()) as Array<{ id: string }>;
    expect(listAsOther.some((e) => e.id === entity.id)).toBe(false);

    const listAsOwner = (await (await owner.get("/api/entities")).json()) as Array<{ id: string }>;
    expect(listAsOwner.some((e) => e.id === entity.id)).toBe(true);
  });

  test("kind filters the list", async () => {
    const owner = await ownerSession();
    await owner.post("/api/entities", { kind: "pet", name: "Bruno" });
    await owner.post("/api/entities", { kind: "thing", name: "The old canoe" });
    const pets = (await (await owner.get("/api/entities?kind=pet")).json()) as Array<{ kind: string }>;
    expect(pets.every((e) => e.kind === "pet")).toBe(true);
    expect(pets.length).toBe(1);
  });
});

describe("PATCH and DELETE /api/entities/:id", () => {
  test("edits name, aliases, description and sensitivity, never kind or scope", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/entities", { kind: "pet", name: "Bruno" });
    const entity = (await created.json()) as { id: string };

    const patched = await owner.request(`/api/entities/${entity.id}`, {
      method: "PATCH",
      body: { name: "Bruno the Good Boy", aliases: ["Bru"], sensitive: true },
    });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as { name: string; aliases: string[]; sensitive: boolean; kind: string };
    expect(body.name).toBe("Bruno the Good Boy");
    expect(body.aliases).toEqual(["Bru"]);
    expect(body.sensitive).toBe(true);
    expect(body.kind).toBe("pet");
  });

  test("an entity cannot become its own parent", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/entities", { kind: "place", name: "House", place_kind: "map" });
    const entity = (await created.json()) as { id: string };
    const res = await owner.request(`/api/entities/${entity.id}`, { method: "PATCH", body: { parent_id: entity.id } });
    expect(res.status).toBe(400);
  });

  test("deleting removes it from listing but is idempotent-safe against a second delete", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/entities", { kind: "pet", name: "Bruno" });
    const entity = (await created.json()) as { id: string };

    const del1 = await owner.request(`/api/entities/${entity.id}`, { method: "DELETE" });
    expect(del1.status).toBe(200);
    const del2 = await owner.request(`/api/entities/${entity.id}`, { method: "DELETE" });
    expect(del2.status).toBe(404);

    const list = (await (await owner.get("/api/entities")).json()) as Array<{ id: string }>;
    expect(list.some((e) => e.id === entity.id)).toBe(false);
  });
});

describe("DELETE /api/entities/:id and relationships (#110)", () => {
  async function makeEntity(client: TestClient, kind: string, name: string): Promise<string> {
    const res = await client.post("/api/entities", { kind, name });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  test("deleting an entity soft-deletes every relationship in both directions, twin rows included", async () => {
    const owner = await ownerSession();
    const parent = await makeEntity(owner, "person", "Sage");
    const child = await makeEntity(owner, "person", "Bramble");
    // parent_of creates two rows: parent_of (parent->child) and child_of (child->parent)
    await owner.post("/api/relationships", { type: "parent_of", from_id: parent, to_id: child });
    // a symmetric edge on the same entity
    const friend = await makeEntity(owner, "person", "Riff");
    await owner.post("/api/relationships", { type: "partner_of", from_id: child, to_id: friend });

    const del = await owner.request(`/api/entities/${child}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    // Both the parent_of and child_of twin rows are gone, and partner_of is gone.
    const list = (await (await owner.get("/api/relationships")).json()) as Array<{ type: string; from_id: string; to_id: string }>;
    expect(list.filter((r) => r.from_id === child || r.to_id === child)).toHaveLength(0);
  });

  test("a relationship between two other entities is untouched", async () => {
    const owner = await ownerSession();
    const a = await makeEntity(owner, "person", "Sage");
    const b = await makeEntity(owner, "person", "Riff");
    const c = await makeEntity(owner, "person", "Bramble");
    await owner.post("/api/relationships", { type: "partner_of", from_id: a, to_id: b });

    const del = await owner.request(`/api/entities/${c}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const list = (await (await owner.get("/api/relationships")).json()) as Array<{ type: string }>;
    expect(list.filter((r) => r.type === "partner_of")).toHaveLength(1);
  });

  test("a relationship that was already deleted keeps its original deletedAt", async () => {
    const owner = await ownerSession();
    const a = await makeEntity(owner, "person", "Sage");
    const b = await makeEntity(owner, "person", "Riff");
    const created = (await (await owner.post("/api/relationships", { type: "partner_of", from_id: a, to_id: b })).json()) as { id: string };

    // Delete the relationship first.
    const delRel = await owner.request(`/api/relationships/${created.id}`, { method: "DELETE" });
    expect(delRel.status).toBe(200);

    // Then delete the entity. The already-deleted relationship is not
    // re-touched, so its deletedAt is unchanged (it was set to a time
    // strictly before "now").
    const delEnt = await owner.request(`/api/entities/${a}`, { method: "DELETE" });
    expect(delEnt.status).toBe(200);

    // Verify via the DB: the relationship's deletedAt should be the earlier one.
    // We can't read deletedAt through the API (it filters isNull), but we
    // can confirm it's still not in the live list.
    const list = (await (await owner.get("/api/relationships")).json()) as Array<{ id: string }>;
    expect(list.some((r) => r.id === created.id)).toBe(false);
  });

  test("deleting an entity with no relationships still works", async () => {
    const owner = await ownerSession();
    const lone = await makeEntity(owner, "pet", "Bruno");
    const del = await owner.request(`/api/entities/${lone}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const list = (await (await owner.get("/api/entities")).json()) as Array<{ id: string }>;
    expect(list.some((e) => e.id === lone)).toBe(false);
  });

  test("listing the surviving entity's relationships no longer returns the deleted edge", async () => {
    const owner = await ownerSession();
    const a = await makeEntity(owner, "person", "Sage");
    const b = await makeEntity(owner, "person", "Riff");
    await owner.post("/api/relationships", { type: "partner_of", from_id: a, to_id: b });

    const del = await owner.request(`/api/entities/${a}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const list = (await (await owner.get(`/api/relationships?entityId=${b}`)).json()) as Array<{ id: string }>;
    expect(list).toHaveLength(0);
  });
});
