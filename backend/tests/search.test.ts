// SHELL-SEARCH-02 (docs/plans/shell-search-2026-09-23.md): GET /api/search,
// one test per provider in the words the design note itself uses.
import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { createConversation, updateConversationTitle } from "@/lib/conversationHistory";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

async function addPerson(ownerClient: TestClient, displayName: string, role: string): Promise<{ client: TestClient; actor: PersonRow }> {
  const needsSecret = role === "owner" || role === "admin" || role === "adult";
  const created = await ownerClient.post("/api/people", { displayName, role, ...(needsSecret ? { secret: "0000" } : {}) });
  const body = (await created.json()) as { id: string };
  const actor = db.select().from(people).where(eq(people.id, body.id)).get()!;
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: actor.id });
  return { client, actor };
}

interface SearchResult {
  kind: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}
interface SearchGroup {
  kind: string;
  heading: string;
  results: SearchResult[];
}

async function search(client: TestClient, q: string): Promise<SearchGroup[]> {
  const res = await client.get(`/api/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { groups: SearchGroup[] };
  return body.groups;
}

function group(groups: SearchGroup[], kind: string): SearchGroup | undefined {
  return groups.find((g) => g.kind === kind);
}

describe("GET /api/search", () => {
  test("requires auth", async () => {
    const res = await new TestClient().get("/api/search?q=peo");
    expect(res.status).toBe(401);
  });

  test("a query with no match anywhere returns no groups at all - empty groups left out", async () => {
    const { client } = await owner();
    const groups = await search(client, "zzz-nothing-matches-zzz");
    expect(groups).toEqual([]);
  });

  // A review caught this: z.string().min(1) passes a single space, and
  // every provider's own .trim().toLowerCase() then normalizes it to
  // the empty string - "".includes("") is always true, so this used to
  // silently return every person, every app, every non-expert setting,
  // and the actor's own every conversation instead of the "no match"
  // this route's own contract promises.
  test("a whitespace-only query returns no groups, the same as no match at all", async () => {
    // The owner ("Sage") is themselves a real person, and the bundled
    // packages and registry are always non-empty - if the bug this
    // proves the fix for ever came back, this query alone would return
    // every one of them.
    const { client } = await owner();
    const groups = await search(client, "   ");
    expect(groups).toEqual([]);
  });
});

describe("GET /api/search: conversations", () => {
  test("a word from a conversation's title lists it, opening it", async () => {
    const { client, actor } = await owner();
    const conv = createConversation(actor, { surface: "chat" });
    if (!conv.ok) throw new Error(conv.error);
    updateConversationTitle(actor, conv.value.id, "Pizza night plans");
    const groups = await search(client, "pizza");
    const conversations = group(groups, "conversation");
    expect(conversations?.results).toEqual([{ kind: "conversation", id: conv.value.id, title: "Pizza night plans", href: `/next/chat?conversation=${conv.value.id}` }]);
  });

  test("a temporary chat never appears", async () => {
    const { client, actor } = await owner();
    const conv = createConversation(actor, { surface: "chat", mode: "temporary" });
    if (!conv.ok) throw new Error(conv.error);
    updateConversationTitle(actor, conv.value.id, "Pizza night plans");
    const groups = await search(client, "pizza");
    expect(group(groups, "conversation")).toBeUndefined();
  });

  test("a child actor sees only their own conversations, never another person's", async () => {
    const { client: ownerClient, actor: ownerActor } = await owner();
    const conv = createConversation(ownerActor, { surface: "chat" });
    if (!conv.ok) throw new Error(conv.error);
    updateConversationTitle(ownerActor, conv.value.id, "Pizza night plans");
    const { client: childClient } = await addPerson(ownerClient, "Sprout", "child");
    const groups = await search(childClient, "pizza");
    expect(group(groups, "conversation")).toBeUndefined();
  });
});

describe("GET /api/search: people", () => {
  test("a word from a person's display name lists them, opening the People page", async () => {
    const { client } = await owner();
    await client.post("/api/people", { displayName: "Bramble", role: "child" });
    const groups = await search(client, "bram");
    const found = group(groups, "person")?.results.find((r) => r.title === "Bramble");
    expect(found).toMatchObject({ kind: "person", title: "Bramble", subtitle: "child", href: "/next/people" });
  });

  test("a child actor sees the household roster the same way the People page does - the route's own established rule, no narrower filter invented here", async () => {
    const { client: ownerClient } = await owner();
    await ownerClient.post("/api/people", { displayName: "Bramble", role: "child" });
    const { client: childClient } = await addPerson(ownerClient, "Sprout", "child");
    const groups = await search(childClient, "bram");
    const found = group(groups, "person")?.results.find((r) => r.title === "Bramble");
    expect(found).not.toBeUndefined();
  });
});

describe("GET /api/search: apps", () => {
  test("a word from a bundled package's own display name lists it, opening the Apps page", async () => {
    const { client } = await owner();
    const groups = await search(client, "math");
    expect(group(groups, "app")?.results).toContainEqual({ kind: "app", id: "math", title: "Math", subtitle: "Calculate a math expression.", href: "/next/apps" });
  });
});

describe("GET /api/search: settings", () => {
  test("a word from a real setting's own label lists it, opening Settings on that section", async () => {
    const { client } = await owner();
    const groups = await search(client, "reply engine");
    const found = group(groups, "setting")?.results.find((r) => r.id === "turn.pipeline.next");
    expect(found).toMatchObject({ kind: "setting", title: "Use the new reply engine", subtitle: "Off keeps today's engine. On uses the rebuilt one; it must pass the same tests on this hub before it becomes the default.", href: "/next/settings?tab=household&section=household.ai" });
  });

  // A review caught this: NextSettingsPage.tsx renders the Household
  // tab only for an owner/admin actor (SettingsPage.tsx's own comment:
  // "household-scope writes 403 for anyone else") - a household-scope
  // result reaching a non-admin actor would open a tab they can't
  // select and a section that's never rendered there.
  test("a non-admin actor never sees a household-scope setting - they have no tab to reach it on", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient } = await addPerson(ownerClient, "Sprout", "child");
    const groups = await search(childClient, "reply engine");
    expect(group(groups, "setting")).toBeUndefined();
  });
});
