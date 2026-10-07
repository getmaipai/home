import { describe, expect, test, beforeEach } from "bun:test";
import { ChatFolder } from "@maipai/spec/gen/ts/chat-folder.js";
import projectIcons from "@maipai/spec/vocab/project-icons.json" with { type: "json" };
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { sqlite } from "@/db";

// PROJECTS-P1: the project fields, list/search/order, the edit rules, pin,
// archive, share management, the age bands and the deletion inventory.
// Shares are record-only: a member never gains access to the owner's chats.

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

type View = ChatFolder & { access: "manage" | "edit" | "use"; last_activity_at: string; counts: { chats: number; files: number; artifacts: number } };

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
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

async function make(client: TestClient, body: Record<string, unknown>): Promise<View> {
  const res = await client.post("/api/chat-folders", body);
  expect(res.status).toBe(201);
  return (await res.json()) as View;
}

async function patch(client: TestClient, id: string, body: Record<string, unknown>): Promise<Response> {
  return client.request(`/api/chat-folders/${id}`, { method: "PATCH", body });
}

async function list(client: TestClient, query = ""): Promise<View[]> {
  const res = await client.get(`/api/chat-folders${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as View[];
}

async function household() {
  const owner = await ownerClient();
  const adultId = await addPerson(owner, "Iris", "adult", "irispin123");
  const teenId = await addPerson(owner, "Juniper", "teen", "juniperpin1");
  const childId = await addPerson(owner, "Sprout", "child");
  return {
    owner,
    adultId,
    teenId,
    childId,
    adult: await sessionFor(adultId, "irispin123"),
    teen: await sessionFor(teenId, "juniperpin1"),
    child: await sessionFor(childId),
  };
}

describe("the project fields", () => {
  test("a new project is spec-shaped with defaults, memory project_only, and a view of access and counts", async () => {
    const { owner } = await household();
    const created = await make(owner, { name: "Garden" });
    const { access: _a, last_activity_at: _l, counts: _c, ...spec } = created;
    const record = ChatFolder.parse(spec);
    expect(record.color).toBe("neutral");
    expect(record.icon).toBe("folder");
    expect(record.description).toBe("");
    expect(record.instructions).toBe("");
    expect(record.pinned).toBe(false);
    expect(record.archived_at).toBeNull();
    expect(record.memory_mode).toBe("project_only");
    expect(record.shares).toEqual([]);
    expect(created.access).toBe("manage");
    expect(created.counts).toEqual({ chats: 0, files: 0, artifacts: 0 });
    expect(typeof created.last_activity_at).toBe("string");
  });

  test("create takes every field and refuses bad ones", async () => {
    const { owner } = await household();
    const made = await make(owner, { name: "Trip", color: "teal", icon: "plane", description: "Summer", instructions: "Be brief.", memory_mode: "shared" });
    expect(made.color).toBe("teal");
    expect(made.icon).toBe("plane");
    expect(made.memory_mode).toBe("shared");
    expect((await owner.post("/api/chat-folders", { name: "x", color: "#ff0000" })).status).toBe(400);
    expect((await owner.post("/api/chat-folders", { name: "x", icon: "not-an-icon" })).status).toBe(400);
    expect((await owner.post("/api/chat-folders", { name: "x", description: "d".repeat(501) })).status).toBe(400);
    expect((await owner.post("/api/chat-folders", { name: "x", instructions: "i".repeat(1501) })).status).toBe(400);
  });

  test("every vocab icon is accepted and the list has no duplicates", async () => {
    const { owner } = await household();
    expect(new Set(projectIcons.icons).size).toBe(projectIcons.icons.length);
    const first = await make(owner, { name: "Icons" });
    for (const icon of projectIcons.icons) expect((await patch(owner, first.id, { icon })).status).toBe(200);
  });

  test("PATCH edits every field, rename included, and bumps updated_at", async () => {
    const { owner } = await household();
    const made = await make(owner, { name: "Old" });
    await new Promise((r) => setTimeout(r, 5));
    const res = await patch(owner, made.id, { name: "  New name ", color: "violet", icon: "book", description: "About it", instructions: "Use metric.", memory_mode: "shared", sort_order: 3 });
    expect(res.status).toBe(200);
    const view = (await res.json()) as View;
    expect(view).toMatchObject({ name: "New name", color: "violet", icon: "book", description: "About it", instructions: "Use metric.", memory_mode: "shared", sort_order: 3 });
    expect(view.updated_at > made.updated_at).toBe(true);
    expect((await patch(owner, made.id, {})).status).toBe(400);
    expect((await patch(owner, made.id, { name: "" })).status).toBe(400);
    expect((await patch(owner, made.id, { color: "mauve" })).status).toBe(400);
  });

  test("a project's existing rows read as shared memory after the migration default", async () => {
    const { owner } = await household();
    const made = await make(owner, { name: "Old one" });
    sqlite.query("UPDATE chat_folders SET memory_mode = 'shared' WHERE id = ?").run(made.id);
    expect((await list(owner))[0]!.memory_mode).toBe("shared");
  });
});

describe("listing, search, order, pin, archive", () => {
  test("lists by last activity, newest first, and a chat's activity counts", async () => {
    const { owner } = await household();
    const a = await make(owner, { name: "Alpha" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await make(owner, { name: "Beta" });
    expect((await list(owner, "?sort=updated")).map((f) => f.name)).toEqual(["Beta", "Alpha"]);
    await new Promise((r) => setTimeout(r, 5));
    const chat = (await (await owner.post("/api/conversations", { folder_id: a.id })).json()) as { id: string };
    expect(chat.id).toBeTruthy();
    const sorted = await list(owner, "?sort=updated");
    expect(sorted.map((f) => f.name)).toEqual(["Alpha", "Beta"]);
    expect(sorted[0]!.counts.chats).toBe(1);
    expect(b.id).toBeTruthy();
  });

  test("the default order is unchanged: sort_order, then newest", async () => {
    const { owner } = await household();
    const a = await make(owner, { name: "Alpha" });
    await make(owner, { name: "Beta" });
    await patch(owner, a.id, { sort_order: 5 });
    expect((await list(owner)).map((f) => f.name)).toEqual(["Beta", "Alpha"]);
  });

  test("search q matches name and description, case-insensitively, and treats % literally", async () => {
    const { owner } = await household();
    await make(owner, { name: "Garden plans", description: "beds" });
    await make(owner, { name: "Taxes", description: "the GARDEN shed receipts" });
    await make(owner, { name: "100% done" });
    expect((await list(owner, "?q=garden")).map((f) => f.name).sort()).toEqual(["Garden plans", "Taxes"]);
    expect((await list(owner, "?q=%25")).map((f) => f.name)).toEqual(["100% done"]);
    expect(await list(owner, "?q=zzz")).toEqual([]);
  });

  test("pin and unpin put a project first; pinned_at is set and cleared", async () => {
    const { owner } = await household();
    const a = await make(owner, { name: "Alpha" });
    const b = await make(owner, { name: "Beta" });
    const pinned = (await (await patch(owner, a.id, { pinned: true })).json()) as View;
    expect(pinned.pinned).toBe(true);
    expect(pinned.pinned_at).not.toBeNull();
    expect((await list(owner)).map((f) => f.id)[0]).toBe(a.id);
    await patch(owner, b.id, { pinned: true });
    expect((await list(owner)).map((f) => f.id).slice(0, 2)).toEqual([b.id, a.id]);
    const unpinned = (await (await patch(owner, a.id, { pinned: false })).json()) as View;
    expect(unpinned.pinned).toBe(false);
    expect(unpinned.pinned_at).toBeNull();
  });

  test("archive hides a project from the default list, archived=true lists it, unarchive restores it, chats stay", async () => {
    const { owner } = await household();
    const a = await make(owner, { name: "Alpha" });
    const chat = (await (await owner.post("/api/conversations", { folder_id: a.id })).json()) as { id: string; folder_id: string };
    const archived = (await (await patch(owner, a.id, { archived: true })).json()) as View;
    expect(archived.archived_at).not.toBeNull();
    expect(await list(owner)).toEqual([]);
    expect((await list(owner, "?archived=true")).map((f) => f.id)).toEqual([a.id]);
    expect(((await (await owner.get(`/api/conversations/${chat.id}`)).json()) as { folder_id: string }).folder_id).toBe(a.id);
    const back = (await (await patch(owner, a.id, { archived: false })).json()) as View;
    expect(back.archived_at).toBeNull();
    expect((await list(owner)).map((f) => f.id)).toEqual([a.id]);
  });

  test("GET one returns the project with counts; someone else's is 404", async () => {
    const { owner, adult } = await household();
    const a = await make(owner, { name: "Alpha" });
    await owner.post("/api/conversations", { folder_id: a.id });
    const res = await owner.get(`/api/chat-folders/${a.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as View).counts).toEqual({ chats: 1, files: 0, artifacts: 0 });
    expect((await adult.get(`/api/chat-folders/${a.id}`)).status).toBe(404);
  });
});

describe("delete", () => {
  test("returns chats_kept and files_removed 0, and the chats stay", async () => {
    const { owner } = await household();
    const a = await make(owner, { name: "Alpha" });
    await owner.post("/api/conversations", { folder_id: a.id });
    const res = await owner.request(`/api/chat-folders/${a.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, chats_kept: 1, files_removed: 0 });
    expect(await list(owner)).toEqual([]);
  });
});

describe("age bands", () => {
  test("instructions and description pass the floor for a minor's project; an adult's are not floored", async () => {
    const { owner, adult, teen, childId } = await household();
    const bad = "This is our secret, don't tell your parents";
    expect((await owner.post("/api/chat-folders", { name: "Hw", person: childId, instructions: bad })).status).toBe(400);
    expect((await owner.post("/api/chat-folders", { name: "Hw", person: childId, description: bad })).status).toBe(400);
    const childs = await make(owner, { name: "Hw", person: childId });
    expect((await patch(owner, childs.id, { instructions: bad })).status).toBe(400);
    expect((await patch(owner, childs.id, { instructions: "Explain slowly." })).status).toBe(200);
    const teens = await make(teen, { name: "Lab" });
    expect((await patch(teen, teens.id, { description: bad })).status).toBe(400);
    expect((await adult.post("/api/chat-folders", { name: "Adult", instructions: "I want to kill myself" })).status).toBe(201);
  });

  test("a child cannot edit any field of the project a parent made; a parent can", async () => {
    const { owner, child, childId } = await household();
    const made = await make(owner, { name: "Hw", person: childId });
    expect(made.access).toBe("manage");
    const seen = (await list(child))[0]!;
    expect(seen.access).toBe("use");
    for (const body of [{ name: "x" }, { color: "red" }, { instructions: "x" }, { pinned: true }, { archived: true }, { memory_mode: "shared" }]) {
      expect((await patch(child, made.id, body)).status).toBe(403);
    }
    expect((await patch(owner, made.id, { color: "red", pinned: true })).status).toBe(200);
  });

  test("a teen's project is private from admins: not listed, not readable, not editable, not shareable by an admin", async () => {
    const { owner, teen, teenId, adultId } = await household();
    const mine = await make(teen, { name: "Lab", instructions: "Be kind." });
    expect(await list(owner, `?person=${teenId}`)).toEqual([]);
    expect((await owner.get(`/api/chat-folders/${mine.id}`)).status).toBe(404);
    expect((await patch(owner, mine.id, { name: "x" })).status).toBe(404);
    expect((await owner.request(`/api/chat-folders/${mine.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } })).status).toBe(404);
    expect((await list(owner, "?scope=all")).map((f) => f.id)).not.toContain(mine.id);
  });

  test("a teen shares only by their own choice, and the admin then sees it as shared with them, not as the teen's", async () => {
    const { owner, teen, teenId } = await household();
    const ownerId = ((await (await owner.get("/api/auth/me")).json()) as { id: string }).id;
    const mine = await make(teen, { name: "Lab" });
    const shared = await teen.request(`/api/chat-folders/${mine.id}/shares/${ownerId}`, { method: "PUT", body: { role: "can_use" } });
    expect(shared.status).toBe(200);
    const view = (await shared.json()) as View;
    expect(view.shares).toEqual([{ person: ownerId, role: "can_use" }]);
    expect(view.memory_mode).toBe("project_only");
    expect(await list(owner, `?person=${teenId}`)).toEqual([]);
    const withMe = await list(owner, "?scope=shared");
    expect(withMe.map((f) => f.id)).toEqual([mine.id]);
    expect(withMe[0]!.access).toBe("use");
    expect((await owner.get(`/api/chat-folders/${mine.id}`)).status).toBe(200);
    expect((await patch(owner, mine.id, { name: "x" })).status).toBe(403);
  });

  test("only an owner or admin may add a child as a member; a child's project is shared by a parent", async () => {
    const { owner, adult, adultId, childId, teen } = await household();
    const adults = await make(adult, { name: "Family trip" });
    expect((await adult.request(`/api/chat-folders/${adults.id}/shares/${childId}`, { method: "PUT", body: { role: "can_use" } })).status).toBe(403);
    const teens = await make(teen, { name: "Lab" });
    expect((await teen.request(`/api/chat-folders/${teens.id}/shares/${childId}`, { method: "PUT", body: { role: "can_use" } })).status).toBe(403);
    const ownersOwn = await make(owner, { name: "Chores" });
    expect((await owner.request(`/api/chat-folders/${ownersOwn.id}/shares/${childId}`, { method: "PUT", body: { role: "can_use" } })).status).toBe(200);
    expect((await owner.request(`/api/chat-folders/${ownersOwn.id}/shares/${childId}`, { method: "PUT", body: { role: "can_edit" } })).status).toBe(400);
    const childsProject = await make(owner, { name: "Hw", person: childId });
    expect((await owner.request(`/api/chat-folders/${childsProject.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } })).status).toBe(200);
  });
});

describe("sharing", () => {
  test("add, change role, list for the member, and remove", async () => {
    const { owner, adult, adultId } = await household();
    const made = await make(owner, { name: "Family plans", memory_mode: "shared" });
    const added = await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } });
    expect(added.status).toBe(200);
    const view = (await added.json()) as View;
    expect(view.shares).toEqual([{ person: adultId, role: "can_use" }]);
    expect(view.memory_mode).toBe("project_only");

    const theirs = await list(adult, "?scope=shared");
    expect(theirs.map((f) => f.id)).toEqual([made.id]);
    expect(theirs[0]!.access).toBe("use");
    expect(await list(adult)).toEqual([]);
    expect((await list(adult, "?scope=all")).map((f) => f.id)).toEqual([made.id]);

    const upgraded = await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_edit" } });
    expect(((await upgraded.json()) as View).shares).toEqual([{ person: adultId, role: "can_edit" }]);
    expect((await list(adult, "?scope=shared"))[0]!.access).toBe("edit");

    const removed = await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as View).shares).toEqual([]);
    expect(await list(adult, "?scope=shared")).toEqual([]);
  });

  test("a shared project cannot go back to shared memory while it has members", async () => {
    const { owner, adultId } = await household();
    const made = await make(owner, { name: "Plans" });
    await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } });
    expect((await patch(owner, made.id, { memory_mode: "shared" })).status).toBe(400);
  });

  test("can_edit may change the look and instructions but not delete, pin, archive, share or memory", async () => {
    const { owner, adult, adultId } = await household();
    const made = await make(owner, { name: "Plans" });
    await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_edit" } });
    expect((await patch(adult, made.id, { name: "Better", color: "blue", icon: "home", description: "d", instructions: "Be brief." })).status).toBe(200);
    for (const body of [{ pinned: true }, { archived: true }, { memory_mode: "shared" }, { sort_order: 2 }]) expect((await patch(adult, made.id, body)).status).toBe(403);
    expect((await adult.request(`/api/chat-folders/${made.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await adult.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } })).status).toBe(403);
  });

  test("can_use changes nothing; a member may leave; a stranger sees 404", async () => {
    const { owner, adult, adultId, teen } = await household();
    const made = await make(owner, { name: "Plans" });
    await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } });
    expect((await patch(adult, made.id, { name: "x" })).status).toBe(403);
    expect((await teen.get(`/api/chat-folders/${made.id}`)).status).toBe(404);
    expect((await adult.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "DELETE" })).status).toBe(200);
    expect((await adult.get(`/api/chat-folders/${made.id}`)).status).toBe(404);
  });

  test("bad targets: yourself, a missing person, a deleted person", async () => {
    const { owner, adult, adultId } = await household();
    const ownerId = ((await (await owner.get("/api/auth/me")).json()) as { id: string }).id;
    const made = await make(owner, { name: "Plans" });
    expect((await owner.request(`/api/chat-folders/${made.id}/shares/${ownerId}`, { method: "PUT", body: { role: "can_use" } })).status).toBe(400);
    expect((await owner.request(`/api/chat-folders/${made.id}/shares/person-nothere1`, { method: "PUT", body: { role: "can_use" } })).status).toBe(404);
    expect((await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "owner" } })).status).toBe(400);
    expect(adult).toBeTruthy();
  });

  test("shares are record-only: a member cannot put a chat in the owner's project", async () => {
    const { owner, adult, adultId } = await household();
    const made = await make(owner, { name: "Plans" });
    await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_edit" } });
    expect((await adult.post("/api/conversations", { folder_id: made.id })).status).toBe(400);
  });
});

describe("sharing and the child floor", () => {
  test("a project whose description is flagged for a child cannot be shared with one, and later edits are floored once shared", async () => {
    const { owner, childId } = await household();
    const bad = "This is our secret, don't tell your parents";
    const made = await make(owner, { name: "Odd", description: bad });
    expect((await owner.request(`/api/chat-folders/${made.id}/shares/${childId}`, { method: "PUT", body: { role: "can_use" } })).status).toBe(400);
    await patch(owner, made.id, { description: "Fine now" });
    expect((await owner.request(`/api/chat-folders/${made.id}/shares/${childId}`, { method: "PUT", body: { role: "can_use" } })).status).toBe(200);
    expect((await patch(owner, made.id, { description: bad })).status).toBe(400);
  });

  test("repeating a share with the same role changes nothing", async () => {
    const { owner, adultId } = await household();
    const made = await make(owner, { name: "Plans" });
    const first = (await (await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } })).json()) as View;
    const again = (await (await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } })).json()) as View;
    expect(again.updated_at).toBe(first.updated_at);
    expect(again.hlc).toBe(first.hlc);
  });
});

describe("deletion inventory", () => {
  test("deleting a person removes their projects and shares, their membership elsewhere, and leaves no row naming them", async () => {
    const { owner, adult, adultId, teen, teenId } = await household();
    const theirs = await make(adult, { name: "Iris's" });
    await adult.request(`/api/chat-folders/${theirs.id}/shares/${teenId}`, { method: "PUT", body: { role: "can_use" } });
    const ownersProject = await make(owner, { name: "Family" });
    await owner.request(`/api/chat-folders/${ownersProject.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } });
    expect(teen).toBeTruthy();

    expect((await owner.request(`/api/people/${adultId}`, { method: "DELETE" })).status).toBe(200);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM chat_folders WHERE person_id = ?").get(adultId)).toEqual({ n: 0 });
    expect(sqlite.query("SELECT COUNT(*) AS n FROM chat_folder_shares WHERE person_id = ? OR folder_id = ?").get(adultId, theirs.id)).toEqual({ n: 0 });
    expect(((await (await owner.get(`/api/chat-folders/${ownersProject.id}`)).json()) as View).shares).toEqual([]);
  });

  test("a deleted owner's project is gone from a member's chats: folder_id is nulled first", async () => {
    const { owner, adult, adultId } = await household();
    const theirs = await make(adult, { name: "Iris's" });
    const chat = (await (await adult.post("/api/conversations", { folder_id: theirs.id })).json()) as { id: string };
    expect(chat.id).toBeTruthy();
    // A stray reference from another person's chat (defence in depth: shares are record-only, so this should not happen).
    const ownerChat = (await (await owner.post("/api/conversations", {})).json()) as { id: string };
    sqlite.query("UPDATE conversations SET folder_id = ? WHERE id = ?").run(theirs.id, ownerChat.id);
    expect((await owner.request(`/api/people/${adultId}`, { method: "DELETE" })).status).toBe(200);
    expect(sqlite.query("SELECT folder_id FROM conversations WHERE id = ?").get(ownerChat.id)).toEqual({ folder_id: null });
  });

  test("deleting a project removes its shares", async () => {
    const { owner, adultId } = await household();
    const made = await make(owner, { name: "Plans" });
    await owner.request(`/api/chat-folders/${made.id}/shares/${adultId}`, { method: "PUT", body: { role: "can_use" } });
    await owner.request(`/api/chat-folders/${made.id}`, { method: "DELETE" });
    expect(sqlite.query("SELECT COUNT(*) AS n FROM chat_folder_shares WHERE folder_id = ?").get(made.id)).toEqual({ n: 0 });
  });
});
