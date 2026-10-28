// PODCAST-PORT-01: finding new shows. Apple's public podcast directory (iTunes Search, the Apple top list and its lookup) is read by the
// hub on a person's request only, never in the background. Every request goes through the shared net bucket (a person's pace), a refusal
// pauses the directory for an hour, and nothing about the household is sent but the search words. Who may use it is decided here.
import { tryConsume } from "@/lib/rateLimiter";

export interface DirectoryShow { id: string; title: string; author: string; feed_url: string; art: string | null; genre: string | null; explicit: boolean }
export type DirectoryResult = { ok: true; shows: DirectoryShow[] } | { ok: false; status: 502; error: string };
export interface DirectoryDeps { fetch?: typeof fetch; nowMs?: () => number }

const BUCKET = "net:podcast-directory:itunes.apple.com";
const PACE = { capacity: 5, refillPerSecond: 1 / 3 } as const;
const PAUSE_MS = 60 * 60 * 1000;
const DOWN = "The podcast directory did not answer. Try again in a few minutes.";
const MAX_RESULTS = 25;

let pausedUntil = 0;
export function __resetDirectoryForTests(): void { pausedUntil = 0; }

/** The household switches and the person's band decide; a child never reaches the directory. */
export function directoryAllowed(person: { band: "adult" | "teen" | "child" }, switches: { enabled: boolean; teens: boolean }): boolean {
  if (!switches.enabled) return false;
  if (person.band === "adult") return true;
  if (person.band === "teen") return switches.teens;
  return false;
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
    if (response.status === 403 || response.status === 429 || response.status >= 500) { pausedUntil = now + PAUSE_MS; return null; }
    if (response.status !== 200) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function showOf(row: Record<string, unknown>): DirectoryShow | null {
  const feed = https(text(row.feedUrl));
  const title = text(row.collectionName);
  const id = row.collectionId !== undefined ? String(row.collectionId) : "";
  if (!feed.startsWith("https://") || title === "" || id === "") return null;
  return { id, title, author: text(row.artistName), feed_url: feed, art: artOrNull(row.artworkUrl600 ?? row.artworkUrl100), genre: text(row.primaryGenreName) || null, explicit: row.collectionExplicitness === "explicit" };
}

export async function searchDirectory(term: string, deps: DirectoryDeps = {}): Promise<DirectoryResult> {
  const words = term.trim().slice(0, 80);
  if (words.length < 2) return { ok: true, shows: [] };
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ media: "podcast", entity: "podcast", limit: String(MAX_RESULTS), term: words })}`;
  const body = (await get(url, deps)) as { results?: unknown } | null;
  if (!body || !Array.isArray(body.results)) return { ok: false, status: 502, error: DOWN };
  return { ok: true, shows: (body.results as Array<Record<string, unknown>>).map(showOf).filter((show): show is DirectoryShow => show !== null) };
}

/** Apple's top list, then one lookup for the feed addresses (the list carries none). */
export async function topShows(deps: DirectoryDeps = {}): Promise<DirectoryResult> {
  const list = (await get(`https://rss.applemarketingtools.com/api/v2/us/podcasts/top/${MAX_RESULTS}/podcasts.json`, deps)) as { feed?: { results?: Array<Record<string, unknown>> } } | null;
  const entries = list?.feed?.results;
  if (!Array.isArray(entries) || entries.length === 0) return { ok: false, status: 502, error: DOWN };
  const ids = entries.map((entry) => text(entry.id)).filter((id) => /^\d+$/.test(id));
  const looked = (await get(`https://itunes.apple.com/lookup?${new URLSearchParams({ id: ids.join(",") })}`, deps)) as { results?: Array<Record<string, unknown>> } | null;
  const feeds = new Map<string, string>();
  for (const row of looked?.results ?? []) if (row.collectionId !== undefined && text(row.feedUrl) !== "") feeds.set(String(row.collectionId), https(text(row.feedUrl)));
  const shows: DirectoryShow[] = [];
  for (const entry of entries) {
    const id = text(entry.id);
    const feed = feeds.get(id);
    if (!feed || !feed.startsWith("https://") || text(entry.name) === "") continue;
    shows.push({ id, title: text(entry.name), author: text(entry.artistName), feed_url: feed, art: artOrNull(entry.artworkUrl100), genre: null, explicit: false });
  }
  return shows.length > 0 ? { ok: true, shows } : { ok: false, status: 502, error: DOWN };
}
