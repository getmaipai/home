// WEATHER-PORT-05: the one bounded, optional National Weather Service alerts lookup.
import { tryConsume } from "@/lib/rateLimiter";
import { HOME_USER_AGENT } from "@/lib/outbound";
import { trigger } from "@/lib/notifications";
import { getHouseholdSettingSource, getHouseholdSettingValue } from "@/lib/settings";
import { householdHomeSkyInput } from "@/lib/places";
import { db } from "@/db";
import { devices, people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { issueDeviceCommand, listRobotsPairedUnderPerson } from "@/lib/deviceCommands";
import { quietHours } from "@/lib/notifications";
import { speakerAgeBand } from "@/lib/ageBand";
import { evaluateSafety } from "@/lib/safety";
import { weatherAlertDismissal } from "@/lib/sceneSuppression";
import type { PersonRow } from "@/types";

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

export function __resetWeatherAlertsForTests(): void { cache.clear(); pausedUntil = 0; hasBackedOff = false; spokenAlerts.clear(); }
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
  if (!weatherAlertsEnabled()) return;
  const alerts = await weatherAlerts(point.lat, point.lon);
  await notifySevereWeatherAlerts(alerts);
}

export function weatherAlertsEnabled(): boolean {
  const explicit = getHouseholdSettingSource("weather.alerts");
  if (explicit !== undefined) return getHouseholdSettingValue("weather.alerts") === true;
  const home = householdHomeSkyInput();
  return !!home && isUsAlertCoordinate(home.lat, home.lon);
}

const spokenAlerts = new Map<string, number>();
const SPOKEN_ALERT_LIMIT = 500;
const CHILD_ALERT_LINE = "There is a weather warning. Please go to a safe place and find a grown-up.";

function alertTimePhrase(ends: string | null): string | null {
  if (!ends) return null;
  const at = new Date(ends);
  if (!Number.isFinite(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(at).toLowerCase().replace(":00", "");
}

function cleanEvent(event: string): string {
  return event.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/[^\p{L}\p{N} .,!?;:'()\-]/gu, "").trim().slice(0, 60).toLowerCase() || "weather alert";
}

function robotLine(alert: WeatherAlert): string {
  const time = alertTimePhrase(alert.ends);
  if (!time) return "A severe weather alert is in effect here.";
  const text = `A ${cleanEvent(alert.event)} is in effect here until ${time}.`;
  return evaluateSafety(text, "child").flagged ? "A severe weather alert is in effect here." : text;
}

function shouldSpeak(alert: WeatherAlert, robotId: string, severity: string, now: number): boolean {
  for (const [key, expiry] of spokenAlerts) if (expiry <= now) spokenAlerts.delete(key);
  const key = `${alert.id}\u0000${severity}\u0000${robotId}`;
  if (spokenAlerts.has(key)) return false;
  return true;
}

async function announceSevereWeatherAlert(alert: WeatherAlert, severity: string): Promise<void> {
  const now = new Date();
  const endsAt = alertTimePhrase(alert.ends) ? Date.parse(alert.ends!) : now.getTime() + 60 * 60_000;
  const adultTeenLine = robotLine(alert);
  for (const robot of db.select({ id: devices.id, personId: devices.personId }).from(devices).where(eq(devices.kind, "robot")).all()) {
    const owner = db.select().from(people).where(eq(people.id, robot.personId)).get() as PersonRow | undefined;
    if (!owner || !listRobotsPairedUnderPerson(owner.id).includes(robot.id)) continue;
    const band = speakerAgeBand(owner, now);
    if (band === "child" && severity !== "extreme") continue;
    if (weatherAlertDismissal(alert.id, owner.id, now.getTime()) !== "none") continue;
    if (severity !== "extreme" && quietHours(owner, now).active) continue;
    if (!shouldSpeak(alert, robot.id, severity, now.getTime())) continue;
    const text = band === "child" ? CHILD_ALERT_LINE : adultTeenLine;
    const key = `${alert.id}\u0000${severity}\u0000${robot.id}`;
    issueDeviceCommand(robot.id, "announce", { text, urgent: severity === "extreme" });
    if (spokenAlerts.size >= SPOKEN_ALERT_LIMIT) spokenAlerts.delete(spokenAlerts.keys().next().value!);
    // This is intentionally in-memory: a restart may repeat an active alert once.
    spokenAlerts.set(key, endsAt);
  }
}

export async function notifySevereWeatherAlerts(alerts: readonly WeatherAlert[]): Promise<void> {
  if (!weatherAlertsEnabled()) return;
  for (const alert of alerts) {
    const severity = alert.severity.toLowerCase();
    if (!["extreme", "severe"].includes(severity)) continue;
    await trigger("weather.alert", { event: alert.event, headline: alert.headline }, { repeatKey: alert.id });
    await announceSevereWeatherAlert(alert, severity);
  }
}
