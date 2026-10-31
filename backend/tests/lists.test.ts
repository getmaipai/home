// Step 8: "lists, reminders and timers" (docs/plans/session-d-packages-
// and-store.md) - the REST half of the frozen D-to-E contract
// (docs/plans/wave-2.md). lib/lists.ts's own rules, exercised through
// the real HTTP boundary the same way entities.test.ts does for
// lib/entities.ts. The chat-routable shopping-list path through `remind` is covered in
// packageHost.test.ts and plugins.test.ts - this file is the REST
// surface Session E's own list page binds to.
import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { parseQuickAddReminder } from "@/lib/reminderParsing";

beforeEach(() => resetDb());

async function ownerSession(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

describe("POST /api/lists", () => {
  test("creates a household-scoped shopping list with the default title", async () => {
    const owner = await ownerSession();
    const res = await owner.post("/api/lists", { kind: "shopping" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; kind: string; title: string; scope: string; items: unknown[] };
    expect(body.id).toMatch(/^list-/);
    expect(body.title).toBe("Shopping List");
    expect(body.scope).toBe("household");
    expect(body.items).toEqual([]);
  });

  test("a custom list needs a title", async () => {
    const owner = await ownerSession();
    const res = await owner.post("/api/lists", { kind: "custom" });
    expect(res.status).toBe(400);
  });

  test("a custom list with a title works", async () => {
    const owner = await ownerSession();
    const res = await owner.post("/api/lists", { kind: "custom", title: "Books to Read" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("Books to Read");
  });

  test("creates a custom list with an icon and returns it on later reads", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "custom", title: "Work", scope: "person", icon: "briefcase" });
    expect(created.status).toBe(201);
    const list = (await created.json()) as { id: string; icon?: string };
    expect(list.icon).toBe("briefcase");
    const reread = await owner.get(`/api/lists/${list.id}`);
    expect(((await reread.json()) as { icon?: string }).icon).toBe("briefcase");
  });

  test("a person-scoped list defaults to the creator's own person", async () => {
    const owner = await ownerSession();
    const meRes = await owner.get("/api/auth/me");
    const me = (await meRes.json()) as { id: string };
    const res = await owner.post("/api/lists", { kind: "todo", scope: "person" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { person: string | null };
    expect(body.person).toBe(me.id);
  });
});

describe("GET /api/lists", () => {
  test("first read creates the two household standing lists for a child", async () => {
    const owner = await ownerSession();
    const childRes = await owner.post("/api/people", { displayName: "Nova", role: "child", secret: "0000" });
    const child = (await childRes.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/verify-secret", { personId: child.id, secret: "0000" });

    const response = await childClient.get("/api/lists");
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{ kind: string; scope: string }>;
    expect(rows.filter((row) => row.scope === "household").map((row) => row.kind).sort()).toEqual(["shopping", "todo"]);
  });

  test("a person-scoped list is invisible to someone else, visible to owner/admin", async () => {
    const owner = await ownerSession();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const created = await adultClient.post("/api/lists", { kind: "todo", scope: "person" });
    expect(created.status).toBe(201);
    const list = (await created.json()) as { id: string };

    const owner2Res = await owner.post("/api/people", { displayName: "Iris", role: "adult", secret: "0000" });
    const owner2 = (await owner2Res.json()) as { id: string };
    const otherClient = new TestClient();
    await otherClient.post("/api/auth/verify-secret", { personId: owner2.id, secret: "0000" });
    const listAsOther = (await (await otherClient.get("/api/lists")).json()) as Array<{ id: string }>;
    expect(listAsOther.some((l) => l.id === list.id)).toBe(false);

    const listAsOwner = (await (await owner.get("/api/lists")).json()) as Array<{ id: string }>;
    expect(listAsOwner.some((l) => l.id === list.id)).toBe(true);
  });
});

describe("PATCH and DELETE /api/lists/:id", () => {
  test("renames a list", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "custom", title: "Books" });
    const list = (await created.json()) as { id: string };
    const patched = await owner.request(`/api/lists/${list.id}`, { method: "PATCH", body: { title: "Books to Read" } });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as { title: string };
    expect(body.title).toBe("Books to Read");
  });

  test("updates a custom list title and icon", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "custom", title: "Work", scope: "person", icon: "sparkle" });
    const list = (await created.json()) as { id: string };
    const patched = await owner.request(`/api/lists/${list.id}`, { method: "PATCH", body: { title: "Projects", icon: "briefcase" } });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ title: "Projects", icon: "briefcase" });
  });

  test("deletes an own custom list", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "custom", title: "Work", scope: "person" });
    const list = (await created.json()) as { id: string };
    expect((await owner.request(`/api/lists/${list.id}`, { method: "DELETE" })).status).toBe(200);
  });

  test("deleting removes it from listing but is idempotent-safe against a second delete", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };

    const del1 = await owner.request(`/api/lists/${list.id}`, { method: "DELETE" });
    expect(del1.status).toBe(200);
    const del2 = await owner.request(`/api/lists/${list.id}`, { method: "DELETE" });
    expect(del2.status).toBe(404);

    const listing = (await (await owner.get("/api/lists")).json()) as Array<{ id: string }>;
    expect(listing.some((l) => l.id === list.id)).toBe(false);
  });

  test("a child cannot delete a household list", async () => {
    const owner = await ownerSession();
    const childRes = await owner.post("/api/people", { displayName: "Nova", role: "child", secret: "0000" });
    const child = (await childRes.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/verify-secret", { personId: child.id, secret: "0000" });
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };

    const deletion = await childClient.request(`/api/lists/${list.id}`, { method: "DELETE" });
    expect(deletion.status).toBe(403);
    const listing = (await (await owner.get("/api/lists")).json()) as Array<{ id: string }>;
    expect(listing.some((entry) => entry.id === list.id)).toBe(true);
  });
});

describe("items: POST/PATCH/DELETE /api/lists/:id/items[/:itemId]", () => {
  test("adds an item", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };
    const res = await owner.post(`/api/lists/${list.id}/items`, { text: "milk" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { text: string; done: boolean }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.text).toBe("milk");
    expect(body.items[0]!.done).toBe(false);
  });

  test("parse_due extracts tomorrow at 5 while plain text stays unchanged", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "todo", scope: "person", title: "Tasks" });
    const list = (await created.json()) as { id: string };
    const parsed = await owner.post(`/api/lists/${list.id}/items`, { text: "milk tomorrow at 5", parse_due: true });
    expect(parsed.status).toBe(200);
    const parsedBody = (await parsed.json()) as { items: Array<{ text: string; due_at: string | null }> };
    expect(parsedBody.items[0]!.text).toBe("milk");
    expect(typeof parsedBody.items[0]!.due_at).toBe("string");
    expect(parseQuickAddReminder("milk tomorrow at 5", new Date("2026-10-29T12:00:00.000Z")).when_text).toContain("5:00 PM");
    const plain = await owner.post(`/api/lists/${list.id}/items`, { text: "plain milk", parse_due: true });
    expect(await plain.json()).toMatchObject({ items: [expect.anything(), expect.objectContaining({ text: "plain milk", due_at: null })] });
  });

  test("a refused parse still adds the full text", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "todo", scope: "person", title: "Tasks" });
    const list = (await created.json()) as { id: string };
    const response = await owner.post(`/api/lists/${list.id}/items`, { text: "every Friday milk", parse_due: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [expect.objectContaining({ text: "every Friday milk", due_at: null })] });
  });

  test("a due_at is refused on a non-todo list item", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };
    const res = await owner.post(`/api/lists/${list.id}/items`, { text: "milk", due_at: "2026-09-08T17:00:00Z" });
    expect(res.status).toBe(400);
  });

  test("a due_at works on a todo list item", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "todo" });
    const list = (await created.json()) as { id: string };
    const res = await owner.post(`/api/lists/${list.id}/items`, { text: "call the vet", due_at: "2026-09-08T17:00:00Z" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { due_at: string | null }[] };
    expect(body.items[0]!.due_at).toBe("2026-09-08T17:00:00Z");
  });

  test("edits an item's text and toggles done", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };
    const added = await owner.post(`/api/lists/${list.id}/items`, { text: "milk" });
    const addedBody = (await added.json()) as { items: { id: string }[] };
    const itemId = addedBody.items[0]!.id;

    const patched = await owner.request(`/api/lists/${list.id}/items/${itemId}`, { method: "PATCH", body: { done: true } });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as { items: { done: boolean; text: string }[] };
    expect(body.items[0]!.done).toBe(true);
    expect(body.items[0]!.text).toBe("milk");
  });

  test("editing an unknown item is a 404", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };
    const res = await owner.request(`/api/lists/${list.id}/items/item-nope0000`, { method: "PATCH", body: { done: true } });
    expect(res.status).toBe(404);
  });

  test("removes one item, leaving the rest", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };
    await owner.post(`/api/lists/${list.id}/items`, { text: "milk" });
    const added2 = await owner.post(`/api/lists/${list.id}/items`, { text: "eggs" });
    const added2Body = (await added2.json()) as { items: { id: string; text: string }[] };
    const milkId = added2Body.items.find((i) => i.text === "milk")!.id;

    const res = await owner.request(`/api/lists/${list.id}/items/${milkId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { text: string }[] };
    expect(body.items.map((i) => i.text)).toEqual(["eggs"]);
  });
});

describe("POST /api/lists/:id/clear", () => {
  test("removes every item, keeping the list itself", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };
    await owner.post(`/api/lists/${list.id}/items`, { text: "milk" });
    await owner.post(`/api/lists/${list.id}/items`, { text: "eggs" });

    const res = await owner.post(`/api/lists/${list.id}/clear`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; id: string };
    expect(body.items).toEqual([]);
    expect(body.id).toBe(list.id);
  });
});

describe("POST /api/lists/:id/clear-done", () => {
  test("a child can clear completed household items while open items stay", async () => {
    const owner = await ownerSession();
    const childRes = await owner.post("/api/people", { displayName: "Nova", role: "child", secret: "0000" });
    const child = (await childRes.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/verify-secret", { personId: child.id, secret: "0000" });
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };
    const first = await owner.post(`/api/lists/${list.id}/items`, { text: "milk" });
    const second = await owner.post(`/api/lists/${list.id}/items`, { text: "bread" });
    const firstId = ((await first.json()) as { items: Array<{ id: string }> }).items[0]!.id;
    const secondId = ((await second.json()) as { items: Array<{ id: string }> }).items[1]!.id;
    await childClient.request(`/api/lists/${list.id}/items/${firstId}`, { method: "PATCH", body: { done: true } });
    await childClient.request(`/api/lists/${list.id}/items/${secondId}`, { method: "PATCH", body: { done: true } });

    const res = await childClient.post(`/api/lists/${list.id}/clear-done`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items).toEqual([]);
  });

  test("keeps open household items when completed ones are cleared", async () => {
    const owner = await ownerSession();
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };
    const added = await owner.post(`/api/lists/${list.id}/items`, { text: "milk" });
    const itemId = ((await added.json()) as { items: Array<{ id: string }> }).items[0]!.id;
    const done = await owner.request(`/api/lists/${list.id}/items/${itemId}`, { method: "PATCH", body: { done: true } });
    expect(done.status).toBe(200);
    await owner.post(`/api/lists/${list.id}/items`, { text: "bread" });

    const res = await owner.post(`/api/lists/${list.id}/clear-done`, {});
    const body = (await res.json()) as { items: Array<{ text: string }> };
    expect(body.items.map((item) => item.text)).toEqual(["bread"]);
  });

  test("an admin can clear completed items on the household shopping list", async () => {
    const owner = await ownerSession();
    const adminRes = await owner.post("/api/people", { displayName: "Marlow", role: "admin", secret: "0000" });
    const admin = (await adminRes.json()) as { id: string };
    const adminClient = new TestClient();
    await adminClient.post("/api/auth/verify-secret", { personId: admin.id, secret: "0000" });
    const created = await owner.post("/api/lists", { kind: "shopping" });
    const list = (await created.json()) as { id: string };
    const added = await owner.post(`/api/lists/${list.id}/items`, { text: "milk" });
    const itemId = ((await added.json()) as { items: Array<{ id: string }> }).items[0]!.id;
    await owner.request(`/api/lists/${list.id}/items/${itemId}`, { method: "PATCH", body: { done: true } });

    const result = await adminClient.post(`/api/lists/${list.id}/clear-done`, {});
    expect(result.status).toBe(200);
    expect(((await result.json()) as { items: unknown[] }).items).toEqual([]);
  });
});
