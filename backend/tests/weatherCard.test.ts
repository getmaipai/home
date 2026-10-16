// WEATHER-CARD-01: the weather package builds the `weather_card` answer block
// from the one Open-Meteo response its recipe already fetched. The fixtures
// are recorded-shape forecast responses (clear day, rain at night, a response
// with no chance-of-rain fields). The recipe runs against the spec's host
// emulator, the same way the package smoke test does, and the card is checked
// against the contract in this file because the pinned spec carries the card
// only after the pin bump (until then weather returns its older three blocks).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { HostEmulator } from "@maipai/spec/emulators/ts/host-emulator.js";
import { runRecipe } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import { loadPackage } from "@/lib/plugins";
import { blocksForRecipeRun, weatherCard } from "@/lib/packageBlocks";

const Pop = z.number().min(0).max(100).optional();
const CardProps = z.object({
  place: z.string().min(1),
  unit: z.enum(["F", "C"]),
  current: z.object({ temp: z.number(), condition: z.string().min(1), code: z.number().int(), is_day: z.boolean() }).strict(),
  hourly: z.array(z.object({ time: z.string().min(1), temp: z.number(), pop: Pop }).strict()).max(24).optional(),
  daily: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), high: z.number(), low: z.number(), code: z.number().int(), pop: Pop }).strict()).min(1).max(8),
  attribution: z.string().min(1),
}).strict();

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast?latitude=47.6&longitude=-122.3&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=8&forecast_hours=24&timezone=auto&temperature_unit=fahrenheit";

function fixture(name: string): any {
  return JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "weather", `open-meteo-${name}.json`), "utf-8"));
}

async function runWeather(name: string) {
  const loaded = loadPackage("weather");
  if (!loaded.ok) throw new Error(loaded.error);
  const host = new HostEmulator();
  host.setFetchResponse("https://geocoding-api.open-meteo.com/v1/search?count=1&name=Lantern%20Bay", { results: [{ name: "Lantern Bay", latitude: 47.6, longitude: -122.3 }] });
  host.setFetchResponse("https://geocoding-api.open-meteo.com/v1/search?count=1&name=Lantern Bay", { results: [{ name: "Lantern Bay", latitude: 47.6, longitude: -122.3 }] });
  host.setFetchResponse(FORECAST_URL, fixture(name));
  const result = await runRecipe(loaded.value.recipe, { place: "Lantern Bay" }, host);
  const card = weatherCard("weather", "weather result in turn t1", result.data as Record<string, unknown>, loaded.value.manifest.data_sources?.[0]?.attribution);
  return { result, card, manifest: loaded.value.manifest };
}

describe("WEATHER-CARD-01: weather_card from the recipe's one forecast response", () => {
  test("the recipe asks the one permitted host for the card's fields", () => {
    const loaded = loadPackage("weather");
    if (!loaded.ok) throw new Error(loaded.error);
    const fetches = loaded.value.recipe.steps.filter((s: any) => s.op === "fetch") as { url: string }[];
    const q = new URL(fetches[1]!.url.replace("{lat}", "1").replace("{lon}", "2")).searchParams;
    expect(q.get("current")).toBe("temperature_2m,weather_code,is_day");
    expect(q.get("hourly")).toBe("temperature_2m,precipitation_probability");
    expect(q.get("daily")).toBe("weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    expect(q.get("forecast_days")).toBe("8");
    expect(fetches.every((f) => ["geocoding-api.open-meteo.com", "api.open-meteo.com"].includes(new URL(f.url.replace(/\{\w+\}/g, "1")).hostname))).toBe(true);
  });

  test("clear day: 8 daily rows, 24 hours, day flag, F, attribution from the manifest", async () => {
    const { card, manifest } = await runWeather("clear-day");
    expect(card).not.toBeNull();
    expect(card!.kind).toBe("weather_card");
    expect(card!.producer).toBe("weather");
    expect(typeof card!.alt).toBe("string");
    expect(typeof card!.provenance).toBe("string");
    const props = CardProps.parse(card!.props);
    expect(props.place).toBe("Lantern Bay");
    expect(props.unit).toBe("F");
    expect(props.current).toEqual({ temp: 71.6, condition: "clear", code: 0, is_day: true });
    expect(props.daily).toHaveLength(8);
    expect(props.daily[0]).toEqual({ date: "2026-10-16", high: 74.1, low: 55.2, code: 0, pop: 0 });
    expect(props.daily[7]).toEqual({ date: "2026-10-23", high: 68.9, low: 51.7, code: 2, pop: 20 });
    expect(props.hourly).toHaveLength(24);
    expect(props.hourly![0]).toEqual({ time: "2026-10-16T14:00", temp: fixture("clear-day").hourly.temperature_2m[0], pop: 0 });
    expect(props.attribution).toBe(manifest.data_sources![0]!.attribution!);
  });

  test("rain at night: is_day false, rain codes and chances carried through", async () => {
    const { card } = await runWeather("rain-night");
    const props = CardProps.parse(card!.props);
    expect(props.current).toEqual({ temp: 52.3, condition: "rainy", code: 63, is_day: false });
    expect(props.hourly![0]!.pop).toBe(80);
    expect(props.hourly![23]!.pop).toBe(5);
    expect(props.daily.map((d) => d.code)).toEqual([63, 61, 3, 2, 45, 61, 80, 95]);
    expect(props.daily[0]!.pop).toBe(90);
    expect(card!.alt).toContain("rainy");
  });

  test("missing pop: the card is built and carries no pop keys", async () => {
    const { card } = await runWeather("missing-pop");
    const props = CardProps.parse(card!.props);
    expect(props.daily).toHaveLength(3);
    expect(props.daily.every((d) => !("pop" in d))).toBe(true);
    expect(props.hourly!.every((h) => !("pop" in h))).toBe(true);
  });

  test("no current reading or no days gives no card, never a broken one", () => {
    expect(weatherCard("weather", "p", undefined)).toBeNull();
    expect(weatherCard("weather", "p", { place: "X", temperature: 50, conditions: "clear", block_code: 0 })).toBeNull();
    expect(weatherCard("weather", "p", { place: "X", conditions: "clear", block_code: 0, block_day_dates: ["2026-10-16"], block_day_highs: [1], block_day_lows: [0], block_day_codes: [0] })).toBeNull();
  });

  test("more than 24 hours or 8 days is cut to the contract's maximum", () => {
    const hours = Array.from({ length: 30 }, (_, i) => `2026-10-16T${String(i % 24).padStart(2, "0")}:00`);
    const dates = Array.from({ length: 10 }, (_, i) => `2026-10-${16 + i}`);
    const card = weatherCard("weather", "p", {
      place: "X", temperature: 50, conditions: "clear", unit: "fahrenheit", block_code: 0, block_is_day: 1,
      block_hour_times: hours, block_hour_temps: hours.map(() => 50),
      block_day_dates: dates, block_day_highs: dates.map(() => 60), block_day_lows: dates.map(() => 40), block_day_codes: dates.map(() => 1),
    });
    const props = CardProps.parse(card!.props);
    expect(props.hourly).toHaveLength(24);
    expect(props.daily).toHaveLength(8);
  });

  test("until the pinned spec knows the card, the three older blocks are returned and the card is not", async () => {
    const { result, manifest } = await runWeather("clear-day");
    const kinds = (blocksForRecipeRun(manifest, result as any, {}) as { kind: string }[]).map((b) => b.kind);
    // The pin bump (with the manifest's returns_blocks gaining the card) flips this to ["weather_card"]; the sets are never mixed.
    expect(kinds).toEqual(["spec_sheet", "chart", "data_table"]);
  });
});
