// SEARCH-DDGS-01: the optional ddgs web search source (owner's ruling 2026-10-11,
// .github/docs/THIRD-PARTY-SERVICES.md). Home never talks to DuckDuckGo itself: the maintained
// `ddgs` library runs in a small sidecar on this computer (the Stack, backend/src/search) which owns the one
// fixed browser identity (no rotation, no proxies). This file is the ONLY caller of that sidecar and
// is its single choke point: a person's pace through the shared limiter, and quiet mode on the
// first block (no request at all for a growing window), so a block is never retried through.
//
// Adults by default. webSources.ts gates the band (ModeSource "ddgs" is closed for a child and teen unless an owner or
// admin turned on `search.ddgs_for_minors` for that band, SEARCH-DDGS-TEEN-01) and packageHost.ts keeps a guest off it;
// this file refuses a minor the household did not allow, and a minor on a spoken turn, as a second lock. For a minor
// it sends `safesearch=on` (strict); the ddgs text path may ignore it, which the settings page says plainly.
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { tryConsume } from "@/lib/rateLimiter";
import { minorDdgsAllowed } from "@/lib/retrieval/sourceMode";
import { ddgsBaseUrl, ddgsSetupNote } from "@/lib/retrieval/ddgsConfig";
import { refreshDdgsFromStack } from "@/lib/retrieval/ddgsStackSync";
import { MINOR_QUERY_PERSONAL_NOTE, minorQueryHit } from "@/lib/retrieval/minorQueryCheck";
import { minorRowAllowed } from "@/lib/retrieval/minorRowFloor";
import { wantsSpoken } from "@/lib/spokenArg";
import type { WebRows, WebRow, WebSearchContext } from "@/lib/retrieval/webSources";

/** What the privacy page names: the site the sidecar's search words reach. */
export const DDGS_DESTINATION_HOST = "duckduckgo.com";

const RATE_LIMIT_KEY = "ddgs";
const RATE_LIMIT = { capacity: 2, refillPerSecond: 1 / 10 };
const TIMEOUT_MS = 8000;
const ROW_CAP = 8;
/** Quiet windows after a block: first, then each repeat block, capped at the last. */
const QUIET_WINDOWS_MS = [60 * 60_000, 3 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000];

let quietUntil = 0;
let blockCount = 0;
let probing = false;
let clock: () => number = Date.now;
export function __resetDdgsForTests(): void {
  quietUntil = 0;
  blockCount = 0;
  probing = false;
  clock = Date.now;
}
export function __setDdgsClockForTests(now: () => number): void {
  clock = now;
}

function openQuietMode(): void {
  quietUntil = clock() + QUIET_WINDOWS_MS[Math.min(blockCount, QUIET_WINDOWS_MS.length - 1)]!;
  blockCount += 1;
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

const UNAVAILABLE = "DuckDuckGo search isn't answering right now. Home will try again later; searches use the other picked source meanwhile.";

export async function ddgsSearch(ctx: WebSearchContext): Promise<WebRows> {
  const minor = ctx.band !== "adult";
  // A minor's turn must be affirmed as not spoken by the caller (the turn's own surface, packageHost.ts); the `spoken` arg is a second signal.
  const spoken = ctx.spoken !== false || wantsSpoken(ctx.args as { spoken?: unknown } | undefined);
  if (ctx.role === "guest" || (minor && (spoken || !minorDdgsAllowed(ctx.band)))) throw new HostError("permission_denied", "DuckDuckGo search is not allowed for this profile.");
  // The Stack may have just finished building the service: ask once, now, before calling it unavailable.
  const base = ddgsBaseUrl() ?? (await refreshDdgsFromStack(), ddgsBaseUrl());
  if (!base) throw new HostError("search_unavailable", ddgsSetupNote() ?? "DuckDuckGo search is not set up. The Stack sets it up by itself; if it stays off, open Repairs. Otherwise pick another web search source.");
  const query = (ctx.args as { query?: unknown } | undefined)?.query;
  if (typeof query !== "string" || query.length === 0) throw new HostError("invalid_input", `ddgs search needs a string "query" argument`);
  // The same query refusal SearXNG's leg gets (MINOR-SEARCH-01f): a minor's words with a closed personal detail never leave the house.
  if (minor && minorQueryHit(query, ctx.band)) throw new HostError("invalid_input", MINOR_QUERY_PERSONAL_NOTE);
  if (clock() < quietUntil) throw new HostError("search_unavailable", UNAVAILABLE);
  // After a block, only one request at a time may test whether the service is answering again.
  if (blockCount > 0 && probing) throw new HostError("search_unavailable", UNAVAILABLE);
  if (!tryConsume(RATE_LIMIT_KEY, RATE_LIMIT, clock())) throw new HostError("rate_limited", "DuckDuckGo search is rate-limited - try again shortly");
  const url = new URL("search", base.href.endsWith("/") ? base.href : `${base.href}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("max", String(ROW_CAP));
  if (minor) url.searchParams.set("safesearch", "on");
  const isProbe = blockCount > 0;
  if (isProbe) probing = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onParentAbort = () => controller.abort(ctx.signal?.reason);
  if (ctx.signal?.aborted) onParentAbort();
  else ctx.signal?.addEventListener("abort", onParentAbort, { once: true });
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (response.status === 429) {
      openQuietMode();
      throw new HostError("search_unavailable", UNAVAILABLE);
    }
    if (!response.ok) {
      console.warn(`ddgs sidecar answered HTTP ${response.status}`); // status only, never the words searched
      throw new HostError("search_unavailable", UNAVAILABLE);
    }
    const body = (await response.json()) as { rows?: unknown };
    const rows: WebRow[] = [];
    for (const raw of Array.isArray(body.rows) ? (body.rows as unknown[]) : []) {
      if (rows.length >= ROW_CAP) break;
      const item = raw as { title?: unknown; url?: unknown; snippet?: unknown };
      const rowUrl = cleanUrl(item.url);
      if (typeof item.title !== "string" || item.title.trim() === "" || !rowUrl) continue;
      const snippet = typeof item.snippet === "string" ? item.snippet.trim() : "";
      const row: WebRow = { title: item.title.trim(), url: rowUrl, snippet: snippet || null };
      // The same per-row floor every minor result passes (minorRowFloor.ts): a blocked site or an unsafe title or snippet is dropped here too.
      if (minor && !minorRowAllowed(ctx.band, row)) continue;
      rows.push(row);
    }
    // A normal answer (even an empty one) ends the back-off ladder.
    blockCount = 0;
    return {
      text: rows.length === 0 ? "No web search results were found." : rows.map((r, i) => `${i + 1}. ${r.title} (${r.url})${r.snippet ? ` - ${r.snippet}` : ""}`).join("\n"),
      rows,
    };
  } catch (err) {
    if (err instanceof HostError) throw err;
    // Never log the error object. A refused connection or a timeout is "not answering", not a block.
    throw new HostError("search_unavailable", UNAVAILABLE);
  } finally {
    if (isProbe) probing = false;
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onParentAbort);
  }
}
