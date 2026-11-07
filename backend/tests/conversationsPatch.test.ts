import { describe, expect, test, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, people } from "@/db/schema";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function setup() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const made = resolveOrCreateConversation(actor, "chat");
  if (!made.ok) throw new Error("no conversation");
  return { client, actor, id: made.value.id };
}

describe("PATCH /api/conversations/:id (AUDIT-ROUTES-01)", () => {
  test("applies every field in the body, not just the first", async () => {
    const { client, id } = await setup();
    const res = await client.request(`/api/conversations/${id}`, { method: "PATCH", body: { archived: true, title: "Taxes", pinned: true } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; title: string; pinned: boolean };
    expect(body).toMatchObject({ title: "Taxes", pinned: true })
    expect(db.select().from(conversations).where(eq(conversations.id, id)).get()?.archived).toBe(true);
    expect(db.select().from(conversations).where(eq(conversations.id, id)).get()).toMatchObject({ archived: true, title: "Taxes" });
  });

  test("an empty body is 400", async () => {
    const { client, id } = await setup();
    const res = await client.request(`/api/conversations/${id}`, { method: "PATCH", body: {} });
    expect(res.status).toBe(400);
  });

  test("a refused field rolls back the fields applied before it (one transaction)", async () => {
    const { client, id } = await setup();
    const res = await client.request(`/api/conversations/${id}`, { method: "PATCH", body: { archived: true, title: "x".repeat(500) } });
    expect(res.status).toBe(400);
    expect(db.select().from(conversations).where(eq(conversations.id, id)).get()?.archived).toBe(false);
  });
});

describe("POST /api/conversations/batch-delete (AUDIT-ROUTES-01)", () => {
  test("more than 200 ids is 400", async () => {
    const { client } = await setup();
    const res = await client.post("/api/conversations/batch-delete", { ids: Array.from({ length: 201 }, (_, i) => `conv-${i}`) });
    expect(res.status).toBe(400);
  });

  test("non-string ids are 400", async () => {
    const { client } = await setup();
    expect((await client.post("/api/conversations/batch-delete", { ids: [1, 2] })).status).toBe(400);
    expect((await client.post("/api/conversations/batch-delete", { ids: "conv-1" })).status).toBe(400);
  });

  test("a normal list still works", async () => {
    const { client, id } = await setup();
    const res = await client.post("/api/conversations/batch-delete", { ids: [id] });
    expect(res.status).toBe(200);
  });
});
