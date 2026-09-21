import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { createArtifact } from "@/lib/artifacts";

beforeEach(() => resetDb());

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, person };
}

async function child(owner: TestClient, name = "Bramble") {
  const res = await owner.post("/api/people", { displayName: name, role: "child" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  const person = db.select().from(people).where(eq(people.id, id)).get()!;
  return { client, person };
}

function conversationFor(actor: typeof people.$inferSelect) {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

function turnFor(actor: typeof people.$inferSelect, conversationId: string) {
  const id = newConversationTurnId();
  db.insert(conversationTurns)
    .values({ id, personId: actor.id, surface: "chat", conversationId, userText: "write me a packing list", replyText: "here's a packing list", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() })
    .run();
  return id;
}

describe("GET /api/artifacts/:id", () => {
  test("the owner reads their own artifact", async () => {
    const { client, person } = await owner();
    const conversationId = conversationFor(person);
    const turnId = turnFor(person, conversationId);
    const v1 = createArtifact({ conversationId, turnId, kind: "markdown", title: "Packing list", body: "- Tent\n", createdBy: person.id, provenance: `artifact-tool:${turnId}` });

    const res = await client.get(`/api/artifacts/${v1.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string; version: number };
    expect(body.id).toBe(v1.id);
    expect(body.title).toBe("Packing list");
    expect(body.version).toBe(1);
  });

  test("an unknown id is a 404, not a 500", async () => {
    const { client } = await owner();
    const res = await client.get("/api/artifacts/art-doesnotexist");
    expect(res.status).toBe(404);
  });

  test("a child cannot read another person's artifact", async () => {
    const { client: ownerClient, person: ownerPerson } = await owner();
    const { client: childClient } = await child(ownerClient);
    const conversationId = conversationFor(ownerPerson);
    const turnId = turnFor(ownerPerson, conversationId);
    const v1 = createArtifact({ conversationId, turnId, kind: "markdown", title: "Adult's list", body: "- car keys\n", createdBy: ownerPerson.id, provenance: `artifact-tool:${turnId}` });

    const res = await childClient.get(`/api/artifacts/${v1.id}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/artifacts/:id/export", () => {
  test("downloads markdown with the right content type and a slugged filename", async () => {
    const { client, person } = await owner();
    const conversationId = conversationFor(person);
    const turnId = turnFor(person, conversationId);
    const v1 = createArtifact({ conversationId, turnId, kind: "markdown", title: "Bramble's Packing List!", body: "- Tent\n- Rain jacket\n", createdBy: person.id, provenance: `artifact-tool:${turnId}` });

    const res = await client.get(`/api/artifacts/${v1.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toContain('filename="bramble-s-packing-list.md"');
    expect(await res.text()).toBe("- Tent\n- Rain jacket\n");
  });

  test("downloads html with the html content type and extension", async () => {
    const { client, person } = await owner();
    const conversationId = conversationFor(person);
    const turnId = turnFor(person, conversationId);
    const v1 = createArtifact({ conversationId, turnId, kind: "html", title: "A page", body: "<p>hi</p>", createdBy: person.id, provenance: `artifact-tool:${turnId}` });

    const res = await client.get(`/api/artifacts/${v1.id}/export`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain('filename="a-page.html"');
  });
});
