import { describe, expect, test, beforeEach } from "bun:test";
import { ChatFolder } from "@maipai/spec/gen/ts/chat-folder.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { sqlite } from "@/db";

// PROJECTS-01a (CHAT-PROJECT-01): a person's projects in the chat column,
// stored as chat folders. These hold the age-band rules (CHAT-UI-SPEC
// section 9), the move rules and the deletion inventory.

// PROJECTS-P1: a response is the spec record plus access, counts and
// last_activity_at (the generated validator is strict), so the spec record is
// checked on its own fields.
function parseFolder(value: unknown): ChatFolder {
  const { access: _a, last_activity_at: _l, counts: _c, ...record } = value as Record<string, unknown>;
  return ChatFolder.parse(record);
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

async function addPerson(client: TestClient, displayName: string, role: string, secret?: string): Promise<string> {
  const res = await client.post("/api/people", { displayName, role, secret });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function sessionFor(personId: string, secret?: string): Promise<TestClient> {
  const client = new TestClient();
  if (secret) await client.post("/api/auth/verify-secret", { personId, secret });
  else await client.post("/api/auth/select", { personId });
  return client;
}

async function makeFolder(client: TestClient, name: string, person?: string): Promise<ChatFolder> {
  const res = await client.post("/api/chat-folders", person ? { name, person } : { name });
  expect(res.status).toBe(201);
  return parseFolder(await res.json());
}

async function newChat(client: TestClient, body: Record<string, unknown> = {}): Promise<{ id: string; folder_id?: string | null }> {
  const res = await client.post("/api/conversations", body);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; folder_id?: string | null };
}

async function listChats(client: TestClient, person?: string): Promise<Array<{ id: string; folder_id: string | null }>> {
  const res = await client.get(person ? `/api/conversations?person=${person}` : "/api/conversations");
  expect(res.status).toBe(200);
  return (await res.json()) as Array<{ id: string; folder_id: string | null }>;
}

describe("making and listing projects", () => {
  test("an adult makes, renames, reorders and lists their own projects as spec records", async () => {
    const owner = await ownerClient();
    const adultId = await addPerson(owner, "Willow", "adult", "willowpin1");
    const adult = await sessionFor(adultId, "willowpin1");
    const garden = await makeFolder(adult, "  Garden plans  ");
    expect(garden.name).toBe("Garden plans");
    expect(garden.person).toBe(adultId);
    expect(garden.provenance).toBe(`${adultId} (self)`);
    const trip = await makeFolder(adult, "Trip");

    const renamed = await adult.request(`/api/chat-folders/${trip.id}`, { method: "PATCH", body: { name: "Summer trip", sort_order: 1 } });
    expect(renamed.status).toBe(200);
    expect(parseFolder(await renamed.json()).name).toBe("Summer trip");

    const listed = (await (await adult.get("/api/chat-folders")).json()) as unknown[];
    expect(listed.map((f) => parseFolder(f).name)).toEqual(["Garden plans", "Summer trip"]);
  });

  test("a name that is empty or longer than 80 characters is refused", async () => {
    const owner = await ownerClient();
    expect((await owner.post("/api/chat-folders", { name: "   " })).status).toBe(400);
    expect((await owner.post("/api/chat-folders", { name: "x".repeat(81) })).status).toBe(400);
  });

  test("a teen's projects are their own and private from an admin", async () => {
    const owner = await ownerClient();
    const teenId = await addPerson(owner, "Juniper", "teen", "juniperpin1");
    const teen = await sessionFor(teenId, "juniperpin1");
    const folder = await makeFolder(teen, "Science fair");

    expect((await (await owner.get(`/api/chat-folders?person=${teenId}`)).json()) as unknown[]).toEqual([]);
    expect((await owner.request(`/api/chat-folders/${folder.id}`, { method: "PATCH", body: { name: "Mine now" } })).status).toBe(404);
    expect((await owner.request(`/api/chat-folders/${folder.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await owner.post("/api/chat-folders", { name: "For you", person: teenId })).status).toBe(404);
  });

  test("a child cannot make, rename or delete a project; a parent makes one for them", async () => {
    const owner = await ownerClient();
    const childId = await addPerson(owner, "Sprout", "child");
    const child = await sessionFor(childId);
    expect((await child.post("/api/chat-folders", { name: "My stuff" })).status).toBe(403);

    const made = await makeFolder(owner, "Homework", childId);
    expect(made.person).toBe(childId);
    expect(made.provenance).toMatch(/\(parent\)$/);

    const seen = (await (await child.get("/api/chat-folders")).json()) as unknown[];
    expect(seen.map((f) => parseFolder(f).id)).toEqual([made.id]);
    expect((await child.request(`/api/chat-folders/${made.id}`, { method: "PATCH", body: { name: "Games" } })).status).toBe(403);
    expect((await child.request(`/api/chat-folders/${made.id}`, { method: "DELETE" })).status).toBe(403);

    // The parent sees and changes the child's own.
    expect((await owner.request(`/api/chat-folders/${made.id}`, { method: "PATCH", body: { name: "School" } })).status).toBe(200);
  });

  test("another adult's projects are invisible", async () => {
    const owner = await ownerClient();
    const adultId = await addPerson(owner, "Iris", "adult", "irispin123");
    const adult = await sessionFor(adultId, "irispin123");
    const folder = await makeFolder(adult, "Private");
    expect((await (await owner.get(`/api/chat-folders?person=${adultId}`)).json()) as unknown[]).toEqual([]);
    expect((await owner.request(`/api/chat-folders/${folder.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("chats in projects", () => {
  test("a chat moves into a project and out again, and the list carries folder_id", async () => {
    const owner = await ownerClient();
    const folder = await makeFolder(owner, "Garden");
    const chat = await newChat(owner);
    const moved = await owner.request(`/api/conversations/${chat.id}`, { method: "PATCH", body: { folder_id: folder.id } });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { folder_id: string }).folder_id).toBe(folder.id);
    expect((await listChats(owner)).find((c) => c.id === chat.id)?.folder_id).toBe(folder.id);
    expect(((await (await owner.get(`/api/conversations/${chat.id}`)).json()) as { folder_id: string }).folder_id).toBe(folder.id);

    const out = await owner.request(`/api/conversations/${chat.id}`, { method: "PATCH", body: { folder_id: null } });
    expect(out.status).toBe(200);
    expect((await listChats(owner)).find((c) => c.id === chat.id)?.folder_id).toBeNull();
  });

  test("moving a chat does not reorder Recents", async () => {
    const owner = await ownerClient();
    const folder = await makeFolder(owner, "Garden");
    const chat = await newChat(owner);
    const before = sqlite.query("SELECT updated_at FROM conversations WHERE id = ?").get(chat.id) as { updated_at: string };
    await owner.request(`/api/conversations/${chat.id}`, { method: "PATCH", body: { folder_id: folder.id } });
    const after = sqlite.query("SELECT updated_at FROM conversations WHERE id = ?").get(chat.id) as { updated_at: string };
    expect(after.updated_at).toBe(before.updated_at);
  });

  test("a new chat can start inside a project", async () => {
    const owner = await ownerClient();
    const folder = await makeFolder(owner, "Garden");
    const chat = await newChat(owner, { folder_id: folder.id });
    expect(chat.folder_id).toBe(folder.id);
    expect((await listChats(owner)).find((c) => c.id === chat.id)?.folder_id).toBe(folder.id);
  });

  test("a temporary chat never joins a project", async () => {
    const owner = await ownerClient();
    const folder = await makeFolder(owner, "Garden");
    expect((await owner.post("/api/conversations", { mode: "temporary", folder_id: folder.id })).status).toBe(400);
    const temp = await newChat(owner, { mode: "temporary" });
    expect((await owner.request(`/api/conversations/${temp.id}`, { method: "PATCH", body: { folder_id: folder.id } })).status).toBe(400);
  });

  test("a chat only joins its own person's live project", async () => {
    const owner = await ownerClient();
    const adultId = await addPerson(owner, "Iris", "adult", "irispin123");
    const adult = await sessionFor(adultId, "irispin123");
    const theirs = await makeFolder(adult, "Theirs");
    const chat = await newChat(owner);
    expect((await owner.request(`/api/conversations/${chat.id}`, { method: "PATCH", body: { folder_id: theirs.id } })).status).toBe(400);
    expect((await owner.post("/api/conversations", { folder_id: theirs.id })).status).toBe(400);
    expect((await owner.request(`/api/conversations/${chat.id}`, { method: "PATCH", body: { folder_id: "folder-nothere1" } })).status).toBe(400);
    expect((await owner.request(`/api/conversations/${chat.id}`, { method: "PATCH", body: { folder_id: 7 } })).status).toBe(400);

    const mine = await makeFolder(owner, "Mine");
    await owner.request(`/api/chat-folders/${mine.id}`, { method: "DELETE" });
    expect((await owner.request(`/api/conversations/${chat.id}`, { method: "PATCH", body: { folder_id: mine.id } })).status).toBe(400);
  });

  test("a child moves their own chat into a project a parent made", async () => {
    const owner = await ownerClient();
    const childId = await addPerson(owner, "Sprout", "child");
    const child = await sessionFor(childId);
    const folder = await makeFolder(owner, "Homework", childId);
    const chat = await newChat(child);
    expect((await child.request(`/api/conversations/${chat.id}`, { method: "PATCH", body: { folder_id: folder.id } })).status).toBe(200);
    expect((await listChats(owner, childId)).find((c) => c.id === chat.id)?.folder_id).toBe(folder.id);
  });
});

describe("request bodies", () => {
  test("POST and PATCH /api/conversations still accept an empty JSON body", async () => {
    const owner = await ownerClient();
    const created = await owner.request("/api/conversations", { method: "POST", headers: { "content-type": "application/json" } });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const patched = await owner.request(`/api/conversations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" } });
    expect(patched.status).toBe(200);
  });
});

describe("deleting", () => {
  test("deleting a project keeps its chats, out of any project", async () => {
    const owner = await ownerClient();
    const folder = await makeFolder(owner, "Garden");
    const a = await newChat(owner, { folder_id: folder.id });
    const b = await newChat(owner, { folder_id: folder.id });
    const res = await owner.request(`/api/chat-folders/${folder.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, chats_kept: 2, files_removed: 0 });
    const chats = await listChats(owner);
    for (const id of [a.id, b.id]) expect(chats.find((c) => c.id === id)?.folder_id).toBeNull();
    expect((await (await owner.get("/api/chat-folders")).json()) as unknown[]).toEqual([]);
    const tomb = sqlite.query("SELECT deleted_at FROM chat_folders WHERE id = ?").get(folder.id) as { deleted_at: string | null };
    expect(tomb.deleted_at).not.toBeNull();
  });

  test("deleting a chat leaves its project", async () => {
    const owner = await ownerClient();
    const folder = await makeFolder(owner, "Garden");
    const chat = await newChat(owner, { folder_id: folder.id });
    expect((await owner.request(`/api/conversations/${chat.id}`, { method: "DELETE" })).status).toBe(200);
    expect(((await (await owner.get("/api/chat-folders")).json()) as unknown[]).length).toBe(1);
  });

  test("deleting a person removes their projects", async () => {
    const owner = await ownerClient();
    const childId = await addPerson(owner, "Sprout", "child");
    const child = await sessionFor(childId);
    const folder = await makeFolder(owner, "Homework", childId);
    await newChat(child, { folder_id: folder.id });
    const res = await owner.request(`/api/people/${childId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((sqlite.query("SELECT COUNT(*) AS n FROM chat_folders WHERE person_id = ?").get(childId) as { n: number }).n).toBe(0);
  });
});
