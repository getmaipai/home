import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createEntity } from "@/lib/entities";
import { almanacHostInputs, loadManifestOnly } from "@/lib/plugins";
import { householdHomeSkyInput } from "@/lib/places";
import { setHouseholdSettingValue } from "@/lib/settings";
import { callTier1Handle, __resetDenoHostForTests } from "@/lib/denoHost";
import { eq } from "drizzle-orm";
import { HAS_DENO } from "./support/deno";

const packageDir = new URL("../packages/almanac-moon/", import.meta.url);
const readPackageFile = (name: string) => readFileSync(new URL(name, packageDir), "utf8");
const ajv = new Ajv2020({ strict: false });

beforeEach(() => {
  resetDb();
  __resetDenoHostForTests();
});

afterEach(() => __resetDenoHostForTests());

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

function seedHome(geo?: { lat: number; lon: number; precision: "exact"; area: string; from: "search" }) {
  const created = createEntity({ id: "system", role: "owner" }, {
    kind: "place",
    name: "Household home",
    place_kind: "map",
    scope: "household",
    geo: geo ?? undefined,
  });
  if (!created.ok || !created.value) throw new Error(created.error ?? "home place was not created");
  const configured = setHouseholdSettingValue("household.home", created.value.id);
  if (!configured.ok) throw new Error(configured.error);
}

function unwrap(result: Awaited<ReturnType<typeof callTier1Handle>>) {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe("almanac sky host inputs and local result", () => {
  test.skipIf(!HAS_DENO)("coordinates are rounded to 2 decimals before they reach the sandbox", async () => {
    seedHome({ lat: 47.60621, lon: -122.33207, precision: "exact", area: "Private area label", from: "search" });
    expect(householdHomeSkyInput()).toEqual({ lat: 47.61, lon: -122.33 });

    const actor = await owner();
    const manifest = loadManifestOnly("almanac-moon");
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    const result = unwrap(await callTier1Handle("almanac-moon", manifest.value, actor, {
      ...almanacHostInputs("almanac-moon"),
      __now: "2026-03-20T12:00:00.000",
    }));
    expect(result.data).toMatchObject({ phase: expect.any(String), illumination: expect.any(Number), sunrise: expect.any(String), sunset: expect.any(String) });
    expect(result.reply?.text).not.toContain("Private area label");
    expect(result.reply?.text).not.toContain("47.61");
    expect(result.reply?.text).not.toContain("-122.33");
  }, 15_000);

  test.skipIf(!HAS_DENO)("with no home place or no geo the host passes null and the reply stays normal", async () => {
    const actor = await owner();
    const manifest = loadManifestOnly("almanac-moon");
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    for (const geo of [undefined, { lat: 47.6, lon: -122.3, precision: "exact" as const, area: "No name", from: "search" as const }]) {
      resetDb();
      if (geo) seedHome(undefined);
      expect(householdHomeSkyInput()).toBeNull();
      const inputs = almanacHostInputs("almanac-moon");
      expect(inputs.__home_sky).toBeNull();
      const result = unwrap(await callTier1Handle("almanac-moon", manifest.value, actor, { ...inputs, __now: "2026-03-20T12:00:00.000" }));
      expect(result.reply?.text).toContain("An owner or admin can set the home place in Settings.");
      expect(result.reply?.text).toContain("The moon is in its");
    }
  }, 15_000);

  test("almanac-moon receives __home_sky and no other package does", () => {
    seedHome({ lat: 47.60621, lon: -122.33207, precision: "exact", area: "Private area label", from: "search" });
    const moon = almanacHostInputs("almanac-moon");
    const time = almanacHostInputs("almanac-time");
    const holiday = almanacHostInputs("almanac-holiday");
    expect(moon.__home_sky).toEqual({ lat: 47.61, lon: -122.33 });
    expect(Object.hasOwn(moon, "__home_country")).toBe(false);
    expect(Object.hasOwn(time, "__home_sky")).toBe(false);
    expect(Object.hasOwn(holiday, "__home_sky")).toBe(false);
    expect(Object.hasOwn(time, "__home_country")).toBe(false);
    expect(Object.hasOwn(holiday, "__home_country")).toBe(true);
    expect(Object.hasOwn(time, "__now")).toBe(true);
    expect(Object.hasOwn(holiday, "__now")).toBe(true);
  });

  test("the almanac-moon manifest has no net permission, no data source row and no cache block", () => {
    const manifest = JSON.parse(readPackageFile("manifest.json"));
    expect(manifest.version).toBe("0.2.0");
    expect(manifest.offline).toBe("full");
    expect(manifest.permissions).toEqual([]);
    expect(manifest.data_sources).toEqual([]);
    expect(Object.hasOwn(manifest, "cache")).toBe(false);
    expect(manifest.routing.patterns).toEqual([
      "what phase is the moon in",
      "what's the moon phase tonight",
      "tell me the moon phase",
    ]);
    expect(manifest.routing.examples).toContain("when is sunrise tomorrow");
    expect(manifest.routing.examples).toContain("what time does the sun set tonight");
  });

  test("result.schema.json accepts the old phase object and the additive result", () => {
    const schema = JSON.parse(readPackageFile("result.schema.json"));
    const validate = ajv.compile(schema);
    expect(validate({ phase: "Full Moon" })).toBe(true);
    expect(validate({ phase: "Full Moon", illumination: 0.5, next_full_moon: "2026-10-26", next_new_moon: "2026-11-09", sunrise: "07:12", sunset: null })).toBe(true);
    expect(validate({ phase: "Full Moon", illumination: 1.1 })).toBe(false);
  });
});
