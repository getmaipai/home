import { beforeEach, describe, expect, test, spyOn, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { conversationTurns, settingsValues, entities } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());
afterEach(() => { (globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.(); });

async function ownerClient() {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  const who = await client.get("/api/auth/me");
  return { client, person: await who.json() as { id: string; role: string } };
}

async function addPlace(client: TestClient, name: string, scope: "household" | "person" = "person", geo = { lat: 47.6062, lon: -122.3321, precision: "exact", area: "Seattle, Washington", from: "search" }) {
  const response = await client.post("/api/entities", { kind: "place", place_kind: "map", name, scope, geo });
  expect(response.status).toBe(201);
  return await response.json() as { id: string; name: string; geo: { lat: number; lon: number; precision: string; area: string | null } | null; person: string | null; scope: string };
}

describe("place privacy and persistence", () => {
  test("a child’s place is private from owner and child coordinates are coarse on write and read", async () => {
    const { client: owner } = await ownerClient();
    const childResponse = await owner.post("/api/people", { displayName: "Bramble", role: "child", secret: "0000" });
    const child = await childResponse.json() as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/verify-secret", { personId: child.id, secret: "0000" });

    const created = await addPlace(childClient, "School");
    expect(created.geo).toMatchObject({ lat: 47.6, lon: -122.3, precision: "area", area: "Seattle, Washington" });
    const childRows = await (await childClient.get("/api/entities?kind=place")).json() as Array<{ id: string; geo: { lat: number; lon: number } | null }>;
    expect(childRows.find((row) => row.id === created.id)?.geo).toMatchObject({ lat: 47.6, lon: -122.3 });
    const ownerRows = await (await owner.get("/api/entities?kind=place")).json() as Array<{ id: string }>;
    expect(ownerRows.some((row) => row.id === created.id)).toBe(false);
    expect((await owner.get(`/api/entities/${created.id}`)).status).toBe(404);

    const raw = db.select({ geo: entities.geo }).from(entities).where(eq(entities.id, created.id)).get();
    expect(JSON.parse(raw!.geo!)).toMatchObject({ lat: 47.6, lon: -122.3, precision: "area" });
  });

  test("a child cannot receive address-like area labels and the active home cannot be deleted", async () => {
    const { client: owner } = await ownerClient();
    const childCreate = await owner.post("/api/people", { displayName: "Bramble", role: "child", secret: "0000" });
    const child = await childCreate.json() as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/verify-secret", { personId: child.id, secret: "0000" });
    const place = await addPlace(childClient, "Home", "person", { lat: 47.6062, lon: -122.3321, precision: "exact", area: "123 Main St, Seattle", from: "typed" });
    expect(place.geo?.area).toBe("Approximate area");

    const home = await addPlace(owner, "Household home", "household");
    expect((await owner.put("/api/settings", { scope: "household", key: "household.home", value: home.id })).status).toBe(200);
    const deletion = await owner.request(`/api/entities/${home.id}`, { method: "DELETE" });
    expect(deletion.status).toBe(409);
    expect((await owner.post("/api/places/resolve", { surface: "weather" })).status).toBe(200);
  });

  test("owner, admin, and another adult cannot see a child's, teen's, or adult's personal places or location settings", async () => {
    const { client: owner, person: ownerPerson } = await ownerClient();
    const adminCreate = await owner.post("/api/people", { displayName: "Admin", role: "admin", secret: "0000" });
    const admin = await adminCreate.json() as { id: string };
    const childCreate = await owner.post("/api/people", { displayName: "Bramble", role: "child", secret: "0000" });
    const child = await childCreate.json() as { id: string };
    const teenCreate = await owner.post("/api/people", { displayName: "River", role: "teen", secret: "0000" });
    const teen = await teenCreate.json() as { id: string };
    const adultCreate = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = await adultCreate.json() as { id: string };
    const makeClient = async (personId: string) => {
      const client = new TestClient();
      await client.post("/api/auth/verify-secret", { personId, secret: "0000" });
      return client;
    };
    const adminClient = await makeClient(admin.id);
    const childClient = await makeClient(child.id);
    const teenClient = await makeClient(teen.id);
    const adultClient = await makeClient(adult.id);
    const childPlace = await addPlace(childClient, "School");
    const teenPlace = await addPlace(teenClient, "Teen cafe");
    const adultPlace = await addPlace(adultClient, "Adult office");
    await childClient.put("/api/settings", { scope: `person:${child.id}`, key: "weather.places", value: [childPlace.id] });
    await childClient.put("/api/settings", { scope: `person:${child.id}`, key: "weather.default_place", value: childPlace.id });
    expect((await owner.put("/api/settings", { scope: `person:${ownerPerson.id}`, key: "weather.default_place", value: childPlace.id })).status).toBe(400);

    for (const viewer of [owner, adminClient]) {
      const rows = await (await viewer.get("/api/entities?kind=place")).json() as Array<{ id: string }>;
      for (const place of [childPlace, teenPlace, adultPlace]) expect(rows.some((row) => row.id === place.id)).toBe(false);
    }
    const adultRows = await (await adultClient.get("/api/entities?kind=place")).json() as Array<{ id: string }>;
    expect(adultRows.some((row) => row.id === adultPlace.id)).toBe(true);
    expect(adultRows.some((row) => row.id === childPlace.id || row.id === teenPlace.id)).toBe(false);
    for (const place of [childPlace, teenPlace, adultPlace]) {
      expect((await owner.get(`/api/entities/${place.id}`)).status).toBe(404);
      expect((await adminClient.get(`/api/entities/${place.id}`)).status).toBe(404);
      expect((await adultClient.get(`/api/entities/${place.id}`)).status).toBe(place.id === adultPlace.id ? 200 : 404);
    }
    const childSettings = await (await owner.get(`/api/settings?scope=person:${child.id}`)).json() as Array<{ key: string; value: unknown }>;
    expect(childSettings.some((row) => row.key === "weather.places" || row.key === "weather.default_place" || row.key.startsWith("maps."))).toBe(false);
    const adminChildSettings = await (await adminClient.get(`/api/settings?scope=person:${child.id}`)).json() as Array<{ key: string; value: unknown }>;
    expect(adminChildSettings.some((row) => row.key.startsWith("weather.") || row.key.startsWith("maps."))).toBe(false);
    expect((await adultClient.get(`/api/settings?scope=person:${child.id}`)).status).toBe(403);
    for (const target of [teen, adult]) {
      expect((await owner.get(`/api/settings?scope=person:${target.id}`)).status).toBe(403);
      expect((await adminClient.get(`/api/settings?scope=person:${target.id}`)).status).toBe(403);
    }
    expect((await owner.put("/api/settings", { scope: `person:${child.id}`, key: "weather.default_place", value: childPlace.id })).status).toBe(403);
    expect((await owner.post("/api/settings/reset", { scope: `person:${child.id}`, key: "weather.default_place" })).status).toBe(403);
  });

  test("coordinates passed to resolve are request-only and do not enter turns, settings, or persisted tool calls", async () => {
    const { client } = await ownerClient();
    const original = { log: console.log, warn: console.warn, error: console.error };
    const output: string[] = [];
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    console.warn = (...args: unknown[]) => output.push(args.join(" "));
    console.error = (...args: unknown[]) => output.push(args.join(" "));
    let response: Response;
    try {
      response = await client.post("/api/places/resolve", { surface: "weather", current: { lat: 47.6062, lon: -122.3321, area: "Seattle" } });
    } finally {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    }
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ lat: 47.6062, lon: -122.3321, from: "current" });
    expect(db.select().from(conversationTurns).all()).toHaveLength(0);
    expect(db.select().from(entities).all().filter((row) => row.kind === "place")).toHaveLength(0);
    expect(db.select().from(settingsValues).all().every((row) => !row.value.includes("47.6062") && !row.value.includes("-122.3321"))).toBe(true);
    expect(output.join("\n")).not.toMatch(/47\.6062|-122\.3321/);
  });
});

describe("resolvePlace order", () => {
  test("a named place wins, then a saved default, then household home, then none", async () => {
    const { client, person } = await ownerClient();
    const home = await addPlace(client, "Home", "household", { lat: 40.7128, lon: -74.006, precision: "exact", area: "New York", from: "typed" });
    expect((await client.put("/api/settings", { scope: "household", key: "household.home", value: home.id })).status).toBe(200);
    const saved = await addPlace(client, "Cabin");
    expect((await client.put("/api/settings", { scope: `person:${person.id}`, key: "weather.places", value: [saved.id] })).status).toBe(200);
    expect((await client.put("/api/settings", { scope: `person:${person.id}`, key: "weather.default_place", value: saved.id })).status).toBe(200);

    const byName = await (await client.post("/api/places/resolve", { surface: "weather", named: "Home" })).json() as { label: string; from: string };
    expect(byName).toMatchObject({ label: "Home", from: "named" });
    const bySaved = await (await client.post("/api/places/resolve", { surface: "weather" })).json() as { label: string; from: string };
    expect(bySaved).toMatchObject({ label: "Cabin", from: "saved" });

    await client.post("/api/settings/reset", { scope: `person:${person.id}`, key: "weather.default_place" });
    const byHome = await (await client.post("/api/places/resolve", { surface: "weather" })).json() as { label: string; from: string };
    expect(byHome).toMatchObject({ label: "Home", from: "household" });
    await client.post("/api/settings/reset", { scope: "household", key: "household.home" });
    const noPlace = await (await client.post("/api/places/resolve", { surface: "weather" })).json() as { from: string };
    expect(noPlace.from).toBe("none");
  });

  test("a current default uses request coordinates and rounds a child's response", async () => {
    const { client: owner } = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child", secret: "0000" });
    const child = await created.json() as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: child.id, secret: "0000" });
    const resolved = await (await client.post("/api/places/resolve", { surface: "maps", current: { lat: 47.6062, lon: -122.3321, area: "Seattle" } })).json() as { lat: number; lon: number; precision: string; from: string; label: string };
    expect(resolved).toMatchObject({ lat: 47.6, lon: -122.3, precision: "area", from: "current", label: "Seattle" });
  });

  test("search uses the installed Open-Meteo geocoder and coarsens child candidates", async () => {
    const { client: owner } = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child", secret: "0000" });
    const child = await created.json() as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: child.id, secret: "0000" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async () => Response.json({ results: [{ name: "Seattle", admin1: "Washington", country: "United States", latitude: 47.6062, longitude: -122.3321 }] }), { mockRestore: () => { globalThis.fetch = originalFetch; } }) as unknown as typeof fetch;
    const response = await client.get("/api/places/search?q=Seattle");
    expect(await response.json()).toEqual([{ name: "Seattle", area: "Washington, United States", lat: 47.6, lon: -122.3 }]);
  });
});
