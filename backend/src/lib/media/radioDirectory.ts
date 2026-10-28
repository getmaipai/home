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
const MAX_RESULTS = 30;

let pausedUntil = 0;
export function __resetRadioDirectoryForTests(): void { pausedUntil = 0; }

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

export async function findStations(query: RadioQuery, deps: RadioDeps = {}): Promise<RadioResult> {
  const now = deps.nowMs?.() ?? Date.now();
  if (query.kind === "search" && !query.name?.trim() && !query.country?.trim() && !query.tag?.trim()) return { ok: true, stations: [] };
  if (now < pausedUntil) return { ok: false, status: 502, error: DOWN };
  const path = pathOf(query);
  for (const host of HOSTS) {
    if (!tryConsume(BUCKET, PACE, now)) return { ok: false, status: 502, error: DOWN };
    try {
      const response = await (deps.fetch ?? fetch)(`https://${host}${path}`, { method: "GET", headers: { "User-Agent": "MaiPai-Home", Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000) });
      if (response.status !== 200) { console.warn(`[radio-directory] ${host}: status ${response.status}`); continue; }
      const body = await response.json();
      if (!Array.isArray(body)) continue;
      return { ok: true, stations: (body as Array<Record<string, unknown>>).map(stationOf).filter((station): station is DirectoryStation => station !== null) };
    } catch (err) {
      console.warn(`[radio-directory] ${host}: ${err instanceof Error ? err.name : "error"}`);
    }
  }
  pausedUntil = now + PAUSE_MS;
  console.warn("[radio-directory] paused one hour: every mirror refused");
  return { ok: false, status: 502, error: DOWN };
}
