// Step 9's widgets half (docs/plans/session-d-packages-and-store.md) -
// the frozen D-to-E contract (docs/plans/wave-2.md). lib/widgets.ts
// deliberately invents no per-package data-shaping: getWidgetData()
// calls the exact same runPlugin() a live chat turn or a warm tick
// already calls, so these tests exercise the real bundled packages
// end to end, the same way plugins.test.ts does for POST /run.
import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

async function guest(ownerClient: TestClient): Promise<TestClient> {
  const created = await ownerClient.post("/api/people", { displayName: "Mopey", role: "guest" });
  const person = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: person.id });
  return client;
}

describe("GET /api/widgets", () => {
  test("requires auth", async () => {
    const res = await new TestClient().get("/api/widgets");
    expect(res.status).toBe(401);
  });

  test("lists every bundled widget the actor's role clears", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ package: string; id: string; title: string; size: string; refresh_s: number }>;
    expect(body).toContainEqual({ package: "weather", id: "current", title: "Weather", size: "card", refresh_s: 1800 });
    expect(body).toContainEqual({ package: "news", id: "headlines", title: "News", size: "row", refresh_s: 900 });
    expect(body).toContainEqual({ package: "list-view", id: "shopping", title: "Shopping List", size: "card", refresh_s: 60 });
    expect(body).toContainEqual({ package: "almanac-date", id: "today", title: "Today", size: "card", refresh_s: 3600 });
  });

  test("a role below every bundled widget package's min_role (child) sees none of them", async () => {
    const ownerClient = await owner();
    const guestClient = await guest(ownerClient);
    const res = await guestClient.get("/api/widgets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ package: string }>;
    expect(body.some((w) => w.package === "weather")).toBe(false);
    expect(body.some((w) => w.package === "list-view")).toBe(false);
  });
});

describe("GET /api/widgets/:package/:id/data", () => {
  test("404s on an unknown package", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets/not-a-real-package/current/data");
    expect(res.status).toBe(404);
  });

  test("404s on an unknown widget id within a real package", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets/weather/not-a-real-widget/data");
    expect(res.status).toBe(404);
  });

  test("403s below the package's own min_role", async () => {
    const ownerClient = await owner();
    const guestClient = await guest(ownerClient);
    const res = await guestClient.get("/api/widgets/weather/current/data");
    expect(res.status).toBe(403);
  });

  test("runs the real package recipe with the widget's declared inputs - list-view's own empty-list reply", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets/list-view/shopping/data");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { as_of: string; items: Array<{ title: string }> };
    expect(body.items).toEqual([{ title: "Your shopping list is empty." }]);
    expect(new Date(body.as_of).toString()).not.toBe("Invalid Date");
  });

  test("almanac-date's widget reuses the same handler a live chat turn would get", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets/almanac-date/today/data");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ title: string }> };
    expect(body.items[0]!.title).toContain("Today is");
  });

  test("weather's widget resolves its declared inputs.place, not household state (no settings resolution yet - a known, shared gap)", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets/weather/current/data");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ title: string }> };
    expect(body.items[0]!.title.length).toBeGreaterThan(0);
  });
});
