// WEATHER-PORT-05: NWS alerts are an optional household connection, off by default.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const WEATHER_ALERTS_KEY = "weather.alerts";

export const WEATHER_SETTINGS_KEYS: SettingsKey[] = [SettingsKey.parse({
  key: WEATHER_ALERTS_KEY, scope: "household", selector: "boolean", default: false,
  label: "Show weather alerts",
  help: "When on, Home checks active US weather alerts for the place being viewed. It sends coordinates rounded to the same precision as Weather, no more than once every five minutes. No request is made when this is off.",
  level: "advanced", secret: false, lives_in: "household.weather", honoured_by: ["home"],
})];
