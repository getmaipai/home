// KS-07 (DESIGN section 4, Wayback row): when a page a search cited now answers
// 404, a teen or an adult may be given the Internet Archive's copy instead.
//
// The gate, in this order (the age gate outranks everything, rule 0):
//   - never a child;
//   - `search.wayback_fallback` on (household setting, default on);
//   - the web side is not switched off for this band (KS-MODE-01's effectiveMode:
//     Library only, a band switch or a temporary child chat all close it; there is
//     no second switch);
//   - the cited address passes the band's blocked-site check.
//
// The traffic: one availability request to archive.org (the cited address is the
// only thing sent), answered from the cache for 24 hours; then, only when a copy
// exists, one fetch of that copy (kept 30 days). A temporary chat uses no cache
// and writes nothing. Both requests go through the caller's page fetch, so the
// SSRF guard and the page pace apply; the copy's address is built here from a
// validated timestamp, never taken from the response, and also passes the band's
// blocked-site check. The text that comes back is data: the caller parses it and
// the minor floor runs on it like on any fetched page. A failure of any kind
// returns null so the answer carries on without the copy (rule 6).
import type { AgeBand } from "@/lib/ageBand";
import { urlAllowedFor } from "@/lib/blocklists/hostLists";
import { getHouseholdSettingValue } from "@/lib/settings";
import { type FetchCache, fetchCacheKey, ttlSecondsFor } from "@/lib/retrieval/fetchCache";
import { bumpReferenceCounter } from "@/lib/retrieval/referenceCounters";
import { effectiveMode } from "@/lib/retrieval/sourceMode";

export const WAYBACK_FALLBACK_KEY = "search.wayback_fallback";
export const WAYBACK_AVAILABILITY_URL = "https://archive.org/wayback/available";
export const WAYBACK_HOST = "web.archive.org";

export interface WaybackCopy {
  html: string;
  /** The archive address the body came from. */
  snapshotUrl: string;
  /** The capture day, YYYY-MM-DD. */
  captured: string;
}

export interface WaybackFetch {
  ok: boolean;
  status?: number;
  text?: string;
}

export interface WaybackDeps {
  /** One GET through the caller's page fetch (SSRF guard, pace). */
  fetchText: (url: string) => Promise<WaybackFetch>;
  /** Null for a temporary chat or when caching is off: nothing is read or written. */
  cache: FetchCache | null;
  now?: () => number;
}

/** Whether the Wayback fallback may run for this band right now. */
export function waybackAllowed(band: AgeBand, temporary: boolean): boolean {
  if (band === "child") return false;
  try {
    if (getHouseholdSettingValue(WAYBACK_FALLBACK_KEY) === false) return false;
  } catch {
    return false;
  }
  const mode = effectiveMode("web", band, temporary);
  return mode !== "offline" && mode !== "closed";
}

interface Availability {
  timestamp: string | null;
}

function parseAvailability(json: string): Availability | null {
  try {
    const closest = (JSON.parse(json) as { archived_snapshots?: { closest?: { available?: unknown; timestamp?: unknown } } })
      ?.archived_snapshots?.closest;
    if (closest?.available === true && typeof closest.timestamp === "string" && /^\d{14}$/.test(closest.timestamp)) {
      return { timestamp: closest.timestamp };
    }
    return { timestamp: null };
  } catch {
    return null;
  }
}

function captureDay(timestamp: string): string {
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

/** The archived copy of a dead page, or null. Never throws. */
export async function waybackCopy(rawUrl: string, band: AgeBand, temporary: boolean, deps: WaybackDeps): Promise<WaybackCopy | null> {
  try {
    // Only a plain public address leaves the house: an address carrying a login or a fragment is not sent.
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) return null;
    parsed.hash = "";
    const url = parsed.toString();
    if (!waybackAllowed(band, temporary)) return null;
    if (!urlAllowedFor(band, url)) return null;
    const cache = temporary ? null : deps.cache;
    const nowMs = (deps.now ?? Date.now)();

    let availability: Availability | null = null;
    const cachedAvailability = cache?.get(fetchCacheKey(band, url), "availability", nowMs);
    if (cachedAvailability) availability = parseAvailability(cachedAvailability.body);
    if (!availability) {
      bumpReferenceCounter("wayback_calls", band);
      const answer = await deps.fetchText(`${WAYBACK_AVAILABILITY_URL}?url=${encodeURIComponent(url)}`);
      if (!answer.ok || typeof answer.text !== "string") return null;
      availability = parseAvailability(answer.text);
      if (!availability) return null;
      cache?.put(
        { url: fetchCacheKey(band, url), kind: "availability", status: 200, contentType: "application/json", robotsOk: true, body: JSON.stringify({ archived_snapshots: availability.timestamp ? { closest: { available: true, timestamp: availability.timestamp } } : {} }), ttlS: ttlSecondsFor("availability", url) },
        nowMs,
      );
    }
    if (!availability.timestamp) return null;

    // The `id_` form is the page as captured, without the archive's toolbar.
    const snapshotUrl = `https://${WAYBACK_HOST}/web/${availability.timestamp}id_/${url}`;
    if (!urlAllowedFor(band, snapshotUrl)) return null;
    const captured = captureDay(availability.timestamp);
    const cachedBody = cache?.get(fetchCacheKey(band, snapshotUrl), "archive", nowMs);
    if (cachedBody) return { html: cachedBody.body, snapshotUrl, captured };
    const body = await deps.fetchText(snapshotUrl);
    if (!body.ok || typeof body.text !== "string" || body.text.length === 0) return null;
    cache?.put({ url: fetchCacheKey(band, snapshotUrl), kind: "archive", status: 200, contentType: "text/html", robotsOk: true, body: body.text, ttlS: ttlSecondsFor("archive", snapshotUrl) }, nowMs);
    return { html: body.text, snapshotUrl, captured };
  } catch {
    return null;
  }
}
