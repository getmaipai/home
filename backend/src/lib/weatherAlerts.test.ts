import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../../tests/reset-db";
import { db } from "@/db";
import { notificationDeliveries } from "@/db/schema";
import { __setWeatherAlertsFetcherForTests, notifyWeatherAlertsForHome } from "@/lib/weatherAlerts";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { listPending, trigger } from "@/lib/notifications";
import { registerPackageNotificationTypes } from "@/lib/notificationTypes";
import { owner } from "../../tests/support/testAuth";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetWeatherAlertsForTests, weatherAlerts } from "@/lib/weatherAlerts";

const feature = { id: "https://api.weather.gov/alerts/urn:oid:one", properties: { event: "Flood Warning", headline: "Flooding is expected", severity: "Severe", areaDesc: "King County", ends: "2026-10-28T20:00:00-07:00" } };
const weatherNotifications = { id: "weather", notifications: [{ id: "weather.alert", level: "time_sensitive" as const, audience: "household" as const, template: "{event}: {headline}", configurable: true, default_channels: ["in_app"] as const }] };
beforeEach(async () => { await resetDb(); registerPackageNotificationTypes(weatherNotifications); __resetWeatherAlertsForTests(); __resetRateLimiterForTests(); });
afterEach(() => { __resetWeatherAlertsForTests(); __resetRateLimiterForTests(); setHouseholdSettingValue("weather.alerts", false); __setWeatherAlertsFetcherForTests(null); });

describe("WEATHER-PORT-05 alerts", () => {
  test("fixture alert JSON becomes a compact banner payload", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ features: [feature] }), { status: 200 })) as unknown as typeof fetch;
    expect(await weatherAlerts(47.6, -122.3, { fetch: fetcher, nowMs: () => 1000 })).toEqual([{ id: "https://api.weather.gov/alerts/urn:oid:one", event: "Flood Warning", headline: "Flooding is expected", severity: "Severe", area: "King County", ends: "2026-10-28T20:00:00-07:00" }]);
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
  test("home polling notifies once per alert id and stores repeat keys durably", async () => {
    registerPackageNotificationTypes(weatherNotifications);
    await owner();
    setHouseholdSettingValue("weather.alerts", true);
    expect(getHouseholdSettingValue("weather.alerts")).toBe(true);
    const feed = (ids: string[]) => (async () => new Response(JSON.stringify({ features: ids.map((id, index) => ({ id, properties: { event: `Alert ${index + 1}`, headline: `Headline ${index + 1}`, areaDesc: "Sensitive place" } })) }), { status: 200 })) as unknown as typeof fetch;
    __setWeatherAlertsFetcherForTests(feed(["alert-1"]));
    await notifyWeatherAlertsForHome({ lat: 47.6, lon: -122.3 });
    await notifyWeatherAlertsForHome({ lat: 47.6, lon: -122.3 });
    expect(db.select().from(notificationDeliveries).all().filter((item) => item.typeId === "weather.alert").map((item) => item.repeatKey)).toEqual(["alert-1"]);
    __setWeatherAlertsFetcherForTests(feed(["alert-1", "alert-2"]));
    __resetWeatherAlertsForTests();
    __resetRateLimiterForTests();
    await notifyWeatherAlertsForHome({ lat: 47.6, lon: -122.3 });
    expect(db.select().from(notificationDeliveries).all().filter((item) => item.typeId === "weather.alert").map((item) => item.repeatKey)).toEqual(["alert-1", "alert-2"]);
  });
  test("the switch off makes no request and raises nothing", async () => {
    let calls = 0;
    __setWeatherAlertsFetcherForTests((async () => { calls++; return new Response(JSON.stringify({ features: [feature] }), { status: 200 }); }) as unknown as typeof fetch);
    setHouseholdSettingValue("weather.alerts", false);
    await notifyWeatherAlertsForHome({ lat: 47.6, lon: -122.3 });
    expect(calls).toBe(0);
    expect(db.select().from(notificationDeliveries).all().filter((item) => item.typeId === "weather.alert")).toHaveLength(0);
  });
});
