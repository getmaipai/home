// Step 9's widgets half (docs/plans/session-d-packages-and-store.md) -
// the frozen D-to-E contract (docs/plans/wave-2.md). lib/widgets.ts
// deliberately invents no per-package data-shaping: getWidgetData()
// calls the exact same runPlugin() a live chat turn or a warm tick
// already calls, so these tests exercise the real bundled packages
// end to end, the same way plugins.test.ts does for POST /run.
import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { widgetCardBlock, orderHomeCards, type WidgetDescriptor } from "@/lib/widgets";
import type { PersonRow } from "@/types";
import { HAS_DENO } from "./support/deno";
import { settingsValues } from "@/db/schema";
import { db } from "@/db";

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
    expect(body).toContainEqual(expect.objectContaining({ package: "weather", id: "current", title: "Weather", size: "card", refresh_s: 1800, priority: 50, surfaces: ["home"] }));
    expect(body.some((w) => w.package === "news")).toBe(true);
    expect(body.some((w) => w.package === "remind")).toBe(true);
    expect(body.some((w) => w.package === "almanac-date")).toBe(true);
  });

  test("/api/widgets/home returns the ordered hero, cards and more for my role", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets/home");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hero: unknown; cards: unknown[]; more: unknown[] };
    expect(Array.isArray(body.cards)).toBe(true);
    expect(Array.isArray(body.more)).toBe(true);
    expect((await client.get("/api/widgets/home?surface=nope")).status).toBe(400);
    expect((await new TestClient().get("/api/widgets/home")).status).toBe(401);
  });

  test("a role below every bundled widget package's min_role (child) sees none of them", async () => {
    const ownerClient = await owner();
    const guestClient = await guest(ownerClient);
    const res = await guestClient.get("/api/widgets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ package: string }>;
    expect(body.some((w) => w.package === "weather")).toBe(false);
    expect(body.some((w) => w.package === "remind")).toBe(false);
  });
});

describe("orderHomeCards", () => {
  const who = (role: string, id = "p") => ({ id, role, birthdate: null }) as unknown as PersonRow;
  const widget = (id: string, changes: Partial<WidgetDescriptor> = {}): WidgetDescriptor => ({ package: "weather", id, title: id, size: "card", refresh_s: 10, min_role: "guest", priority: 50, hero: false, surfaces: ["home"], installed_at: "", ...changes });

  test("widget role floors and all roles: child never gets adult widget", () => {
    for (const role of ["owner", "admin", "adult", "teen", "child", "guest"]) {
      const result = orderHomeCards([widget("adult-only", { min_role: "adult" })], who(role), "home");
      const visible = [...result.cards, ...result.more].some((w) => w.id === "adult-only");
      if (role === "child") expect(visible).toBe(false);
    }
  });

  test("tv excludes person-named inputs", () => {
    const result = orderHomeCards([widget("house", { surfaces: ["tv"] }), widget("mine", { surfaces: ["tv"], inputs: { person_id: "x" } })], who("owner"), "tv");
    expect(result.cards.map((w) => w.id)).toEqual(["house"]);
  });

  test("hidden hero falls back to next hero candidate and ties use deterministic order", () => {
    const person = who("owner", "hide-test");
    db.insert(settingsValues).values({ scope: "person:hide-test", key: "ui.home_hidden", value: JSON.stringify(JSON.stringify(["weather/first"])), hlc: "1:0:test", source: "test", updatedAt: new Date().toISOString() }).run();
    const ordered = orderHomeCards([widget("first", { hero: true, priority: 90 }), widget("second", { hero: true, priority: 80 }), widget("b", { priority: 40 }), widget("a", { priority: 40 })], person, "home");
    expect(ordered.hero?.id).toBe("second");
    expect(ordered.cards.map((w) => w.id)).toEqual(["a", "b"]);
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

  test("runs the real package recipe with the widget's declared inputs - remind's shopping-list empty reply", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets/remind/shopping/data");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { as_of: string; items: Array<{ title: string }> };
    expect(body.items).toEqual([{ title: "Your shopping list is empty." }]);
    expect(new Date(body.as_of).toString()).not.toBe("Invalid Date");
  });

  test.skipIf(!HAS_DENO)("almanac-date's widget reuses the same handler a live chat turn would get", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets/almanac-date/today/data");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ title: string }> };
    expect(body.items[0]!.title).toContain("Today is");
  });

  test("weather's widget skips when the household home is unset", async () => {
    const client = await owner();
    const res = await client.get("/api/widgets/weather/current/data");
    expect(res.status).toBe(404);
  });
});

describe("widgetCardBlock", () => {
  const blocks = [{ kind: "spec_sheet" }, { kind: "weather_card", props: {} }];
  const who = (role: string) => ({ role, birthdate: null }) as unknown as PersonRow;

  test("an adult gets the weather_card block, nothing else from the list", () => {
    expect(widgetCardBlock(who("adult"), blocks)).toEqual({ kind: "weather_card", props: {} });
    expect(widgetCardBlock(who("owner"), [{ kind: "chart" }])).toBeUndefined();
  });

  test("a child or a teen keeps the text item, and a missing list is no card", () => {
    expect(widgetCardBlock(who("child"), blocks)).toBeUndefined();
    expect(widgetCardBlock(who("teen"), blocks)).toBeUndefined();
    expect(widgetCardBlock(who("adult"), undefined)).toBeUndefined();
  });
});
