// RADIO-02: finding radio stations. The public Radio Browser directory (three mirrors) is read by the hub on a person's request only,
// never in the background. Every request goes through the shared net bucket (a person's pace); a mirror that refuses is skipped, and
// when every mirror refuses the directory pauses for an hour. Nothing about the household is sent but the search words.
import { tryConsume } from "@/lib/rateLimiter";

export interface DirectoryStation {
  id: string;
  name: string;
  url: string;
  favicon: string | null;
  tags: string[];
  country_code: string | null;
  codec: string | null;
  bitrate_kbps: number | null;
  language?: string | null;
  homepage?: string | null;
  /** HLS playlists are listed but not playable yet (RADIO-06). */
  hls: boolean;
}
export type RadioResult = { ok: true; stations: DirectoryStation[] } | { ok: false; status: 502; error: string };
export interface RadioDeps { fetch?: typeof fetch; nowMs?: () => number }
export type RadioQuery = { kind: "popular" } | { kind: "search"; name?: string; country?: string; tag?: string };

const HOSTS = ["de1.api.radio-browser.info", "nl1.api.radio-browser.info", "at1.api.radio-browser.info"] as const;
const BUCKET = "net:radio-directory:radio-browser.info";
const PACE = { capacity: 5, refillPerSecond: 1 / 3 } as const;
const PAUSE_MS = 60 * 60 * 1000;
const DOWN = "The radio directory did not answer. Try again in a few minutes.";
const MAX_RESULTS = 24;
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; stations: DirectoryStation[] }>();
const inFlight = new Map<string, Promise<RadioResult>>();
const knownFaviconAddresses = new Set<string>();
// A directory result is short-lived authority to preview that exact station, scoped to its household.
const previewable = new Map<string, { expiresAt: number; stations: Map<string, DirectoryStation> }>();

let pausedUntil = 0;
export function __resetRadioDirectoryForTests(): void { pausedUntil = 0; cache.clear(); inFlight.clear(); knownFaviconAddresses.clear(); previewable.clear(); }
export function rememberPreviewStations(householdId: string, stations: readonly DirectoryStation[], now = Date.now()): void {
  previewable.set(householdId, { expiresAt: now + 10 * 60_000, stations: new Map(stations.map((station) => [station.id, station])) });
}
export function previewStationFor(householdId: string, id: string, now = Date.now()): DirectoryStation | null {
  const entry = previewable.get(householdId);
  if (!entry || entry.expiresAt <= now) { previewable.delete(householdId); return null; }
  return entry.stations.get(id) ?? null;
}
export function radioDirectoryHasFavicon(address: string): boolean { return knownFaviconAddresses.has(address); }
export function __rememberRadioFaviconForTests(address: string): void { knownFaviconAddresses.add(address); }

/** The household switch and the person's band decide; a child never reaches the directory (a parent saves stations for them). */
export function radioDirectoryAllowed(person: { band: "adult" | "teen" | "child" }, enabled: boolean): boolean {
  return enabled && (person.band === "adult" || person.band === "teen");
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const secure = (address: string): string => address.replace(/^http:\/\//i, "https://");

export function stationOf(row: Record<string, unknown>): DirectoryStation | null {
  const id = text(row.stationuuid);
  const name = text(row.name);
  const url = text(row.url_resolved) || text(row.url);
  if (id === "" || name === "" || !/^https?:\/\//i.test(url)) return null;
  const favicon = secure(text(row.favicon));
  const bitrate = typeof row.bitrate === "number" && row.bitrate > 0 ? Math.round(row.bitrate) : null;
  const country = text(row.countrycode).toUpperCase();
  return {
    id,
    name,
    url,
    favicon: favicon.startsWith("https://") ? favicon : null,
    tags: text(row.tags).split(",").map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== "").slice(0, 8),
    country_code: /^[A-Z]{2}$/.test(country) ? country : null,
    codec: text(row.codec).toLowerCase() || null,
    bitrate_kbps: bitrate,
    language: text(row.language).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 3).join(", ") || null,
    homepage: /^https:\/\//i.test(text(row.homepage)) ? text(row.homepage) : null,
    hls: row.hls === 1 || row.hls === true || /\.m3u8(\?|$)/i.test(url),
  };
}

function pathOf(query: RadioQuery): string {
  if (query.kind === "popular") return `/json/stations/topclick/${MAX_RESULTS}?hidebroken=true`;
  const params = new URLSearchParams({ hidebroken: "true", limit: String(MAX_RESULTS), order: "clickcount", reverse: "true" });
  if (query.name?.trim()) params.set("name", query.name.trim().slice(0, 80));
  const country = (query.country ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) { params.set("countrycode", country); params.set("countrycodeexact", "true"); }
  if (query.tag?.trim()) { params.set("tag", query.tag.trim().toLowerCase().slice(0, 40)); params.set("tagExact", "true"); }
  return `/json/stations/search?${params}`;
}

const cacheKey = (query: RadioQuery): string => JSON.stringify(query.kind === "popular"
  ? { kind: "popular" }
  : { kind: "search", name: query.name?.trim().toLowerCase() ?? "", country: query.country?.trim().toUpperCase() ?? "", tag: query.tag?.trim().toLowerCase() ?? "" });

export async function findStations(query: RadioQuery, deps: RadioDeps = {}): Promise<RadioResult> {
  const now = deps.nowMs?.() ?? Date.now();
  if (query.kind === "search" && !query.name?.trim() && !query.country?.trim() && !query.tag?.trim()) return { ok: true, stations: [] };
  const key = cacheKey(query);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return { ok: true, stations: cached.stations };
  if (now < pausedUntil) return { ok: false, status: 502, error: DOWN };
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = fetchStations(query, deps, now, key);
  inFlight.set(key, request);
  try { return await request; } finally { inFlight.delete(key); }
}

async function fetchStations(query: RadioQuery, deps: RadioDeps, now: number, key: string): Promise<RadioResult> {
  const path = pathOf(query);
  for (const host of HOSTS) {
    if (!tryConsume(BUCKET, PACE, now)) return { ok: false, status: 502, error: DOWN };
    try {
      const response = await (deps.fetch ?? fetch)(`https://${host}${path}`, { method: "GET", headers: { "User-Agent": "MaiPai-Home", Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000) });
      if (response.status !== 200) { console.warn(`[radio-directory] ${host}: status ${response.status}`); continue; }
      const body = await response.json();
      if (!Array.isArray(body)) continue;
      const stations = (body as Array<Record<string, unknown>>).map(stationOf).filter((station): station is DirectoryStation => station !== null);
      // The route binds the result to the calling household immediately after this lookup.
      for (const station of stations) if (station.favicon) knownFaviconAddresses.add(station.favicon);
      cache.set(key, { expiresAt: now + CACHE_MS, stations });
      return { ok: true, stations };
    } catch (err) {
      console.warn(`[radio-directory] ${host}: ${err instanceof Error ? err.name : "error"}`);
    }
  }
  pausedUntil = now + PAUSE_MS;
  console.warn("[radio-directory] paused one hour: every mirror refused");
  return { ok: false, status: 502, error: DOWN };
}
