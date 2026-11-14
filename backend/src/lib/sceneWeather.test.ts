import { afterEach, describe, expect, mock, test } from "bun:test";

let pluginCalls = 0;
let pluginImpl: (...args: unknown[]) => Promise<unknown> = async () => ({ ok: true, value: { data: { temperature: 61, unit: "fahrenheit", conditions: "Clear", block_detail_wind_speed: 4, block_detail_precipitation: 0 } } });
mock.module("@/lib/places", () => ({
  householdHomePlaceName: () => "Home",
  resolveWeatherPlace: async () => ({ place: "Home", hostInputs: { latitude: 40, longitude: -73 }, uncached: false }),
}));
mock.module("@/lib/plugins", () => ({ runPlugin: (...args: unknown[]) => { pluginCalls++; return pluginImpl(...args); } }));

const { fetchSceneWeather, fetchSceneWeatherForContext } = await import("@/lib/sceneWeather");
const { clearWeatherCues, getWeatherCue, sceneForTests } = await import("@/lib/scene");
import type { WeatherCue } from "@/lib/scene";
const { renderScene } = await import("@/lib/turnMachine/nodes/context");
const actor = { id: "person-weather-test", role: "adult" } as never;
const input = (conversationId: string, now = Date.now()) => ({ conversationId, actor, band: "adult" as const, now });

afterEach(() => { clearWeatherCues(); pluginCalls = 0; pluginImpl = async () => ({ ok: true, value: { data: { temperature: 61, unit: "fahrenheit", conditions: "Clear", block_detail_wind_speed: 4, block_detail_precipitation: 0 } } }); });

describe("scene weather context budget", () => {
  test("a slow lookup does not delay context and fills cache for the next turn", async () => {
    pluginImpl = async () => { await new Promise((resolve) => setTimeout(resolve, 2000)); return { ok: true, value: { data: { temperature: 61, unit: "fahrenheit", conditions: "Clear", block_detail_wind_speed: 4 } } }; };
    const started = Date.now();
    expect(await fetchSceneWeatherForContext(input("slow-weather"), 250)).toBeNull();
    expect(Date.now() - started).toBeLessThan(300);
    expect(renderScene(sceneForTests({ conversation_id: "slow-weather" }), Date.now(), actor, [actor])).not.toContain("Weather here:");
    await new Promise((resolve) => setTimeout(resolve, 1850));
    const cached = getWeatherCue("slow-weather", { lat: 40, lon: -73 }, "home", Date.now());
    expect(cached).not.toBeNull();
    const cue = cached as WeatherCue;
    expect(await fetchSceneWeatherForContext(input("slow-weather"))).toEqual(cue);
    expect(renderScene(sceneForTests({ conversation_id: "slow-weather", weather: cue }), Date.now(), actor, [actor])).toContain("Weather here:");
    expect(pluginCalls).toBe(1);
  });

  test("a rejected fetch is swallowed and cached as a failure", async () => {
    pluginImpl = async () => { throw new Error("private failure detail"); };
    await expect(fetchSceneWeatherForContext(input("failed-weather"))).resolves.toBeNull();
    expect(getWeatherCue("failed-weather", { lat: 40, lon: -73 }, "home", Date.now())).toBe(false);
    expect(await fetchSceneWeather(input("failed-weather"))).toBeNull();
    expect(pluginCalls).toBe(1);
  });

  test("an instant lookup is rendered in the same context", async () => {
    const result = await fetchSceneWeatherForContext(input("instant-weather"));
    expect(result).toMatchObject({ temp_f: 61, sky: "Clear" });
    expect(pluginCalls).toBe(1);
  });
});
