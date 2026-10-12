// SEARCH-DDGS-01: the optional ddgs web search source (owner's ruling 2026-10-11,
// .github/docs/THIRD-PARTY-SERVICES.md). Home never talks to DuckDuckGo itself: the maintained
// `ddgs` library runs in a small sidecar on this computer (scripts/ddgs-sidecar) which owns the one
// fixed browser identity (no rotation, no proxies). This file is the ONLY caller of that sidecar and
// is its single choke point: a person's pace through the shared limiter, and quiet mode on the
// first block (no request at all for a growing window), so a block is never retried through.
//
// Adults only. webSources.ts gates the band (ModeSource "ddgs" is closed for a child and teen) and
// packageHost.ts keeps a guest off it; this file also refuses a non-adult band as a second lock.
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { tryConsume } from "@/lib/rateLimiter";
import type { WebRows, WebRow, WebSearchContext } from "@/lib/retrieval/webSources";

export const DDGS_URL_ENV = "MAIPAI_DDGS_URL";
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
export function ddgsQuietUntil(): number {
  return quietUntil;
}

/** The sidecar's address, or null when none is set. Loopback only: the sidecar runs beside Home. */
export function ddgsBaseUrl(): URL | null {
  const raw = process.env[DDGS_URL_ENV]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    return (url.protocol === "http:" || url.protocol === "https:") && loopback ? url : null;
  } catch {
    return null;
  }
}
export const ddgsConfigured = (): boolean => ddgsBaseUrl() !== null;

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
  if (ctx.band !== "adult" || ctx.role === "guest") throw new HostError("permission_denied", "DuckDuckGo search is for adults only.");
  const base = ddgsBaseUrl();
  if (!base) throw new HostError("search_unavailable", "DuckDuckGo search is not set up. Start the ddgs sidecar and set MAIPAI_DDGS_URL, or pick another web search source.");
  const query = (ctx.args as { query?: unknown } | undefined)?.query;
  if (typeof query !== "string" || query.length === 0) throw new HostError("invalid_input", `ddgs search needs a string "query" argument`);
  if (clock() < quietUntil) throw new HostError("search_unavailable", UNAVAILABLE);
  // After a block, only one request at a time may test whether the service is answering again.
  if (blockCount > 0 && probing) throw new HostError("search_unavailable", UNAVAILABLE);
  if (!tryConsume(RATE_LIMIT_KEY, RATE_LIMIT, clock())) throw new HostError("rate_limited", "DuckDuckGo search is rate-limited - try again shortly");
  const url = new URL("search", base.href.endsWith("/") ? base.href : `${base.href}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("max", String(ROW_CAP));
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
      rows.push({ title: item.title.trim(), url: rowUrl, snippet: snippet || null });
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
