// KS-05 (docs/design/knowledge-sources.md, "The shelf"; THIRD-PARTY-SERVICES.md):
// the news shelf's poller. It behaves as a feed reader a person runs would:
//   - runs only when the house is quiet (no chat turn in flight or just done),
//   - one request at a time (so one per host), at most one a minute per host,
//   - conditional GET (If-None-Match / If-Modified-Since); a 304 costs nothing,
//   - never faster than every 15 minutes per feed, the household's own
//     interval (news.poll_interval_s, default 30 min) otherwise,
//   - backs off on the first bad signal (403, 429, 5xx, a timeout, a body that
//     is not a feed): the wait doubles each time up to 24 h, and Retry-After is
//     honoured (also capped at 24 h),
//   - an honest user agent, no cookies, no referrer,
//   - every address it touches (the feed, each redirect hop, each article
//     link) passes the SSRF guard first. It never fetches an article page.
// Request budget: at most MAX_FEEDS_PER_TICK feed requests per 15-minute
// tick, so with the default 30-minute interval and the 2 bundled lists
// (about 10 feeds) that is roughly 20 requests an hour, fewer when servers
// answer 304.
import { assertNotPrivateHost, guardedFetch, SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";
import { parseFeed } from "feedsmith";
import { NewsItem } from "@maipai/spec/gen/ts/news-item.js";
import { tryConsume } from "@/lib/rateLimiter";
import { nextHlc } from "@/lib/hlc";
import { newNewsItemId } from "@/lib/id";
import { DEFAULT_IDLE_WINDOW_MS, turnActiveWithin } from "@/lib/turnActivity";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import { canonicalUrl } from "./canonicalUrl";
import { bumpShelfCounter } from "./shelfCounters";
import { feedIsWanted } from "./shelfPolicy";
import { MIN_POLL_INTERVAL_S, listFeeds, updateFeed, type FeedRecord } from "./feedStore";
import { sharedShelfStore, type ShelfStore } from "./shelfStore";

import { HOME_USER_AGENT } from "@/lib/outbound";
export const MAX_BACKOFF_S = 86_400;
export const MAX_FEEDS_PER_TICK = 10;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS_PER_FEED = 50;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;
const MAX_ITEM_HOSTS = 20;
const LOOKUP_MS = 3_000;
const HOST_RATE = { capacity: 1, refillPerSecond: 1 / 60 };

export interface PollDeps {
  fetch?: typeof fetch;
  dnsLookup?: DnsLookup;
  now?: () => number;
  store?: ShelfStore | null;
  /** True while a person is using the house; default reads the turn activity gate. */
  busy?: () => boolean;
}

export type PollOutcome = "ok" | "not_modified" | "backoff" | "rate_limited" | "blocked";

const platformFetch = globalThis.fetch;
import { backoffSeconds as sharedBackoffSeconds, parseRetryAfter, maxAgeSeconds } from "@/lib/httpCachePolicy";

/** The wait after a failure: the interval doubled per failure so far, capped
 * at 24 h; a Retry-After longer than that wait wins (also capped at 24 h). */
export function backoffSeconds(intervalS: number, failCount: number, retryAfterS: number | null): number {
  return sharedBackoffSeconds(intervalS, failCount, retryAfterS, MIN_POLL_INTERVAL_S, MAX_BACKOFF_S);
}
export { parseRetryAfter };
function feedMaxAgeSeconds(cacheControl: string | null): number | null { return maxAgeSeconds(cacheControl); }

class RateLimited extends Error {}

function charsetOf(contentType: string | null): string {
  const match = contentType ? /charset=["']?([\w.:-]+)/i.exec(contentType) : null;
  const label = match?.[1]?.toLowerCase() ?? "utf-8";
  try { new TextDecoder(label as "utf-8"); return label; } catch { return "utf-8"; }
}

async function readLimited(response: Response, limit: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder(charsetOf(response.headers.get("content-type")) as "utf-8").decode(bytes);
}

async function validateHop(url: URL, dns: DnsLookup | undefined): Promise<void> {
  if (url.protocol !== "https:" || url.username || url.password) throw new SsrfBlockedError(url.host);
  await assertNotPrivateHost(url.hostname, dns);
}

async function request(feed: FeedRecord, deps: PollDeps, now: () => number, signal: AbortSignal): Promise<Response> {
  const fetcher = deps.fetch ?? fetch;
  const pinned = fetcher === platformFetch;
  const headers: Record<string, string> = {
    "User-Agent": HOME_USER_AGENT,
    Accept: "application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, application/feed+json;q=0.8",
  };
  if (feed.etag) headers["If-None-Match"] = feed.etag;
  if (feed.last_modified) headers["If-Modified-Since"] = feed.last_modified;
  let url = new URL(feed.url);
  const firstHost = url.host;
  const paced = new Set<string>();
  for (let hop = 0; ; hop++) {
    await validateHop(url, deps.dnsLookup);
    const host = url.hostname.toLowerCase();
    if (!paced.has(host)) {
      if (!tryConsume(`net:feed:${host}`, HOST_RATE, now())) throw new RateLimited();
      paced.add(host);
    }
    if (hop > 0 && url.host !== firstHost) { delete headers["If-None-Match"]; delete headers["If-Modified-Since"]; }
    const response = pinned
      ? await guardedFetch(url, { method: "GET", redirect: "manual", signal, maxRedirects: MAX_REDIRECTS, headers })
      : await fetcher(url, { method: "GET", redirect: "manual", signal, headers, credentials: "omit", referrerPolicy: "no-referrer" });
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || hop >= MAX_REDIRECTS) throw new Error("too many redirects");
      url = new URL(location, url);
      continue;
    }
    return response;
  }
}

interface Entry { url: string; title: string; summary: string; published: string | null }

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { value?: unknown }).value === "string") return (value as { value: string }).value;
  return "";
}

/** Plain words only: tags gone, entities already decoded by the parser, runs of space collapsed. */
function plain(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

function isoDate(value: unknown, nowMs: number): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const at = new Date(value).getTime();
  if (Number.isNaN(at) || at > nowMs + 86_400_000) return null;
  return new Date(at).toISOString();
}

/** The common shape of an RSS, Atom, RDF or JSON feed's entries. */
export function extractEntries(body: string, nowMs: number): { language: string | null; entries: Entry[] } {
  const parsed = parseFeed(body) as { format: string; feed: Record<string, any> };
  const feed = parsed.feed;
  const entries: Entry[] = [];
  if (parsed.format === "atom") {
    for (const e of (feed.entries ?? []) as Record<string, any>[]) {
      const links = (e.links ?? []) as { href?: string; rel?: string }[];
      const link = links.find((l) => l.rel === "alternate") ?? links.find((l) => !l.rel) ?? links[0];
      entries.push({ url: link?.href ?? "", title: text(e.title), summary: text(e.summary) || text(e.content), published: isoDate(e.published ?? e.updated, nowMs) });
    }
    return { language: null, entries };
  }
  if (parsed.format === "json") {
    for (const e of (feed.items ?? []) as Record<string, any>[]) {
      entries.push({ url: String(e.url ?? ""), title: text(e.title), summary: text(e.summary) || text(e.content_text), published: isoDate(e.date_published, nowMs) });
    }
    return { language: typeof feed.language === "string" ? feed.language : null, entries };
  }
  for (const e of (feed.items ?? []) as Record<string, any>[]) {
    entries.push({ url: String(e.link ?? ""), title: text(e.title), summary: text(e.description), published: isoDate(e.pubDate ?? e.dc?.date, nowMs) });
  }
  return { language: typeof feed.language === "string" ? feed.language : null, entries };
}

function languageOf(value: string | null): string {
  const match = value ? /^[a-z]{2,3}/i.exec(value) : null;
  return match ? match[0].toLowerCase() : "en";
}

async function ingest(feed: FeedRecord, body: string, deps: PollDeps, nowMs: number, store: ShelfStore): Promise<number> {
  const { language, entries } = extractEntries(body, nowMs);
  const fetchedAt = new Date(nowMs).toISOString();
  const lang = languageOf(language);
  const hostOk = new Map<string, boolean>();
  let stored = 0;
  for (const entry of entries.slice(0, MAX_ITEMS_PER_FEED)) {
    bumpShelfCounter("items_polled");
    const canonical = canonicalUrl(entry.url);
    const title = plain(entry.title, 300);
    if (!canonical || !title) { bumpShelfCounter("link_dropped"); continue; }
    const host = new URL(canonical).hostname;
    let ok = hostOk.get(host);
    if (ok === undefined) {
      // At most MAX_ITEM_HOSTS lookups per feed, each cut off after LOOKUP_MS, so a feed of
      // many hosts or a hung resolver cannot hold the poller.
      if (hostOk.size >= MAX_ITEM_HOSTS) { bumpShelfCounter("link_dropped"); continue; }
      try {
        await Promise.race([
          assertNotPrivateHost(host, deps.dnsLookup),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("lookup timed out")), LOOKUP_MS)),
        ]);
        ok = true;
      } catch { ok = false; }
      hostOk.set(host, ok);
    }
    if (!ok) { bumpShelfCounter("ssrf_blocked"); continue; }
    const summary = plain(entry.summary, 600);
    // The minor floor at ingest (RULES 0 and 7): one definition with tier K.
    // Tripped items stay on the shelf for adults and are never released to a minor.
    const trips = tripsMinorFloor(summary ? `${title}. ${summary}` : title);
    if (trips) bumpShelfCounter("floor_dropped_by_tier", "child");
    const parsed = NewsItem.safeParse({
      id: newNewsItemId(),
      feed_id: feed.id,
      url: entry.url.trim(),
      canonical_url: canonical,
      title,
      summary,
      published_at: entry.published,
      fetched_at: fetchedAt,
      publisher: feed.publisher,
      lang,
      band_ok: trips ? "adult" : "child",
      hlc: nextHlc(),
      provenance: `feed:${feed.id}`,
    });
    if (!parsed.success) { bumpShelfCounter("link_dropped"); continue; }
    if (store.put(parsed.data).inserted) { stored++; bumpShelfCounter("items_stored"); }
    else bumpShelfCounter("items_duplicate");
  }
  return stored;
}

/** Polls one feed and records the outcome on its row. Never throws. */
export async function pollFeed(feed: FeedRecord, deps: PollDeps = {}): Promise<PollOutcome> {
  const now = deps.now ?? Date.now;
  const store = deps.store === undefined ? sharedShelfStore() : deps.store;
  const nowIso = (): string => new Date(now()).toISOString();
  const fail = (retryAfterS: number | null, quiet = true, atLeastS = 0): PollOutcome => {
    const failCount = feed.fail_count + 1;
    const wait = Math.max(atLeastS, backoffSeconds(feed.poll_interval_s, failCount, retryAfterS));
    const until = new Date(now() + wait * 1000).toISOString();
    updateFeed(feed.id, { failCount, nextPollAt: until, quietUntil: quiet ? until : null }, nowIso());
    bumpShelfCounter("backoff_events");
    return "backoff";
  };
  // A store that cannot open is a local fault, not the server's: skip without touching the feed's back-off.
  if (!store) return "backoff";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    bumpShelfCounter("feeds_polled");
    const response = await request(feed, deps, now, controller.signal);
    const interval = (): number => {
      const age = feedMaxAgeSeconds(response.headers.get("cache-control"));
      return Math.min(MAX_BACKOFF_S, Math.max(MIN_POLL_INTERVAL_S, feed.poll_interval_s, age ?? 0));
    };
    if (response.status === 304) {
      await response.body?.cancel().catch(() => undefined);
      bumpShelfCounter("responses_304");
      updateFeed(feed.id, { failCount: 0, quietUntil: null, nextPollAt: new Date(now() + interval() * 1000).toISOString() }, nowIso());
      return "not_modified";
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      bumpShelfCounter("poll_failed");
      return fail(parseRetryAfter(response.headers.get("retry-after"), now()));
    }
    const declared = Number(response.headers.get("content-length"));
    const body = Number.isFinite(declared) && declared > MAX_BYTES ? null : await readLimited(response, MAX_BYTES);
    if (body === null) { bumpShelfCounter("poll_failed"); return fail(null); }
    try { await ingest(feed, body, deps, now(), store); }
    catch { bumpShelfCounter("poll_failed"); return fail(null); }
    updateFeed(feed.id, {
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      failCount: 0,
      quietUntil: null,
      nextPollAt: new Date(now() + interval() * 1000).toISOString(),
    }, nowIso());
    return "ok";
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      // A feed pointing at a private or non-https address is switched off for a day, not retried.
      bumpShelfCounter("ssrf_blocked");
      fail(null, true, MAX_BACKOFF_S);
      return "blocked";
    }
    if (error instanceof RateLimited) {
      updateFeed(feed.id, { nextPollAt: new Date(now() + 60_000).toISOString() }, nowIso());
      return "rate_limited";
    }
    bumpShelfCounter("poll_failed");
    return fail(null);
  } finally {
    clearTimeout(timer);
  }
}

let running = false;

/** One tick of the idle queue: the due, wanted feeds, one at a time, oldest
 * due first, stopping the moment a person starts using the house. */
export async function pollDueFeeds(deps: PollDeps = {}): Promise<{ polled: number; skippedBusy: boolean }> {
  if (running) return { polled: 0, skippedBusy: false };
  running = true;
  try {
    const now = deps.now ?? Date.now;
    const busy = deps.busy ?? ((): boolean => turnActiveWithin(DEFAULT_IDLE_WINDOW_MS));
    const due = listFeeds()
      .filter((feed) => feedIsWanted({ band: feed.band, packageId: feed.package_id ?? null, enabled: feed.enabled }))
      .filter((feed) => Date.parse(feed.next_poll_at) <= now() && (!feed.quiet_until || Date.parse(feed.quiet_until) <= now()))
      .sort((a, b) => Date.parse(a.next_poll_at) - Date.parse(b.next_poll_at))
      .slice(0, MAX_FEEDS_PER_TICK);
    let polled = 0;
    // One request per host per tick: the host bucket allows one a minute, so a second
    // feed on the same host would only be turned away; it waits for the next tick.
    const seenHosts = new Set<string>();
    for (const feed of due) {
      const host = new URL(feed.url).hostname.toLowerCase();
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      if (busy()) { bumpShelfCounter("skipped_busy"); return { polled, skippedBusy: true }; }
      await pollFeed(feed, deps);
      polled++;
    }
    return { polled, skippedBusy: false };
  } finally {
    running = false;
  }
}
