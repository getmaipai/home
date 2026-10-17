import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { __resetPackageQuietWindowsForTests } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { cacheDir } from "@/lib/paths";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { runPlugin } from "@/lib/plugins";
import { __clearPackageCacheDirForTests, __resetPackageCacheForTests } from "@/lib/packageCache";
import { parseCurrentLocation, resolveWeatherPlace } from "@/lib/places";
import type { PersonRow } from "@/types";

const FORECAST = { current: { temperature_2m: 57.3, weather_code: 61 }, hourly: { time: ["2026-09-05T05:00"], temperature_2m: [57] }, daily: { time: ["2026-09-05"], temperature_2m_max: [64.2], temperature_2m_min: [52.1], precipitation_probability_max: [70] } };
const GEOCODE = { results: [{ name: "Portland", latitude: 45.5234, longitude: -122.6762 }] };

const realFetch = globalThis.fetch;
let urls: string[] = [];
beforeEach(() => {
  resetDb();
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

async function household() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const rows = (role: string, name: string) => owner.post("/api/people", { displayName: name, role, secret: "0000" }).then((r) => r.json() as Promise<{ id: string }>);
  const teen = await rows("teen", "River");
  const child = await rows("child", "Bramble");
  const load = (id: string) => db.select().from(people).where(eq(people.id, id)).get() as unknown as PersonRow;
  const me = (await (await owner.get("/api/auth/me")).json()) as { id: string };
  return { owner, adult: load(me.id), teen: load(teen.id), child: load(child.id) };
}

function diskText(dir: string): string {
  try {
    return readdirSync(dir).map((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? diskText(path) : readFileSync(path, "utf-8"); }).join("\n");
  } catch { return ""; }
}

const forecastUrl = () => urls.find((url) => url.includes("api.open-meteo.com/v1/forecast"));

describe("weather place plumbing", () => {
  test("current location: two decimals for adult and teen, one for a child, in the outbound call", async () => {
    const { adult, teen, child } = await household();
    const current = { lat: 47.60621, lon: -122.33207 };
    for (const [person, expected] of [[adult, "latitude=47.61&longitude=-122.33"], [teen, "latitude=47.61&longitude=-122.33"], [child, "latitude=47.6&longitude=-122.3"]] as const) {
      urls = [];
      const resolved = await resolveWeatherPlace({ person, current });
      expect(resolved?.place).toBe("your current location");
      const result = await runPlugin("weather", person, { place: resolved!.place }, undefined, { hostInputs: resolved!.hostInputs, uncached: resolved!.uncached });
      expect(result).toMatchObject({ ok: true });
      expect(forecastUrl()).toContain(expected);
      expect(urls.some((url) => url.includes("geocoding-api"))).toBe(false);
      expect(urls.join(" ")).not.toContain("47.60621");
      expect(JSON.stringify(result)).not.toMatch(/47\.6|122\.3/);
    }
  });

  test("current coordinates are never written to the package cache on disk", async () => {
    const { adult } = await household();
    const resolved = await resolveWeatherPlace({ person: adult, current: { lat: 47.60621, lon: -122.33207 } });
    await runPlugin("weather", adult, { place: resolved!.place }, undefined, { hostInputs: resolved!.hostInputs, uncached: resolved!.uncached });
    expect(forecastUrl()).toContain("latitude=47.61");
    expect(diskText(cacheDir)).not.toContain("47.61");
  });

  test("a named place that is not saved is geocoded by the recipe, not by the host", async () => {
    const { adult } = await household();
    const resolved = await resolveWeatherPlace({ person: adult, named: "Portland", current: { lat: 1.234, lon: 2.345 } });
    expect(resolved).toEqual({ place: "Portland", hostInputs: {}, uncached: false });
    const result = await runPlugin("weather", adult, { place: "Portland" }, undefined, { hostInputs: resolved!.hostInputs, uncached: resolved!.uncached });
    expect(result).toMatchObject({ ok: true });
    expect(urls[0]).toContain("geocoding-api");
    expect(forecastUrl()).toContain("latitude=45.5234");
  });

  test("no named place, no current coordinates and no home: no place, and the runner answers with a plain needs-place result (WEATHER-HOME-ASK-01)", async () => {
    const { adult } = await household();
    expect(await resolveWeatherPlace({ person: adult })).toBeNull();
    const result = await runPlugin("weather", adult, {});
    expect(result).toMatchObject({ ok: true, value: { data: { needs: "place" } } });
    expect(urls).toEqual([]);
  });

  test("the household home is used when no named place and no current coordinates", async () => {
    const { owner, adult } = await household();
    const created = await owner.post("/api/entities", { kind: "place", place_kind: "map", name: "Home", scope: "household", geo: { lat: 40.7128, lon: -74.006, precision: "exact", area: "New York", from: "typed" } });
    const home = await created.json() as { id: string };
    expect((await owner.put("/api/settings", { scope: "household", key: "household.home", value: home.id })).status).toBe(200);
    const resolved = await resolveWeatherPlace({ person: adult });
    expect(resolved).toEqual({ place: "Home", hostInputs: { latitude: 40.71, longitude: -74.01 }, uncached: false });
  });

  test("a model or caller cannot supply coordinates", async () => {
    const { adult } = await household();
    const result = await runPlugin("weather", adult, { place: "Portland", latitude: 1.11, longitude: 2.22 });
    expect(result).toMatchObject({ ok: true });
    expect(urls[0]).toContain("geocoding-api");
    expect(forecastUrl()).not.toContain("1.11");
  });

  test("the weather settings are registered from the manifest and default to Current location", async () => {
    const { owner, adult } = await household();
    const values = await (await owner.get(`/api/settings?scope=person:${adult.id}`)).json() as { key: string; value: unknown }[];
    expect(values.find((setting) => setting.key === "weather.default_place")?.value).toBe("current");
    expect(values.find((setting) => setting.key === "weather.places")?.value).toEqual([]);
  });

  test("a saved place is labelled by its own name, never an address-like stored area", async () => {
    const { owner, adult } = await household();
    const created = await owner.post("/api/entities", { kind: "place", place_kind: "map", name: "Cabin", scope: "person", geo: { lat: 44.1234, lon: -121.5678, precision: "exact", area: "12 Example Street, Town", from: "typed" } });
    const cabin = await created.json() as { id: string };
    expect((await owner.put("/api/settings", { scope: `person:${adult.id}`, key: "weather.default_place", value: cabin.id })).status).toBe(200);
    const resolved = await resolveWeatherPlace({ person: adult });
    expect(resolved).toMatchObject({ place: "Cabin", hostInputs: { latitude: 44.12, longitude: -121.57 }, uncached: false });
  });

  test("an address-like area sent with Current location is not echoed as the label", async () => {
    const { adult } = await household();
    const resolved = await resolveWeatherPlace({ person: adult, current: { lat: 44.1, lon: -121.5, area: "12 Example Street" } });
    expect(resolved?.place).toBe("your current location");
  });

  test("parseCurrentLocation drops anything off shape", () => {
    expect(parseCurrentLocation({ lat: 47.6, lon: -122.3, area: " Seattle " })).toEqual({ lat: 47.6, lon: -122.3, area: "Seattle" });
    expect(parseCurrentLocation({ lat: 91, lon: 0 })).toBeNull();
    expect(parseCurrentLocation({ lat: "1", lon: 0 })).toBeNull();
    expect(parseCurrentLocation(null)).toBeNull();
  });
});
