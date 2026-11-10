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
import { settingsValues, scheduledJobs } from "@/db/schema";
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

describe("ui.home_order", () => {
  const who = (id: string) => ({ id, role: "owner", birthdate: null }) as unknown as PersonRow;
  const widget = (id: string, changes: Partial<WidgetDescriptor> = {}): WidgetDescriptor => ({ package: "weather", id, title: id, size: "card", refresh_s: 10, min_role: "guest", priority: 50, hero: false, surfaces: ["home"], installed_at: "", ...changes });
  const setOrder = (person: string, ids: string[]) => db.insert(settingsValues).values({ scope: `person:${person}`, key: "ui.home_order", value: JSON.stringify(JSON.stringify(ids)), hlc: "1:0:test", source: "test", updatedAt: new Date().toISOString() }).run();

  test("the person's ids come first, new widgets after, unknown ids ignored", () => {
    setOrder("ord", ["weather/c", "weather/gone", "weather/a"]);
    const ordered = orderHomeCards([widget("a", { priority: 90 }), widget("b", { priority: 80 }), widget("c", { priority: 10 })], who("ord"), "home");
    expect(ordered.cards.map((w) => w.id)).toEqual(["c", "a", "b"]);
  });

  test("the hero stays decided by priority and is not moved by the order", () => {
    setOrder("ord2", ["weather/b", "weather/h"]);
    const ordered = orderHomeCards([widget("h", { hero: true, priority: 99 }), widget("b"), widget("a", { priority: 60 })], who("ord2"), "home");
    expect(ordered.hero?.id).toBe("h");
    expect(ordered.cards.map((w) => w.id)).toEqual(["b", "a"]);
  });

  test("a malformed order is ignored", () => {
    db.insert(settingsValues).values({ scope: "person:bad", key: "ui.home_order", value: JSON.stringify("not json"), hlc: "1:0:test", source: "test", updatedAt: new Date().toISOString() }).run();
    const ordered = orderHomeCards([widget("a", { priority: 90 }), widget("b")], who("bad"), "home");
    expect(ordered.cards.map((w) => w.id)).toEqual(["a", "b"]);
  });
});

describe("GET and PUT /api/widgets/home/arrange", () => {
  const keys = async (client: TestClient) => ((await (await client.get("/api/widgets/home/arrange")).json()) as { cards: Array<{ key: string; hidden: boolean }> }).cards;

  test("requires auth", async () => {
    expect((await new TestClient().get("/api/widgets/home/arrange")).status).toBe(401);
    expect((await new TestClient().put("/api/widgets/home/arrange", { order: [], hidden: [] })).status).toBe(401);
  });

  test("saves order and hidden, returns hidden cards flagged, and Home follows", async () => {
    const client = await owner();
    const before = await keys(client);
    expect(before.length).toBeGreaterThan(2);
    const reversed = before.map((c) => c.key).reverse();
    const res = await client.put("/api/widgets/home/arrange", { order: reversed, hidden: [reversed[0]] });
    expect(res.status).toBe(200);
    const after = await keys(client);
    expect(after.map((c) => c.key)).toEqual(reversed);
    expect(after.find((c) => c.key === reversed[0])?.hidden).toBe(true);
    const home = (await (await client.get("/api/widgets/home")).json()) as { hero: { package: string; id: string } | null; cards: Array<{ package: string; id: string }>; more: Array<{ package: string; id: string }> };
    const shown = [home.hero, ...home.cards, ...home.more].filter(Boolean).map((w) => `${w!.package}/${w!.id}`);
    expect(shown).not.toContain(reversed[0]);
    await client.put("/api/widgets/home/arrange", { order: [], hidden: [] });
    expect((await keys(client)).map((c) => c.key)).toEqual(before.map((c) => c.key));
  });

  test("an id the person cannot see is refused and nothing is saved", async () => {
    const client = await owner();
    const before = await keys(client);
    const res = await client.put("/api/widgets/home/arrange", { order: ["nope/none", before[0]!.key], hidden: [] });
    expect(res.status).toBe(400);
    expect((await keys(client)).map((c) => c.key)).toEqual(before.map((c) => c.key));
  });

  test("a person below a widget's role never sees it and cannot name it", async () => {
    const ownerClient = await owner();
    const ownerKeys = (await keys(ownerClient)).map((c) => c.key);
    const guestClient = await guest(ownerClient);
    expect(await keys(guestClient)).toEqual([]);
    const res = await guestClient.put("/api/widgets/home/arrange", { order: [ownerKeys[0]], hidden: [ownerKeys[1]] });
    expect(res.status).toBe(400);
    expect(await keys(guestClient)).toEqual([]);
  });

  test("a child arranges only the cards already allowed to them", async () => {
    const ownerClient = await owner();
    const created = await ownerClient.post("/api/people", { displayName: "Pippa", role: "child" });
    const person = (await created.json()) as { id: string };
    const child = new TestClient();
    await child.post("/api/auth/select", { personId: person.id });
    const childKeys = (await keys(child)).map((c) => c.key);
    expect(childKeys.length).toBeGreaterThan(0);
    expect((await child.put("/api/widgets/home/arrange", { order: [...childKeys].reverse(), hidden: [childKeys[0]] })).status).toBe(200);
    expect((await child.put("/api/widgets/home/arrange", { order: ["nope/none"], hidden: [] })).status).toBe(400);
    expect((await keys(child)).map((c) => c.key)).toEqual([...childKeys].reverse());
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

describe("Next up and Timers widgets", () => {
  const add = (id: string, personId: string, job: string, at: string, input: Record<string, string | number>) =>
    db.insert(scheduledJobs).values({ id, kind: "core", packageId: "core", job, personId, inputs: JSON.stringify(input), when: at, recurring: false, nextRunAt: at, status: "pending", createdAt: new Date().toISOString(), lastRunAt: null, lastError: null }).run();
  const inMin = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
  const meId = async (c: TestClient) => ((await (await c.get("/api/auth/me")).json()) as { id: string }).id;
  type Body = { items: Array<{ title: string; value?: string; at?: string }> };

  test("both widgets are declared in their owning packages, as cards, with a short refresh", async () => {
    const client = await owner();
    const body = (await (await client.get("/api/widgets")).json()) as Array<{ package: string; id: string; size: string; refresh_s: number }>;
    expect(body).toContainEqual(expect.objectContaining({ package: "remind", id: "upcoming", size: "card" }));
    expect(body).toContainEqual(expect.objectContaining({ package: "timer", id: "running", size: "card", refresh_s: 30 }));
  });

  test("Next up lists the person's own next three reminders, soonest first, with the time", async () => {
    const client = await owner();
    const id = await meId(client);
    const other = await (await client.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" })).json() as { id: string };
    add("r4", id, "reminders.fire", inMin(400), { task: "Fourth" });
    add("r2", id, "reminders.fire", inMin(60), { task: "Second" });
    add("r1", id, "reminders.fire", inMin(25), { task: "First" });
    add("r3", id, "reminders.fire", inMin(120), { task: "Third" });
    add("x", other.id, "reminders.fire", inMin(5), { task: "Not mine" });
    add("t", id, "timers.fire", inMin(2), { label: "Tea" });
    const body = (await (await client.get("/api/widgets/remind/upcoming/data")).json()) as Body;
    expect(body.items.map((i) => i.title)).toEqual(["First", "Second", "Third"]);
    expect(body.items[0]!.at).toBeTruthy();
    expect(body.items[0]!.value).toBeTruthy();
  });

  test("Next up is empty when nothing is coming, so Home hides the card", async () => {
    const client = await owner();
    const body = (await (await client.get("/api/widgets/remind/upcoming/data")).json()) as Body;
    expect(body.items).toEqual([]);
  });

  test("Timers shows up to three running timers with the end time, and none when there are none", async () => {
    const client = await owner();
    expect(((await (await client.get("/api/widgets/timer/running/data")).json()) as Body).items).toEqual([]);
    const id = await meId(client);
    add("a", id, "timers.fire", inMin(5), { label: "Pasta" });
    add("b", id, "timers.fire", inMin(1), { label: "Tea" });
    add("c", id, "timers.fire", inMin(9), { label: "Laundry" });
    add("d", id, "timers.fire", inMin(30), { label: "Oven" });
    add("e", id, "reminders.fire", inMin(3), { task: "Not a timer" });
    const body = (await (await client.get("/api/widgets/timer/running/data")).json()) as Body;
    expect(body.items.map((i) => i.title)).toEqual(["Tea", "Pasta", "Laundry"]);
    expect(body.items[0]!.at).toBeTruthy();
  });

  test("a guest is refused by the package's own role floor", async () => {
    const guestClient = await guest(await owner());
    expect((await guestClient.get("/api/widgets/remind/upcoming/data")).status).toBe(403);
    expect((await guestClient.get("/api/widgets/timer/running/data")).status).toBe(403);
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
