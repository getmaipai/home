import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { owner, teen } from "./support/testAuth";
import { __setWeatherAlertsFetcherForTests, __resetWeatherAlertsForTests } from "@/lib/weatherAlerts";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { dismiss, __resetForTests } from "@/lib/sceneSuppression";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

const alertId = "https://api.weather.gov/alerts/test-alert";
const ends = "2026-11-15T00:00:00.000Z";
const props = { event: "Severe Thunderstorm Warning", headline: "Severe storms expected", severity: "Severe", areaDesc: "Private County, Private State", ends };
const feed = (id = alertId, properties = props) => new Response(JSON.stringify({ features: [{ id, properties }] }), { status: 200 });
const fetcher = (response: Response = feed()) => (async () => response.clone()) as unknown as typeof fetch;

async function usHome(client: TestClient) {
  const created = await client.post("/api/entities", { kind: "place", place_kind: "map", name: "Home", scope: "household", geo: { lat: 47.6, lon: -122.3, precision: "exact", area: "Seattle, Washington, US", from: "typed" } });
  const home = await created.json() as { id: string };
  expect((await client.put("/api/settings", { scope: "household", key: "household.home", value: home.id })).status).toBe(200);
}

beforeEach(async () => { await resetDb(); __resetWeatherAlertsForTests(); __resetRateLimiterForTests(); __resetForTests(); });
afterEach(() => { __setWeatherAlertsFetcherForTests(null); __resetWeatherAlertsForTests(); __resetRateLimiterForTests(); __resetForTests(); setHouseholdSettingValue("weather.alerts", false); });

describe("scene weather alerts routes", () => {
  test("requires a session for list and resume", async () => {
    const anon = new TestClient();
    expect((await anon.get("/api/scene/alerts")).status).toBe(401);
    expect((await anon.post(`/api/scene/alerts/${encodeURIComponent(alertId)}/resume`)).status).toBe(401);
  });

  test("returns a compact alert without coordinates, person ids, or area text", async () => {
    const { client, row } = await owner();
    await usHome(client);
    setHouseholdSettingValue("weather.alerts", true);
    __setWeatherAlertsFetcherForTests(fetcher());
    const response = await client.get("/api/scene/alerts");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([{ id: alertId, event: props.event, severity: "severe", headline: props.headline, ends, dismissed: "none" }]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/47\.6|-122\.3|Seattle|Washington|Private County|Private State/);
    expect(serialized).not.toContain(row.id);
  });

  test("non-US home and disabled alerts do not call NWS", async () => {
    const { client } = await owner();
    const created = await client.post("/api/entities", { kind: "place", place_kind: "map", name: "Home", scope: "household", geo: { lat: 51.5, lon: -0.1, precision: "exact", area: "London, UK", from: "typed" } });
    const home = await created.json() as { id: string };
    await client.put("/api/settings", { scope: "household", key: "household.home", value: home.id });
    let calls = 0;
    __setWeatherAlertsFetcherForTests((async () => { calls++; return feed(); }) as unknown as typeof fetch);
    setHouseholdSettingValue("weather.alerts", true);
    expect(await (await client.get("/api/scene/alerts")).json()).toEqual([]);
    expect(calls).toBe(0);
    await usHome(client);
    setHouseholdSettingValue("weather.alerts", false);
    expect(await (await client.get("/api/scene/alerts")).json()).toEqual([]);
    expect(calls).toBe(0);
  });

  test("excludes expired alerts", async () => {
    const { client } = await owner();
    await usHome(client);
    setHouseholdSettingValue("weather.alerts", true);
    __setWeatherAlertsFetcherForTests(fetcher(feed(alertId, { ...props, ends: "2000-01-01T00:00:00Z" })));
    expect(await (await client.get("/api/scene/alerts")).json()).toEqual([]);
  });

  test("dismissals are scoped to person and alert id, with household holds shared", async () => {
    const { client: ownerClient, row: adult } = await owner();
    const secondClient = await teen(ownerClient);
    const second = db.select().from(people).where(eq(people.displayName, "Bramble")).get()!;
    await usHome(ownerClient);
    setHouseholdSettingValue("weather.alerts", true);
    __setWeatherAlertsFetcherForTests((async () => new Response(JSON.stringify({ features: [
      { id: alertId, properties: props }, { id: "new-alert-id", properties: props },
    ] }), { status: 200 })) as unknown as typeof fetch);
    const end = Date.parse(ends);
    dismiss({ kind: "weather_alert", scope: "self", personId: adult.id, refId: alertId, reason: "handled", now: Date.now(), untilOverrideMs: end, byBand: "adult", byConfirmedAdult: true });
    let adultAlerts = await (await ownerClient.get("/api/scene/alerts")).json() as Array<{ id: string }>;
    expect(adultAlerts.map((a) => a.id)).toEqual(["new-alert-id"]);
    expect((await (await secondClient.get("/api/scene/alerts")).json() as Array<{ id: string }>).map((a) => a.id)).toEqual([alertId, "new-alert-id"]);
    dismiss({ kind: "weather_alert", scope: "household", refId: alertId, reason: "handled", now: Date.now(), untilOverrideMs: end, byBand: "adult", byConfirmedAdult: true });
    expect((await (await secondClient.get("/api/scene/alerts")).json() as Array<{ id: string }>).map((a) => a.id)).toEqual(["new-alert-id"]);
    expect(second.id).toBeTruthy();
  });

  test("uses one upstream request inside the five minute cache window", async () => {
    const { client } = await owner();
    await usHome(client);
    setHouseholdSettingValue("weather.alerts", true);
    let calls = 0;
    __setWeatherAlertsFetcherForTests((async () => { calls++; return feed(); }) as unknown as typeof fetch);
    await client.get("/api/scene/alerts");
    await client.get("/api/scene/alerts");
    expect(calls).toBe(1);
  });

  test("resume clears the person's hold and reports when none exists", async () => {
    const { client, row } = await owner();
    await usHome(client);
    setHouseholdSettingValue("weather.alerts", true);
    __setWeatherAlertsFetcherForTests(fetcher());
    dismiss({ kind: "weather_alert", scope: "self", personId: row.id, refId: alertId, reason: "handled", now: Date.now(), untilOverrideMs: Date.parse(ends), byBand: "adult", byConfirmedAdult: true });
    expect(await (await client.get("/api/scene/alerts")).json()).toEqual([]);
    expect(await (await client.post(`/api/scene/alerts/${encodeURIComponent(alertId)}/resume`)).json()).toEqual({ resumed: true });
    expect((await client.get("/api/scene/alerts")).status).toBe(200);
    expect(await (await client.post("/api/scene/alerts/no-hold/resume")).json()).toEqual({ resumed: false });
  });
});
