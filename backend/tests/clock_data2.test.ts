import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { TestClient } from "./client";
import { createWorldPlace, listWorldPlaces, updateWorldPlace, deleteWorldPlace } from "@/lib/worldPlaces";
import { createQuickTimer, listQuickTimers, deleteQuickTimer } from "@/lib/quickTimers";
import { searchLocalPlaces } from "@/lib/gazetteer";

beforeEach(() => resetDb());

describe("CLOCK-data2 world places", () => {
  test("private ownership, 12 limit, zone validation, reorder", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const owner = db.select().from(people).get()!;

    const one = createWorldPlace(owner, { name: " London ", country: " UK ", zone: "Europe/London" });
    expect(one.ok).toBe(true);
    if (!one.ok) return;

    expect(one.value.name).toBe("London");
    expect(one.value.country).toBe("UK");
    expect(updateWorldPlace(owner, one.value.id, { position: 4 }).ok).toBe(true);

    expect(listWorldPlaces({ ...owner, id: "person-second" })).toHaveLength(0);
    const admin = { ...owner, id: "person-admin", role: "admin" };
    expect(listWorldPlaces(admin)).toHaveLength(0);
    expect(deleteWorldPlace(admin, one.value.id).ok).toBe(false);

    expect(createWorldPlace(owner, { name: "Bad", country: "", zone: "not/a-zone" }).ok).toBe(false);
    for (let i = 1; i < 12; i++) {
      expect(createWorldPlace(owner, { name: `Place ${i}`, country: "", zone: "UTC" }).ok).toBe(true);
    }

    const over = createWorldPlace(owner, { name: "13", country: "", zone: "UTC" });
    expect(over).toMatchObject({ ok: false, status: 400 });
    if (!over.ok) expect(over.error).toMatch(/12/);

    expect(listWorldPlaces(owner).find((place) => place.id === one.value.id)?.position).toBe(4);
  });
});

describe("CLOCK-data2 quick timers", () => {
  test("defaults once, no resurrection, bounds, ownership", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const owner = db.select().from(people).get()!;

    const initial = listQuickTimers(owner);
    expect(initial.map((timer) => [timer.name, timer.minutes])).toEqual([
      ["Tea steep", 4],
      ["A little break", 10],
      ["Focus session", 25],
      ["Deep work", 45],
    ]);

    expect(deleteQuickTimer(owner, initial[0]!.id).ok).toBe(true);
    expect(listQuickTimers(owner)).toHaveLength(3);

    const second = await client.post("/api/people", { displayName: "Marlow", role: "teen", secret: "0000" });
    const secondBody = (await second.json()) as { id: string };
    const secondRow = db.select().from(people).where(eq(people.id, secondBody.id)).get()!;
    expect(listQuickTimers(secondRow)).toHaveLength(4);

    expect(deleteQuickTimer(secondRow, initial[1]!.id).ok).toBe(false);
    expect(listQuickTimers(owner).map((timer) => timer.id)).toContain(initial[1]!.id);
    expect(createQuickTimer(owner, { name: "Too short", minutes: 0 }).ok).toBe(false);
    expect(createQuickTimer(owner, { name: "Too long", minutes: 1441 }).ok).toBe(false);
  });
});

describe("CLOCK-data2 local search", () => {
  test("adds country and zone and query is not logged", async () => {
    const results = searchLocalPlaces("Seattle");
    expect(results.length).toBeGreaterThan(0);
    for (const key of ["name", "area", "lat", "lon", "country", "zone"]) {
      expect(results[0]).toHaveProperty(key);
    }

    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const query = "private-query-marker";
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await client.get(`/api/places/local-search?q=${query}`);
    } finally {
      console.log = original;
    }

    expect(logs.join(" ")).not.toContain(query);
  });
});
