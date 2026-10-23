// WEATHER-APP-01: the bundled Weather package is the first package app. These tests hold what the page promises:
// it is served as data and valid, the picker lists the household home then only the asker's own places, the hero
// is the one weather_card, the only outbound hosts are Open-Meteo's two, and no coordinates are kept anywhere.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { db } from "@/db";
import { entities, settingsValues } from "@/db/schema";
import { __resetAppCachesForTests, getAppData } from "@/lib/apps";
import { PACKAGES_DIR } from "@/lib/paths";
import { __clearPackageCacheDirForTests, __resetPackageCacheForTests } from "@/lib/packageCache";
import { __resetPackageQuietWindowsForTests } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";
import type { TestClient } from "./client";

const FORECAST = {
  current: { time: "2026-10-17T21:00", temperature_2m: 41.2, weather_code: 73, is_day: 0, apparent_temperature: 37.8, relative_humidity_2m: 84, precipitation: 0.1, wind_speed_10m: 8.2, wind_direction_10m: 225, pressure_msl: 1012.4, visibility: 10000 },
  hourly: { time: ["2026-10-17T21:00", "2026-10-17T22:00"], temperature_2m: [41, 40], precipitation_probability: [60, 70] },
  daily: {
    time: ["2026-10-17", "2026-10-18", "2026-10-19"],
    weather_code: [73, 3, 0],
    temperature_2m_max: [44.1, 47.3, 52.0],
    temperature_2m_min: [33.0, 35.5, 38.2],
    precipitation_probability_max: [80, 20, 0],
    sunrise: ["2026-10-17T07:22", "2026-10-18T07:24", "2026-10-19T07:25"],
    sunset: ["2026-10-17T18:10", "2026-10-18T18:08", "2026-10-19T18:06"],
    uv_index_max: [2.1, 2.3, 2.4],
  },
};
const GEOCODE = { results: [{ name: "Portland", latitude: 45.5234, longitude: -122.6762 }] };

const realFetch = globalThis.fetch;
let urls: string[] = [];
beforeEach(() => {
  resetDb();
  __resetAppCachesForTests();
  __resetPackageCacheForTests();
  __resetRateLimiterForTests();
  __resetPackageQuietWindowsForTests();
  __clearPackageCacheDirForTests("weather");
  urls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return Response.json(url.includes("geocoding-api") ? GEOCODE : FORECAST);
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

async function addPlace(client: TestClient, name: string, scope: "person" | "household" = "person", geo = { lat: 45.5234, lon: -122.6762, precision: "exact", area: "Portland, Oregon", from: "search" }) {
  const response = await client.post("/api/entities", { kind: "place", place_kind: "map", name, scope, geo });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

describe("the Weather app is a package app", () => {
  test("it lists for an owner, a teen and a child with its launcher fields", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    const { client: childClient } = await child(client);
    for (const who of [client, teenClient, childClient]) {
      const rows = (await (await who.get("/api/apps")).json()) as Array<Record<string, unknown>>;
      expect(rows.filter((row) => row.package === "weather")).toEqual([expect.objectContaining({ package: "weather", label: "Weather", icon: "cloud-sun", to: "/apps/weather", incognito: "unaffected" })]);
    }
  });

  test("its index page is served and is a valid UI page whose hero is the weather_card", async () => {
    const { client } = await owner();
    const response = await client.get("/api/plugins/weather/pages/index");
    expect(response.status).toBe(200);
    const page = (await response.json()) as { body: Array<Record<string, unknown>> };
    const ajv = new Ajv2020({ strict: false });
    expect(ajv.validate(UI_SCHEMA as object, page)).toBe(true);
    expect(page.body[0]).toMatchObject({ type: "picker", state: "place", leading: [{ value: "current", needs: "geolocation" }] });
    expect(page.body[1]).toMatchObject({ type: "answer_blocks", kinds: ["weather_card"] });
    const file = JSON.parse(readFileSync(join(PACKAGES_DIR, "weather", "pages", "index.json"), "utf-8"));
    expect(page).toEqual(file);
  });

  test("the declared settings area is the person's own weather places, default and unit", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, "weather", "manifest.json"), "utf-8")) as { contributes: { settings_area: { id: string; app: string; sections: Array<{ cards: Array<{ group: string; scope: string }> }> } }; config: Array<{ key: string; lives_in: string; scope: string }> };
    const area = manifest.contributes.settings_area;
    expect(area).toMatchObject({ id: "weather", app: "/apps/weather" });
    const card = area.sections[0]!.cards[0]!;
    expect(manifest.config.filter((k) => k.lives_in === card.group && k.scope === card.scope).map((k) => k.key).sort()).toEqual(["weather.default_place", "weather.places", "weather.unit"]);
  });
});

describe("the app list carries the package's settings area", () => {
  test("every role that clears the area's min_role gets the declared object as is", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, "weather", "manifest.json"), "utf-8")) as { contributes: { settings_area: unknown } };
    for (const c of [client, teenClient]) {
      const rows = (await (await c.get("/api/apps")).json()) as Array<{ package: string; settings_area?: unknown }>;
      expect(rows.find((r) => r.package === "weather")?.settings_area).toMatchObject(manifest.contributes.settings_area as object);
    }
  });
});

describe("the places the picker lists", () => {
  test("the household home first, then the asker's own, never another person's", async () => {
    const { client, row } = await owner();
    const home = await addPlace(client, "Portland", "household");
    expect((await client.put("/api/settings", { scope: "household", key: "household.home", value: home.id })).status).toBe(200);
    const cabin = await addPlace(client, "Cabin");
    expect((await client.put("/api/settings", { scope: `person:${row.id}`, key: "weather.places", value: [cabin.id] })).status).toBe(200);
    const teenClient = await teen(client);
    await addPlace(teenClient, "Skate park");

    const mine = (await (await client.post("/api/plugins/weather/data/places", {})).json()) as { rows: unknown[] };
    expect(mine.rows).toEqual([{ id: home.id, label: "Portland (home)" }, { id: cabin.id, label: "Cabin" }]);
    // The teen has saved nothing in the weather list, so sees the home alone (and not the owner's Cabin).
    const theirs = (await (await teenClient.post("/api/plugins/weather/data/places", {})).json()) as { rows: unknown[] };
    expect(theirs.rows).toEqual([{ id: home.id, label: "Portland (home)" }]);
  });

  test("no home set and nothing saved is an empty list, so the picker shows only Current location", async () => {
    const { client } = await owner();
    expect(((await (await client.post("/api/plugins/weather/data/places", {})).json()) as { rows: unknown[] }).rows).toEqual([]);
  });

  test("a saved place that is also the home is listed once", async () => {
    const { client, row } = await owner();
    const home = await addPlace(client, "Portland", "household");
    await client.put("/api/settings", { scope: "household", key: "household.home", value: home.id });
    await client.put("/api/settings", { scope: `person:${row.id}`, key: "weather.places", value: [home.id] });
    const rows = ((await (await client.post("/api/plugins/weather/data/places", {})).json()) as { rows: Array<{ id: string }> }).rows;
    expect(rows.map((r) => r.id)).toEqual([home.id]);
  });
});

describe("the forecast data call", () => {
  test("a saved place gives one weather_card, from the two Open-Meteo hosts only", async () => {
    const { client, row } = await owner();
    const cabin = await addPlace(client, "Cabin");
    const result = await getAppData(row, "weather", "forecast", { place: cabin.id });
    expect(result.ok).toBe(true);
    const blocks = (result as { value: { blocks: Array<Record<string, any>> } }).value.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "weather_card", producer: "weather" });
    expect(blocks[0]!.props.place).toBe("Cabin");
    expect(blocks[0]!.props.current).toMatchObject({ code: 73, is_day: false });
    expect(blocks[0]!.props.daily.length).toBe(3);
    expect(blocks[0]!.props.hourly.length).toBe(2);
    expect((result as { value: { details: Record<string, unknown> } }).value.details).toMatchObject({ feels_like: 37.8, humidity: 84, precipitation: 0.1, wind_speed: 8.2, wind_direction: 225, pressure: 1012.4, visibility: 10000, sunrise: "2026-10-17T07:22", sunset: "2026-10-17T18:10", uv_index: 2.1 });
    expect(blocks[0]!.props.attribution).toContain("Open-Meteo");
    const hosts = new Set(urls.map((url) => new URL(url).host));
    expect([...hosts].every((host) => host === "api.open-meteo.com" || host === "geocoding-api.open-meteo.com")).toBe(true);
  });

  test("Current location rides the request only: two decimals out, nothing kept", async () => {
    const { client, row } = await owner();
    void client;
    const output: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (...args: unknown[]) => void output.push(args.join(" "));
    let result: Awaited<ReturnType<typeof getAppData>>;
    try {
      result = await getAppData(row, "weather", "forecast", { place: "current", current: { lat: 47.60621, lon: -122.33207 } });
    } finally {
      Object.assign(console, original);
    }
    expect(result.ok).toBe(true);
    const forecast = urls.find((url) => url.includes("/v1/forecast"))!;
    expect(forecast).toContain("latitude=47.61&longitude=-122.33");
    expect(urls.some((url) => url.includes("geocoding-api"))).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/47\.6|122\.3/);
    expect(output.join("\n")).not.toMatch(/47\.6|122\.3/);
    expect(db.select().from(settingsValues).all().every((r) => !r.value.includes("47.6"))).toBe(true);
    expect(db.select().from(entities).all().filter((e) => e.kind === "place")).toHaveLength(0);
  });

  test("with no place chosen, no default and no home the page is told it needs a place, not an error", async () => {
    const { row } = await owner();
    const result = await getAppData(row, "weather", "forecast", {});
    expect(result).toMatchObject({ ok: true, value: { blocks: [], needs: "place" } });
    expect(urls).toEqual([]);
  });

  // WEATHER-FIX-01: Current location is the default, and a browser that blocks location sends no coordinates.
  test("a saved place answers when the default is Current location and the browser shared nothing", async () => {
    const { client, row } = await owner();
    const cabin = await addPlace(client, "Cabin");
    expect((await client.put("/api/settings", { scope: `person:${row.id}`, key: "weather.places", value: [cabin.id] })).status).toBe(200);
    const result = await getAppData(row, "weather", "forecast", {});
    const blocks = (result as { value: { blocks: Array<Record<string, any>>; needs?: string } }).value;
    expect(blocks.needs).toBeUndefined();
    expect(blocks.blocks[0]!.props.place).toBe("Cabin");
  });

  test("the route says why: a failed lookup and a Current location with no coordinates carry a code the page reads", async () => {
    const { client, row } = await owner();
    const cabin = await addPlace(client, "Cabin");
    const noCoordinates = await client.post("/api/plugins/weather/data/forecast", { place: "current" });
    expect(noCoordinates.status).toBe(400);
    expect(await noCoordinates.json()).toMatchObject({ code: "needs_place", kind: "needs_place" });
    globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const down = await client.post("/api/plugins/weather/data/forecast", { place: cabin.id });
    expect(down.status).toBe(502);
    expect(await down.json()).toMatchObject({ code: expect.stringMatching(/down|timed_out/) });
    expect(row.id).toBeTruthy();
  });

  test("offline: a failed lookup is 502 with only its kind, never the raw error", async () => {
    const { client, row } = await owner();
    const cabin = await addPlace(client, "Cabin");
    globalThis.fetch = (async () => { throw new TypeError("fetch failed: ECONNREFUSED 192.0.2.7:443"); }) as unknown as typeof fetch;
    const result = await getAppData(row, "weather", "forecast", { place: cabin.id });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
    expect(result).toMatchObject({ status: 502, kind: expect.stringMatching(/down|timed_out/) });
  });

  test("a child's saved place is coarsened to one decimal", async () => {
    const { client } = await owner();
    const { client: childClient, row } = await child(client);
    const play = await addPlace(childClient, "Park", "person", { lat: 45.5234, lon: -122.6762, precision: "exact", area: "Portland, Oregon", from: "search" });
    const result = await getAppData(row, "weather", "forecast", { place: play.id });
    expect(result.ok).toBe(true);
    expect(urls.find((url) => url.includes("/v1/forecast"))).toContain("latitude=45.5&longitude=-122.7");
  });

  test("a person's Celsius choice reaches the forecast call and the card, and Fahrenheit stays the default", async () => {
    const { client, row } = await owner();
    const cabin = await addPlace(client, "Cabin");
    const first = await getAppData(row, "weather", "forecast", { place: cabin.id });
    expect(urls.find((url) => url.includes("/v1/forecast"))).toContain("temperature_unit=fahrenheit");
    expect((first as { value: { blocks: Array<Record<string, any>> } }).value.blocks[0]!.props.unit).toBe("F");

    expect((await client.put("/api/settings", { scope: `person:${row.id}`, key: "weather.unit", value: "celsius" })).status).toBe(200);
    __resetPackageCacheForTests();
    urls = [];
    const second = await getAppData(row, "weather", "forecast", { place: cabin.id });
    expect(urls.find((url) => url.includes("/v1/forecast"))).toContain("temperature_unit=celsius");
    expect((second as { value: { blocks: Array<Record<string, any>> } }).value.blocks[0]!.props.unit).toBe("C");
  });
});
