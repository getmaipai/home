import { afterEach, beforeEach, expect, test } from "bun:test";
import { privacyConnections } from "@/lib/privacy";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";

beforeEach(async () => { await resetDb(); });
afterEach(() => setHouseholdSettingValue("weather.alerts", false));

test("WEATHER-PORT-05: privacy lists api.weather.gov only while the switch is on", () => {
  expect(privacyConnections().some((row) => row.id === "platform:weather-alerts")).toBe(false);
  setHouseholdSettingValue("weather.alerts", true);
  const row = privacyConnections().find((item) => item.id === "platform:weather-alerts");
  expect(row?.destination).toContain("api.weather.gov");
});
