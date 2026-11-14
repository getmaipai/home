import type { PersonRow } from "@/types";
import { householdHomePlaceName, resolveWeatherPlace } from "@/lib/places";
import { runPlugin } from "@/lib/plugins";
import { getWeatherCue, setWeatherCue, setWeatherFailure, weatherCacheLease, type WeatherCue, getWeatherAlertCues, setWeatherAlertCues, type WeatherAlertCue } from "@/lib/scene";
import { isUsAlertCoordinate, notifySevereWeatherAlerts, weatherAlerts, weatherAlertsEnabled } from "@/lib/weatherAlerts";
import { isSuppressed } from "@/lib/sceneSuppression";

type SceneWeatherInput = {
  conversationId: string;
  actor: PersonRow;
  band: "child" | "teen" | "adult";
  deviceKind?: string;
  currentLocation?: { lat: number; lon: number } | null;
  now: number;
};

/** Keep scene weather off the model's first-token path while allowing a warm result through. */
export async function fetchSceneWeatherForContext(input: SceneWeatherInput, waitMs = 250): Promise<WeatherCue | null> {
  const fetch = fetchSceneWeather(input).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  try { return await Promise.race([fetch, budget]); }
  finally { if (timer) clearTimeout(timer); }
}

export async function fetchSceneWeatherAlertsForContext(input: SceneWeatherInput, waitMs = 250): Promise<WeatherAlertCue[]> {
  const task = fetchSceneWeatherAlerts(input).catch(() => [] as WeatherAlertCue[]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task, new Promise<WeatherAlertCue[]>((resolve) => { timer = setTimeout(() => resolve([]), waitMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function fetchSceneWeatherAlerts(input: SceneWeatherInput): Promise<WeatherAlertCue[]> {
  if (!weatherAlertsEnabled()) return [];
  const fixed = input.deviceKind === "robot" || input.deviceKind === "pod" || input.deviceKind === "tv";
  const place = await resolveWeatherPlace({ person: fixed ? null : input.actor, current: fixed ? null : input.currentLocation, preferCurrent: !fixed && !!input.currentLocation, band: input.band }).catch(() => null);
  if (!place || typeof place.hostInputs.latitude !== "number" || typeof place.hostInputs.longitude !== "number") return [];
  const point = { lat: place.hostInputs.latitude, lon: place.hostInputs.longitude };
  if (!isUsAlertCoordinate(point.lat, point.lon)) return [];
  const cached = getWeatherAlertCues(input.conversationId, point, input.now);
  if (cached) return cached;
  const fetched = await weatherAlerts(point.lat, point.lon);
  const alerts = fetched.flatMap((alert) => {
    const ends = alert.ends && Number.isFinite(Date.parse(alert.ends)) ? new Date(alert.ends).toISOString() : "";
    if (!alert.id || !alert.event || !ends || Date.parse(ends) <= input.now) return [];
    return [{ id: alert.id, event: alert.event.slice(0, 100), severity: alert.severity.toLowerCase(), headline: alert.headline.trim().slice(0, 200), ends }];
  });
  setWeatherAlertCues(input.conversationId, point, alerts, input.now);
  await notifySevereWeatherAlerts(fetched);
  return alerts.filter((alert) => !isSuppressed({ kind: "weather_alert", personId: input.actor.id, refId: alert.id, now: input.now }));
}


const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const words = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, 48) : null;

/** Read weather through the existing package runner. Coordinates stay in hostInputs and
 * the point used for this short-lived cache never leaves process memory. */
export async function fetchSceneWeather(input: SceneWeatherInput): Promise<WeatherCue | null> {
  const leaseIsCurrent = weatherCacheLease(input.conversationId);
  const fixedDevice = input.deviceKind === "robot" || input.deviceKind === "pod" || input.deviceKind === "tv";
  const place = await resolveWeatherPlace({
    person: fixedDevice ? null : input.actor,
    current: fixedDevice ? null : input.currentLocation,
    preferCurrent: !fixedDevice && !!input.currentLocation,
    band: input.band,
  }).catch(() => null);
  if (!place || typeof place.hostInputs.latitude !== "number" || typeof place.hostInputs.longitude !== "number") return null;
  const point = { lat: place.hostInputs.latitude, lon: place.hostInputs.longitude };
  const source: WeatherCue["source"] = fixedDevice || place.place === householdHomePlaceName() ? "home" : input.currentLocation && place.uncached ? "current" : "saved";
  const cached = getWeatherCue(input.conversationId, point, source, input.now);
  if (cached === false) return null;
  if (cached) return cached;
  try {
    const result = await runPlugin("weather", input.actor, { place: place.place }, { id: `scene-weather-${input.now}`, conversationId: input.conversationId }, {
      hostInputs: { ...place.hostInputs }, uncached: place.uncached, band: input.band,
    });
    if (!result.ok) { if (leaseIsCurrent()) setWeatherFailure(input.conversationId, point, source, input.now); return null; }
    const data = (result.value as { data?: Record<string, unknown> }).data;
    if (!data) { if (leaseIsCurrent()) setWeatherFailure(input.conversationId, point, source, input.now); return null; }
    const temperature = num(data.temperature);
    const wind = num(data.block_detail_wind_speed);
    const sky = words(data.conditions);
    if (temperature === null || wind === null || !sky) { if (leaseIsCurrent()) setWeatherFailure(input.conversationId, point, source, input.now); return null; }
    const rawUnit = data.unit === "celsius" ? "C" : "F";
    const precipitation = num(data.block_detail_precipitation) ?? 0;
    const skyWord = sky.toLowerCase();
    const precipitationWord = skyWord.includes("snow") ? "snow"
      : skyWord.includes("drizzle") ? "drizzle"
        : /rain|showers/.test(skyWord) || precipitation > 0 ? precipitation >= 2.5 ? "heavy rain" : precipitation > 0 ? "light rain" : "rain" : "no precipitation";
    const hourly = Array.isArray(data.block_hour_pop) ? data.block_hour_pop.map(num).filter((n): n is number => n !== null) : [];
    const change = hourly.slice(0, 2).some((n) => n >= 50) ? "rain likely within the hour" : null;
    const cue: WeatherCue = {
      ...(rawUnit === "C" ? { temp_c: temperature } : { temp_f: temperature }), sky, precipitation: precipitationWord, wind_mph: wind * 0.621371,
      change, checked_at: input.now, expires_at: input.now + Math.min(30 * 60_000, change ? 15 * 60_000 : 30 * 60_000), source,
    };
    if (leaseIsCurrent()) setWeatherCue(input.conversationId, cue, point);
    return cue;
  } catch {
    if (leaseIsCurrent()) setWeatherFailure(input.conversationId, point, source, input.now);
    return null;
  }
}
