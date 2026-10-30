// WEB-TAB-01 (docs/plans/palette-web-tab-2026-10-30.md): GET /api/search/web-results, the search palette's explicit Web tab.
// Offline: the household's web source is a fake, so no request leaves the test.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { WEB_SOURCES_KEY, __setWebSourceForTests, type WebRows } from "@/lib/retrieval/webSources";
import { MINOR_QUERY_PERSONAL_NOTE } from "@/lib/retrieval/minorQueryCheck";
import { WEB_TAB_NOT_ALLOWED } from "@/lib/failureCopy";

beforeEach(() => resetDb());
afterEach(() => __setWebSourceForTests("ddgs", null));

interface Answer {
  results: { kind: string; id: string; title: string; href: string; source?: string; snippet?: string; action?: string }[];
  note?: string;
}

async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

async function addPerson(ownerClient: TestClient, displayName: string, role: string): Promise<TestClient> {
  const needsSecret = role === "owner" || role === "admin" || role === "adult";
  const created = await ownerClient.post("/api/people", { displayName, role, ...(needsSecret ? { secret: "0000" } : {}) });
  const body = (await created.json()) as { id: string };
  const actor = db.select().from(people).where(eq(people.id, body.id)).get()!;
  const client = new TestClient();
  if (needsSecret) await client.post("/api/auth/verify-secret", { personId: actor.id, secret: "0000" });
  else await client.post("/api/auth/select", { personId: actor.id });
  return client;
}

/** Make ddgs the household's only web source, backed by `search`; returns the queries it was asked. */
function fakeSource(search: (args: unknown) => Promise<WebRows>): unknown[] {
  const calls: unknown[] = [];
  __setWebSourceForTests("ddgs", async (ctx) => {
    calls.push(ctx.args);
    return search(ctx.args);
  });
  expect(setHouseholdSettingValue(WEB_SOURCES_KEY, ["ddgs"]).ok).toBe(true);
  return calls;
}

async function web(client: TestClient, q: string): Promise<{ status: number; body: Answer; cache: string | null }> {
  const res = await client.get(`/api/search/web-results?q=${encodeURIComponent(q)}`);
  return { status: res.status, body: (await res.json()) as Answer, cache: res.headers.get("cache-control") };
}

describe("GET /api/search/web-results", () => {
  test("an adult gets web rows with the host as the source, an Open action, no page read and no caching", async () => {
    const calls = fakeSource(async () => ({
      text: "x",
      rows: [
        { title: "How to brew tea", url: "https://www.example.com/tea", snippet: "Steep for three minutes" },
        { title: "No address", url: null, snippet: null },
      ],
    }));
    const client = await owner();
    const { status, body, cache } = await web(client, "  how to brew tea ");
    expect(status).toBe(200);
    expect(cache).toBe("no-store");
    expect(body.note).toBeUndefined();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ kind: "web", title: "How to brew tea", href: "https://www.example.com/tea", source: "example.com", snippet: "Steep for three minutes", action: "Open" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ query: "how to brew tea", read_page: false });
  });

  test("an empty answer has no rows and no note, and a failing source says it is not answering", async () => {
    fakeSource(async () => ({ text: "", rows: [] }));
    const client = await owner();
    expect((await web(client, "nothing here")).body).toEqual({ results: [] });
    __setWebSourceForTests("ddgs", async () => {
      throw new Error("down");
    });
    const failed = await web(client, "anything");
    expect(failed.status).toBe(200);
    expect(failed.body.results).toEqual([]);
  });

  test("a signed-out request is refused and a blank query is a 400", async () => {
    fakeSource(async () => ({ text: "x", rows: [] }));
    expect((await new TestClient().get("/api/search/web-results?q=tea")).status).toBe(401);
    const client = await owner();
    expect((await client.get("/api/search/web-results")).status).toBe(400);
  });

  test("a guest gets no web search and the source is never asked", async () => {
    const calls = fakeSource(async () => ({ text: "x", rows: [{ title: "T", url: "https://example.com", snippet: null }] }));
    const client = await addPerson(await owner(), "Visitor", "guest");
    const { body } = await web(client, "tea");
    expect(body).toEqual({ results: [], note: WEB_TAB_NOT_ALLOWED });
    expect(calls).toHaveLength(0);
  });

  test("a child's words with a household name never reach the source", async () => {
    const calls = fakeSource(async () => ({ text: "x", rows: [{ title: "T", url: "https://example.com", snippet: null }] }));
    const ownerClient = await owner();
    const child = await addPerson(ownerClient, "Nova", "child");
    const { body } = await web(child, "where does Sage live");
    expect(body.results).toEqual([]);
    expect(body.note).toBe(MINOR_QUERY_PERSONAL_NOTE);
    expect(calls).toHaveLength(0);
  });

  test("GET /api/search stays local and never asks the web source", async () => {
    const calls = fakeSource(async () => ({ text: "x", rows: [{ title: "T", url: "https://example.com", snippet: null }] }));
    const client = await owner();
    const res = await client.get("/api/search?q=tea");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
  });
});
