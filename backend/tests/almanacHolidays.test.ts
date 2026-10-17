import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildHolidayData, easterSunday, FIRST_YEAR, LAST_YEAR, generatedBytes } from "../scripts/gen-almanac-holidays";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runPlugin, loadManifestOnly } from "@/lib/plugins";
import { householdHomeCountryName } from "@/lib/places";
import { __setPromptClockForBench } from "@/lib/benchSampling";
import { HAS_DENO } from "./support/deno";

const packageDir = join(import.meta.dir, "..", "packages", "almanac-holiday");

describe("yearly holiday data", () => {
  test("Easter Sunday is computed correctly for 2025 to 2030", () => {
    expect([2025, 2026, 2027, 2028, 2029, 2030].map(easterSunday)).toEqual([
      "2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16", "2029-04-01", "2030-04-21",
    ]);
  });

  test("the 2026 US list matches the published federal dates", () => {
    const us = buildHolidayData().years["2026"]!.US;
    expect(us.map(({ name, date }) => [name, date])).toEqual([
      ["New Year's Day", "2026-01-01"], ["Birthday of Martin Luther King, Jr.", "2026-01-19"],
      ["Washington's Birthday", "2026-02-16"], ["Memorial Day", "2026-05-25"],
      ["Juneteenth National Independence Day", "2026-06-19"], ["Independence Day", "2026-07-04"],
      ["Labor Day", "2026-09-07"], ["Columbus Day", "2026-10-12"], ["Veterans Day", "2026-11-11"],
      ["Thanksgiving Day", "2026-11-26"], ["Christmas Day", "2026-12-25"],
    ]);
    expect(us.find((h) => h.name === "Independence Day")?.observed).toBe("2026-07-03");
  });

  test("the 2026 Canada list matches the published federal dates", () => {
    const ca = buildHolidayData().years["2026"]!.CA;
    expect(ca.map(({ name, date }) => [name, date])).toEqual([
      ["New Year's Day", "2026-01-01"], ["Good Friday", "2026-04-03"], ["Victoria Day", "2026-05-18"],
      ["Canada Day", "2026-07-01"], ["Labour Day", "2026-09-07"],
      ["National Day for Truth and Reconciliation", "2026-09-30"], ["Thanksgiving Day", "2026-10-12"],
      ["Remembrance Day", "2026-11-11"], ["Christmas Day", "2026-12-25"], ["Boxing Day", "2026-12-26"],
    ]);
    expect(ca.every((holiday) => !holiday.observed)).toBe(true);
  });

  test("a Monday-before rule never returns the anchor date itself", () => {
    for (const year of [2026, 2027]) {
      const victoria = buildHolidayData().years[String(year)]!.CA.find((h) => h.name === "Victoria Day")!;
      expect(victoria.date < `${year}-05-25`).toBe(true);
    }
  });

  test("the checked-in holidays.json equals a fresh run of the generator, byte for byte", () => {
    expect(readFileSync(join(packageDir, "holidays.json"), "utf8")).toBe(generatedBytes());
  });

  test("running the generator twice gives identical output", () => {
    expect(generatedBytes()).toBe(generatedBytes());
  });

  test("every country's holidays are sorted and have unique dates per name", () => {
    const data = buildHolidayData();
    for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
      for (const holidays of Object.values(data.years[String(year)]!)) {
        expect(holidays.map((h) => h.date)).toEqual([...holidays.map((h) => h.date)].sort());
        expect(new Set(holidays.map((h) => `${h.date}:${h.name}`)).size).toBe(holidays.length);
      }
    }
  });

  test("no holiday rule, date or name lives in handler.ts", () => {
    const source = readFileSync(join(packageDir, "handler.ts"), "utf8");
    expect(source).not.toMatch(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/);
    expect(source).not.toMatch(/(?:New Year's Day|Good Friday|Victoria Day|Canada Day|Thanksgiving Day|Christmas Day)/);
    expect(source).not.toMatch(/\b(?:2026|2027)-\d{2}-\d{2}\b/);
  });
});

describe("holiday host context", () => {
  beforeEach(() => resetDb());
  afterEach(() => __setPromptClockForBench(null));

  async function setupHome(area?: string) {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    if (area) {
      const created = await client.post("/api/entities", {
        kind: "place", place_kind: "map", name: "Household home", scope: "household",
        geo: { lat: 43.65, lon: -79.38, precision: "exact", area, from: "typed" },
      });
      const home = await created.json() as { id: string };
      expect(created.status).toBe(201);
      expect((await client.put("/api/settings", { scope: "household", key: "household.home", value: home.id })).status).toBe(200);
    }
    return { actor, client };
  }

  test("the host passes only the home country's last area segment to almanac-holiday", async () => {
    await setupHome("123 Main St, Toronto, Ontario, Canada");
    expect(householdHomeCountryName()).toBe("Canada");
    const holidaySource = readFileSync(join(import.meta.dir, "..", "src", "lib", "plugins.ts"), "utf8");
    expect(holidaySource).toContain('id === "almanac-holiday" ? { __home_country: householdHomeCountryName() }');
    expect(holidaySource).not.toContain("__home_country: householdHomeCountryName() } : withClock");
  });

  test.skipIf(!HAS_DENO)("a place segment that is not a country stays an exact-match miss", async () => {
    await setupHome("Canada Street, Springfield");
    expect(householdHomeCountryName()).toBe("Springfield");
    __setPromptClockForBench(() => new Date(2026, 6, 2));
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const result = await runPlugin("almanac-holiday", actor, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reply?.text).toContain("set the home place");
      expect(result.value.reply?.text).not.toContain("Canada Street");
    }
  });

  test.skipIf(!HAS_DENO)("with no home place the host passes null and the real sandbox returns a normal reply", async () => {
    const { actor } = await setupHome();
    const loaded = loadManifestOnly("almanac-holiday");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    __setPromptClockForBench(() => new Date(2026, 6, 2));
    const result = await runPlugin("almanac-holiday", actor, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.reply?.text).toContain("set the home place");
  }, 20_000);

  test.skipIf(!HAS_DENO)("real sandbox calls use US and Canadian dates from the host home place", async () => {
    const { actor, client } = await setupHome("Paris, Texas, United States");
    expect(householdHomeCountryName()).toBe("United States");
    const loaded = loadManifestOnly("almanac-holiday");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    __setPromptClockForBench(() => new Date(2026, 5, 30));
    const us = await runPlugin("almanac-holiday", actor, {});
    expect(us.ok).toBe(true);
    if (us.ok) {
      expect(us.value.reply?.text).toContain("Independence Day");
      expect(us.value.data).toEqual({ date: "2026-07-04", name: "Independence Day" });
    }
    const created = await client.post("/api/entities", {
      kind: "place", place_kind: "map", name: "Household home", scope: "household",
      geo: { lat: 43.65, lon: -79.38, precision: "exact", area: "Toronto, Ontario, Canada", from: "typed" },
    });
    const home = await created.json() as { id: string };
    await client.put("/api/settings", { scope: "household", key: "household.home", value: home.id });
    const ca = await runPlugin("almanac-holiday", actor, {});
    expect(ca.ok).toBe(true);
    if (ca.ok) {
      expect(ca.value.reply?.text).toContain("Canada Day");
      expect(ca.value.data).toEqual({ date: "2026-07-01", name: "Canada Day" });
    }
  }, 30_000);

  test("the holiday manifest and generated privacy rows have no Nager connection", () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, "manifest.json"), "utf8"));
    expect(manifest.permissions).toEqual([]);
    expect(manifest.data_sources).toEqual([]);
    expect(manifest).not.toHaveProperty("cache");
    expect(manifest.offline).toBe("full");
  });
});
