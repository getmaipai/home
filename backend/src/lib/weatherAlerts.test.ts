import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetWeatherAlertsForTests, weatherAlerts } from "@/lib/weatherAlerts";

const feature = { properties: { event: "Flood Warning", headline: "Flooding is expected", severity: "Severe", areaDesc: "King County", ends: "2026-10-28T20:00:00-07:00" } };
beforeEach(() => { __resetWeatherAlertsForTests(); __resetRateLimiterForTests(); });
afterEach(() => { __resetWeatherAlertsForTests(); __resetRateLimiterForTests(); });

describe("WEATHER-PORT-05 alerts", () => {
  test("fixture alert JSON becomes a compact banner payload", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ features: [feature] }), { status: 200 })) as unknown as typeof fetch;
    expect(await weatherAlerts(47.6, -122.3, { fetch: fetcher, nowMs: () => 1000 })).toEqual([{ event: "Flood Warning", headline: "Flooding is expected", severity: "Severe", area: "King County", ends: "2026-10-28T20:00:00-07:00" }]);
  });
  test("non-US coordinates never fetch", async () => {
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await weatherAlerts(51.5, -0.1, { fetch: fetcher, nowMs: () => 1000 })).toEqual([]);
    expect(calls).toBe(0);
  });
  test("the first 403 backs off", async () => {
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response("{}", { status: 403 }); }) as unknown as typeof fetch;
    await weatherAlerts(47.6, -122.3, { fetch: fetcher, nowMs: () => 1000 });
    await weatherAlerts(40.7, -74, { fetch: fetcher, nowMs: () => 1001 });
    expect(calls).toBe(1);
  });
  test("same coordinate is cached for five minutes", async () => {
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response(JSON.stringify({ features: [feature] }), { status: 200 }); }) as unknown as typeof fetch;
    await weatherAlerts(47.6, -122.3, { fetch: fetcher, nowMs: () => 1000 });
    await weatherAlerts(47.6, -122.3, { fetch: fetcher, nowMs: () => 1000 + 299_999 });
    expect(calls).toBe(1);
  });
});
