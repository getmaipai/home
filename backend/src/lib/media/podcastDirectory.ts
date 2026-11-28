// PODCAST-PORT-01: finding new shows. Apple's public podcast directory (iTunes Search, the Apple top list and its lookup) is read by the
// hub on a person's request only, never in the background. Every request goes through the shared net bucket (a person's pace), a refusal
// pauses the directory for an hour, and nothing about the household is sent but the search words. Who may use it is decided here.
import { tryConsume } from "@/lib/rateLimiter";

export interface DirectoryShow { id: string; title: string; author: string; feed_url: string; art: string | null; genre: string | null; genre_id?: string; explicit: boolean }
export type DirectoryResult = { ok: true; shows: DirectoryShow[] } | { ok: false; status: 502; error: string };
export interface DirectoryDeps { fetch?: typeof fetch; nowMs?: () => number }

const BUCKET = "net:podcast-directory:itunes.apple.com";
const PACE = { capacity: 5, refillPerSecond: 1 / 3 } as const;
const PAUSE_MS = 60 * 60 * 1000;
const DOWN = "The podcast directory did not answer. Try again in a few minutes.";
const MAX_RESULTS = 25;

/** Apple podcast genre ids used by the public directory charts. */
export const PODCAST_GENRES = [
  { id: "1301", name: "Arts" }, { id: "1302", name: "Design" }, { id: "1303", name: "Comedy" }, { id: "1304", name: "Education" },
  { id: "1305", name: "Kids & Family" }, { id: "1306", name: "Leisure" }, { id: "1307", name: "Health & Fitness" }, { id: "1309", name: "TV & Film" },
  { id: "1310", name: "Music" }, { id: "1311", name: "News" }, { id: "1314", name: "Religion & Spirituality" },
  { id: "1315", name: "Science" }, { id: "1316", name: "Sports" }, { id: "1318", name: "Technology" },
  { id: "1321", name: "Business" }, { id: "1323", name: "Games" }, { id: "1324", name: "Society & Culture" },
  { id: "1325", name: "Government" }, { id: "1329", name: "History" }, { id: "1489", name: "Fiction" },
] as const;

let pausedUntil = 0;
const CACHE_MS = 15 * 60 * 1000;
/** A failed lookup is retried soon: one blocked or slow call must not blank the front page for the full cache time. */
const FAILURE_CACHE_MS = 20 * 1000;
const cache = new Map<string, { until: number; result: DirectoryResult }>();
// Feed addresses are usable for previews only after Apple returned them in a result.
const approvedFeeds = new Map<string, { until: number; show: DirectoryShow }>();
export function __resetDirectoryForTests(): void { pausedUntil = 0; cache.clear(); approvedFeeds.clear(); }

export function directoryShowForFeed(address: string, now = Date.now()): DirectoryShow | null {
  const approved = approvedFeeds.get(address);
  if (!approved || approved.until <= now) { approvedFeeds.delete(address); return null; }
  return approved.show;
}

function rememberShows(shows: DirectoryShow[], now: number): void {
  for (const show of shows) approvedFeeds.set(show.feed_url, { show, until: now + CACHE_MS });
}

/** The household switches and the person's band decide; a child never reaches the directory. */
export function directoryAllowed(person: { band: "adult" | "teen" | "child" }, switches: { enabled: boolean; teens: boolean }): boolean {
  if (!switches.enabled) return false;
  if (person.band === "adult") return true;
  if (person.band === "teen") return switches.teens;
  return false;
}

export function podcastDirectoryStatus(person: { band: "adult" | "teen" | "child" }, switches: { enabled: boolean; teens: boolean }): { allowed: boolean; note?: string } {
  const allowed = directoryAllowed(person, switches);
  if (allowed) return { allowed };
  if (person.band === "child") return { allowed };
  return { allowed, note: "Online podcast search is off. An admin can turn it on in Settings → Podcasts → Find podcasts online." };
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const https = (address: string): string => address.replace(/^http:\/\//i, "https://");
const artOrNull = (value: unknown): string | null => { const art = https(text(value)); return art.startsWith("https://") ? art : null; };

async function get(address: string, deps: DirectoryDeps): Promise<unknown | null> {
  const now = deps.nowMs?.() ?? Date.now();
  if (now < pausedUntil) return null;
  if (!tryConsume(BUCKET, PACE, now)) return null;
  try {
    const response = await (deps.fetch ?? fetch)(address, { method: "GET", headers: { "User-Agent": "MaiPai-Home", Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000) });
    if (response.status === 403 || response.status === 429 || response.status >= 500) { pausedUntil = now + PAUSE_MS; console.warn(`[podcast-directory] paused one hour: status ${response.status}`); return null; }
    if (response.status !== 200) { console.warn(`[podcast-directory] unexpected status ${response.status}`); return null; }
    return await response.json();
  } catch (err) {
    console.warn(`[podcast-directory] request failed: ${err instanceof Error ? err.name : "error"}`);
    return null;
  }
}

function showOf(row: Record<string, unknown>): DirectoryShow | null {
  const feed = https(text(row.feedUrl));
  const title = text(row.collectionName);
  const id = row.collectionId !== undefined ? String(row.collectionId) : "";
  if (!feed.startsWith("https://") || title === "" || id === "") return null;
  return { id, title, author: text(row.artistName), feed_url: feed, art: artOrNull(row.artworkUrl600 ?? row.artworkUrl100), genre: text(row.primaryGenreName) || null, genre_id: typeof row.primaryGenreId === "number" || typeof row.primaryGenreId === "string" ? String(row.primaryGenreId) : undefined, explicit: row.collectionExplicitness === "explicit" };
}

export async function searchDirectory(term: string, deps: DirectoryDeps = {}): Promise<DirectoryResult> {
  const words = term.trim().slice(0, 80);
  if (words.length < 2) return { ok: true, shows: [] };
  const now = deps.nowMs?.() ?? Date.now();
  const key = `search:${words.toLocaleLowerCase()}`;
  const cached = cache.get(key);
  if (cached && cached.until > now) { if (cached.result.ok) rememberShows(cached.result.shows, now); return cached.result; }
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ media: "podcast", entity: "podcast", limit: String(MAX_RESULTS), term: words })}`;
  const body = (await get(url, deps)) as { results?: unknown } | null;
  if (!body || !Array.isArray(body.results)) {
    const result: DirectoryResult = { ok: false, status: 502, error: DOWN };
    cache.set(key, { until: now + FAILURE_CACHE_MS, result });
    return result;
  }
  const result: DirectoryResult = { ok: true, shows: (body.results as Array<Record<string, unknown>>).map(showOf).filter((show): show is DirectoryShow => show !== null) };
  rememberShows(result.shows, now);
  cache.set(key, { until: now + CACHE_MS, result });
  return result;
}

/** Apple's top list, then one lookup for the feed addresses (the list carries none). */
export async function topShows(deps: DirectoryDeps = {}): Promise<DirectoryResult> {
  return topShowsForGenre(undefined, deps);
}

/** A chart request for a known Apple genre; cache and network pace are shared with the main chart. */
export async function topShowsForGenre(genreId?: string, deps: DirectoryDeps = {}): Promise<DirectoryResult> {
  const now = deps.nowMs?.() ?? Date.now();
  const cacheKey = genreId ? `top:${genreId}` : "top";
  const cached = cache.get(cacheKey);
  if (cached && cached.until > now) { if (cached.result.ok) rememberShows(cached.result.shows, now); return cached.result; }
  const chartUrl = genreId
    ? `https://rss.marketingtools.apple.com/api/v2/us/podcast-genres/${genreId}/podcasts/top/${MAX_RESULTS}/podcasts.json`
    : `https://rss.marketingtools.apple.com/api/v2/us/podcasts/top/${MAX_RESULTS}/podcasts.json`;
  const list = (await get(chartUrl, deps)) as { feed?: { results?: Array<Record<string, unknown>> } } | null;
  const entries = list?.feed?.results;
  if (!Array.isArray(entries) || entries.length === 0) {
    const result: DirectoryResult = { ok: false, status: 502, error: DOWN };
    cache.set(cacheKey, { until: now + FAILURE_CACHE_MS, result });
    return result;
  }
  const ids = entries.map((entry) => text(entry.id)).filter((id) => /^\d+$/.test(id));
  const looked = (await get(`https://itunes.apple.com/lookup?${new URLSearchParams({ id: ids.join(",") })}`, deps)) as { results?: Array<Record<string, unknown>> } | null;
  const feeds = new Map<string, string>();
  for (const row of looked?.results ?? []) if (row.collectionId !== undefined && text(row.feedUrl) !== "") feeds.set(String(row.collectionId), https(text(row.feedUrl)));
  const shows: DirectoryShow[] = [];
  for (const entry of entries) {
    const id = text(entry.id);
    const feed = feeds.get(id);
    if (!feed || !feed.startsWith("https://") || text(entry.name) === "") continue;
    const lookupRow = looked?.results?.find((row) => String(row.collectionId ?? "") === id);
    shows.push({ id, title: text(entry.name), author: text(entry.artistName), feed_url: feed, art: artOrNull(entry.artworkUrl100), genre: text(lookupRow?.primaryGenreName) || null, genre_id: lookupRow?.primaryGenreId === undefined ? undefined : String(lookupRow.primaryGenreId), explicit: lookupRow?.collectionExplicitness === "explicit" });
  }
  const result: DirectoryResult = shows.length > 0 ? { ok: true, shows } : { ok: false, status: 502, error: DOWN };
  rememberShows(shows, now);
  cache.set(cacheKey, { until: now + (result.ok ? CACHE_MS : FAILURE_CACHE_MS), result });
  return result;
}

// ---- cover art: the browser may only load pictures from Home itself (img-src 'self'), so a directory cover is fetched here, once checked ----

const ART_BUCKET = "net:podcast-directory-art:mzstatic.com";
const ART_PACE = { capacity: 40, refillPerSecond: 5 } as const;
const MAX_ART_BYTES = 1024 * 1024;
const ART_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Apple's cover addresses carry a size; a list tile needs 200 pixels, not 600. */
export const smallArt = (address: string): string => address.replace(/\/\d+x\d+(?:bb)?\.(jpg|png)$/i, "/200x200bb.$1");

export const artProxyAddress = (art: string | null): string | null => (art ? `/api/plugins/podcasts/directory/art?${new URLSearchParams({ u: smallArt(art) })}` : null);

/** Only https pictures on Apple's own image host, no logins in the address, a real picture type, one megabyte at most. */
export function artAddressOk(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && url.username === "" && url.password === "" && (url.hostname === "mzstatic.com" || url.hostname.endsWith(".mzstatic.com"));
  } catch {
    return false;
  }
}

export async function fetchDirectoryArt(address: string, deps: DirectoryDeps = {}): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!artAddressOk(address)) return null;
  const now = deps.nowMs?.() ?? Date.now();
  if (!tryConsume(ART_BUCKET, ART_PACE, now)) return null;
  try {
    const response = await (deps.fetch ?? fetch)(address, { method: "GET", headers: { "User-Agent": "MaiPai-Home", Accept: "image/*" }, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: AbortSignal.timeout(8000) });
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (response.status !== 200 || !ART_TYPES.has(type)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_ART_BYTES ? { bytes, type } : null;
  } catch {
    return null;
  }
}
