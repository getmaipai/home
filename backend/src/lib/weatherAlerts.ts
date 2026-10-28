// WEATHER-PORT-05: the one bounded, optional National Weather Service alerts lookup.
import { tryConsume } from "@/lib/rateLimiter";
import { HOME_USER_AGENT } from "@/lib/outbound";
import { trigger } from "@/lib/notifications";
import { getHouseholdSettingValue } from "@/lib/settings";

export interface WeatherAlert { id: string; event: string; headline: string; severity: string; area: string; ends: string | null }
export interface WeatherAlertsDeps { fetch?: typeof fetch; nowMs?: () => number }
const BUCKET = "net:api.weather.gov";
const PACE = { capacity: 1, refillPerSecond: 1 / 300 } as const;
const CACHE_MS = 5 * 60 * 1000;
const BACKOFF_MS = 60 * 60 * 1000;
const cache = new Map<string, { until: number; alerts: WeatherAlert[] }>();
let fetcher: typeof fetch | undefined;
let pausedUntil = 0;
let hasBackedOff = false;

export function __resetWeatherAlertsForTests(): void { cache.clear(); pausedUntil = 0; hasBackedOff = false; }
export function __setWeatherAlertsFetcherForTests(value: typeof fetch | null): void { fetcher = value ?? undefined; }

function text(value: unknown): string { return typeof value === "string" ? value.trim().slice(0, 300) : ""; }
function alertsFrom(body: unknown): WeatherAlert[] {
  const features = body && typeof body === "object" && Array.isArray((body as { features?: unknown }).features) ? (body as { features: unknown[] }).features : [];
  return features.slice(0, 10).flatMap((feature) => {
    if (!feature || typeof feature !== "object") return [];
    const featureRecord = feature as { id?: unknown; properties?: unknown };
    const properties = featureRecord.properties;
    if (!properties || typeof properties !== "object") return [];
    const p = properties as Record<string, unknown>;
    const id = text(featureRecord.id);
    const event = text(p.event); const headline = text(p.headline) || event;
    if (!id || !event || !headline) return [];
    return [{ id, event, headline, severity: text(p.severity) || "Unknown", area: text(p.areaDesc), ends: text(p.ends) || text(p.expires) || null }];
  });
}

/** US bounding box only; no geocoding or place-name request is made here. */
export function isUsAlertCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 17 && lat <= 72 && lon >= -180 && lon <= -60 && !(lat < 25 && lon < -150);
}

export async function weatherAlerts(lat: number, lon: number, deps: WeatherAlertsDeps = {}): Promise<WeatherAlert[]> {
  if (!isUsAlertCoordinate(lat, lon)) return [];
  const now = deps.nowMs?.() ?? Date.now();
  const latitude = Number(lat.toFixed(2)); const longitude = Number(lon.toFixed(2));
  const key = `${latitude},${longitude}`;
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.alerts;
  if (now < pausedUntil || !tryConsume(BUCKET, PACE, now)) return [];
  try {
    const response = await (deps.fetch ?? fetcher ?? fetch)(`https://api.weather.gov/alerts/active?point=${latitude},${longitude}`, {
      method: "GET", headers: { "User-Agent": HOME_USER_AGENT, Accept: "application/geo+json" },
      credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000),
    });
    if ((response.status === 403 || response.status === 429) && !hasBackedOff) { hasBackedOff = true; pausedUntil = now + BACKOFF_MS; return []; }
    if (!response.ok) return [];
    const alerts = alertsFrom(await response.json());
    cache.set(key, { until: now + CACHE_MS, alerts });
    return alerts;
  } catch { return []; }
}

/** Hourly background alert check for the household's configured home place.
 * The switch is checked before any network access; coordinates are never
 * included in notification text or persisted with the notification. */
export async function notifyWeatherAlertsForHome(point: { lat: number; lon: number }): Promise<void> {
  if (getHouseholdSettingValue("weather.alerts") !== true) return;
  const alerts = await weatherAlerts(point.lat, point.lon);
  for (const alert of alerts) {
    await trigger("weather.alert", { event: alert.event, headline: alert.headline }, { repeatKey: alert.id });
  }
}
