// Source favicons through the hub (SRC-ICON-01, c-99e5b part 2): the
// privacy rule is "nothing in the browser calls a third party," so the
// site's icon comes through this file's own fetch, never the site's own
// URL rendered straight into an <img src>. A site is asked at most once:
// the result (found or not) is cached on disk under the data directory,
// swept daily by the existing scheduler (lib/scheduler.ts) so an entry
// nobody has opened in 30 days is deleted and the folder never grows
// past a fixed ceiling.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { dataDir, ensureDataDir } from "@/lib/paths";
import { assertNotPrivateHost, guardedFetch, SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";

export const faviconsDir = resolve(dataDir, "favicons");
const indexPath = (): string => join(faviconsDir, "index.json");

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ICON_BYTES = 192 * 1024; // 192 KB per icon (a 180 pixel touch icon runs larger than a .ico)
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB across the whole cache
const UNUSED_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days unused

// favicon.ico first (the one every site is most likely to actually
// serve), apple-touch-icon.png second (a PNG some sites only publish
// under this name) - the same two-rung ladder the c-99f4 brief named,
// nothing else tried beyond it.
const CANDIDATE_PATHS = ["/favicon.ico", "/apple-touch-icon.png"];

const MAX_HOMEPAGE_BYTES = 256 * 1024;

/** The icon addresses a home page declares (`<link rel="icon" | "apple-touch-icon">`), largest declared size first. A site that serves
 * nothing at the two fixed paths (many do not) usually names its icon here. */
export function iconLinksOf(html: string, baseUrl: string): string[] {
  const found: Array<{ href: string; size: number }> = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (!/\b(?:icon|apple-touch-icon(?:-precomposed)?)\b/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const sizes = /\bsizes\s*=\s*["'](\d+)x\d+/i.exec(tag)?.[1];
    const size = sizes ? Number(sizes) : rel.includes("apple-touch") ? 180 : 16;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), baseUrl);
      if (url.protocol === "https:") found.push({ href: url.toString(), size });
    } catch { /* a malformed address is skipped */ }
  }
  return found.sort((a, b) => b.size - a.size).map((entry) => entry.href).slice(0, 4);
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

// A bare hostname per the owner's rule: no scheme, path, query,
// credentials, or port - just labels joined by dots. `localhost` is
// rejected explicitly below (it never has a dot, but naming it directly
// keeps the reason visible in this file rather than relying only on the
// regex's shape).
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export type HostValidation = { ok: true; host: string } | { ok: false; error: string };

/** Syntax + SSRF check for the `domain` query param: rejects a path, a
 * userinfo/credentials segment, a port, an empty string, `localhost`,
 * and anything that resolves to a private, loopback, or link-local
 * address (`assertNotPrivateHost`, `@maipai/core`'s shared SSRF guard -
 * the identical check `packageHost.ts`'s own outbound fetch already
 * uses, not a second copy of the same logic). */
// Test-only: a real hostname (anything past a bare IP literal) needs a
// real DNS answer for `assertNotPrivateHost` to clear - overriding the
// resolver here keeps a route-level test deterministic and offline
// (the org's own testing standard) instead of depending on a fake
// `*.example.com` subdomain actually resolving over the live network.
let testDnsLookup: DnsLookup | null = null;
let testFetch: FaviconFetchFn | null = null;
export function __setFaviconDnsLookupForTests(fn: DnsLookup | null): void {
  testDnsLookup = fn;
}
export function __setFaviconFetchForTests(fn: FaviconFetchFn | null): void {
  testFetch = fn;
}

export async function validateFaviconHost(raw: string): Promise<HostValidation> {
  const host = raw.trim();
  if (!host) return { ok: false, error: "domain is required" };
  if (host.includes("/") || host.includes("?") || host.includes("#") || host.includes("@") || host.includes(":")) {
    return { ok: false, error: `${raw} is not a bare hostname (no path, credentials, or port)` };
  }
  if (host.toLowerCase() === "localhost") return { ok: false, error: "localhost is not a public host" };
  if (!HOSTNAME_RE.test(host)) return { ok: false, error: `${raw} is not a valid hostname` };
  try {
    await assertNotPrivateHost(host, testDnsLookup ?? undefined);
  } catch (err) {
    if (err instanceof SsrfBlockedError) return { ok: false, error: err.message };
    return { ok: false, error: `could not resolve ${host}` };
  }
  return { ok: true, host };
}

interface IndexEntry {
  /** The on-disk extension, or null when the site was already asked and
   * confirmed to have no icon (a real cache hit that never touches the
   * network again, not just a miss). */
  ext: string | null;
  contentType: string | null;
  bytes: number;
  lastUsedAt: string;
  /** 2 once the home page's own icon links were tried: an older "no icon" entry is asked again. */
  v?: number;
}

type FaviconIndex = Record<string, IndexEntry>;

function readIndex(): FaviconIndex {
  const path = indexPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as FaviconIndex;
  } catch {
    // A truncated or corrupted index is treated as empty, never a crash -
    // the worst case is re-fetching a few sites, not a broken route.
    return {};
  }
}

function writeIndex(index: FaviconIndex): void {
  ensureDataDir(faviconsDir);
  writeFileSync(indexPath(), JSON.stringify(index), "utf-8");
}

function filePath(host: string, ext: string): string {
  return join(faviconsDir, `${host}.${ext}`);
}

export type FaviconFetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** Reads `response`'s body capped at `maxBytes`: aborts and returns null
 * the moment the cap is crossed, the same streamed-and-counted shape
 * `packageHost.ts`'s own `readBodyWithLimit` uses for text, kept
 * separate here because this one has to stay binary-safe for an image. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

/** `found`: a real icon. `confirmed_absent`: at least one candidate gave
 * a definitive, content-based answer (a 404/410, a non-image content
 * type, a body confirmed too large) - the site genuinely has none,
 * worth caching. `network_failure`: no candidate ever gave a definitive
 * answer (every attempt was a timeout, a DNS/TLS failure, a mid-download
 * connection drop, or a non-404/410 error status like a 5xx or a 429) -
 * a transient problem, never a fact about the site, so it must NOT be
 * cached as an absence (a review, 2026-09-22, caught the first version
 * of this collapsing both into one null return; a second review pass
 * the same day caught the first fix's own `sawRealResponse` flag firing
 * on "headers received" rather than "a definitive, content-based
 * outcome reached" - a 5xx or a connection drop mid-body-read both still
 * counted as confirmed, the identical 30-day-mis-cache bug reached a
 * different way). */
export type FaviconFetchOutcome =
  | { kind: "found"; bytes: Uint8Array; contentType: string }
  | { kind: "confirmed_absent" }
  | { kind: "network_failure" };

/** Fetches `host`'s icon over the real network: tries `/favicon.ico`
 * then `/apple-touch-icon.png`, 10s timeout per attempt, only an
 * `image/*` content type accepted, capped at `MAX_ICON_BYTES`. Never
 * thrown - a site with no favicon is the ordinary case, not an error. */
export async function fetchFaviconBytes(host: string, fetchFn?: FaviconFetchFn, prefer: "small" | "large" = "small"): Promise<FaviconFetchOutcome> {
  let sawDefiniteAnswer = false;
  const get = (url: string, signal: AbortSignal) => fetchFn
    ? fetchFn(url, { signal })
    : guardedFetch(url, { signal, redirect: "follow", maxRedirects: 3 });
  const tryIcon = async (url: string): Promise<FaviconFetchOutcome | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await get(url, controller.signal);
      if (!response.ok) {
        // 404/410 (packageHost.ts's own identical "not found, not unreachable" line): the server positively confirmed this path
        // doesn't exist, a real fact about the site. Any other non-ok status is the server in trouble, not a fact about the icon.
        if (response.status === 404 || response.status === 410) sawDefiniteAnswer = true;
        return null;
      }
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!contentType.startsWith("image/")) { sawDefiniteAnswer = true; return null; }
      const bytes = await readCapped(response, MAX_ICON_BYTES);
      // readCapped returns null only for its own deliberate size-cap decision (a definitive fact); a dropped connection throws.
      if (!bytes) { sawDefiniteAnswer = true; return null; }
      return { kind: "found", bytes, contentType };
    } catch {
      return null; // a timeout, DNS failure, TLS error, or dropped connection - try the next candidate
    } finally {
      clearTimeout(timer);
    }
  };
  const homepageLinks = async (): Promise<string[]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await get(`https://${host}/`, controller.signal);
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("html")) return [];
      const bytes = await readCapped(response, MAX_HOMEPAGE_BYTES);
      return bytes ? iconLinksOf(new TextDecoder().decode(bytes), `https://${host}/`) : [];
    } catch { return []; } finally { clearTimeout(timer); }
  };
  const fixed = async (): Promise<string[]> => CANDIDATE_PATHS.map((path) => `https://${host}${path}`);
  // Small: the two fixed paths, then what the home page declares. Large (a card's stand-in picture): the declared icons first, largest first.
  const rungs = prefer === "large" ? [homepageLinks, async () => [`https://${host}/apple-touch-icon.png`, `https://${host}/favicon.ico`]] : [fixed, homepageLinks];
  for (const rung of rungs) {
    for (const url of await rung()) {
      const icon = await tryIcon(url);
      if (icon) return icon;
    }
  }
  return sawDefiniteAnswer ? { kind: "confirmed_absent" } : { kind: "network_failure" };
}

export type FaviconResult = { found: true; bytes: Uint8Array; contentType: string } | { found: false };

/** The route's one entry point: a cache hit (found or confirmed-absent)
 * never touches the network; a miss fetches once, writes the result
 * (including a confirmed absence) to the cache, and sweeps the cache if
 * that write pushed it over budget. */
export async function getFavicon(host: string, fetchFn?: FaviconFetchFn, now: Date = new Date(), prefer: "small" | "large" = "small"): Promise<FaviconResult> {
  const index = readIndex();
  const key = prefer === "large" ? `hq.${host}` : host;
  const cached = index[key];
  if (cached && !(cached.ext === null && cached.v !== 2)) {
    cached.lastUsedAt = now.toISOString();
    writeIndex(index);
    if (cached.ext === null || cached.contentType === null) return { found: false };
    const path = filePath(key, cached.ext);
    if (!existsSync(path)) {
      // The index says there should be a file and there isn't (a manual
      // clear, a partial write) - treat it as a fresh miss below rather
      // than serving a 500 for a cache-consistency bug.
      delete index[key];
    } else {
      return { found: true, bytes: readFileSync(path), contentType: cached.contentType };
    }
  }

  const outcome = await fetchFaviconBytes(host, fetchFn ?? testFetch ?? undefined, prefer);
  if (outcome.kind === "network_failure") {
    // Not cached: a transient failure on the hub's own side is never a
    // fact about the site worth remembering for 30 days - the next
    // request (this one, or the daily sweep's own callers) gets a real
    // retry instead of a stale "no icon" it never actually confirmed.
    return { found: false };
  }
  if (outcome.kind === "confirmed_absent") {
    index[key] = { ext: null, contentType: null, bytes: 0, lastUsedAt: now.toISOString(), v: 2 };
    writeIndex(index);
    return { found: false };
  }

  const ext = EXT_BY_CONTENT_TYPE[outcome.contentType] ?? "img";
  ensureDataDir(faviconsDir);
  writeFileSync(filePath(key, ext), outcome.bytes);
  index[key] = { ext, contentType: outcome.contentType, bytes: outcome.bytes.byteLength, lastUsedAt: now.toISOString(), v: 2 };
  writeIndex(index);
  sweepFavicons(now);
  return { found: true, bytes: outcome.bytes, contentType: outcome.contentType };
}

export interface FaviconSweepResult {
  expired: number;
  evicted: number;
}

/** The daily core job (`favicons.sweep`, lib/scheduler.ts): deletes an
 * entry nobody has opened in `UNUSED_EXPIRY_MS`, then, if the cache is
 * still over `MAX_TOTAL_BYTES`, evicts the oldest-unused entries (a
 * confirmed-absent entry has no file and costs no bytes, so eviction
 * only ever removes real icon files) until it's back under budget. */
export function sweepFavicons(now: Date = new Date()): FaviconSweepResult {
  const index = readIndex();
  let expired = 0;
  for (const [host, entry] of Object.entries(index)) {
    if (now.getTime() - new Date(entry.lastUsedAt).getTime() <= UNUSED_EXPIRY_MS) continue;
    if (entry.ext) {
      const path = filePath(host, entry.ext);
      if (existsSync(path)) unlinkSync(path);
    }
    delete index[host];
    expired++;
  }

  let evicted = 0;
  let total = Object.values(index).reduce((sum, entry) => sum + entry.bytes, 0);
  if (total > MAX_TOTAL_BYTES) {
    const withFiles = Object.entries(index)
      .filter(([, entry]) => entry.ext !== null)
      .sort(([, a], [, b]) => new Date(a.lastUsedAt).getTime() - new Date(b.lastUsedAt).getTime());
    for (const [host, entry] of withFiles) {
      if (total <= MAX_TOTAL_BYTES) break;
      if (entry.ext) {
        const path = filePath(host, entry.ext);
        if (existsSync(path)) unlinkSync(path);
      }
      total -= entry.bytes;
      delete index[host];
      evicted++;
    }
  }

  writeIndex(index);
  return { expired, evicted };
}

// Test-only: seeds or reads an index entry directly, so a test can prove
// sweep behavior (a stale entry expires, a fresh one stays) without
// waiting 30 real days or hand-writing the on-disk index format itself.
export function __setFaviconEntryForTests(host: string, entry: IndexEntry): void {
  const index = readIndex();
  index[host] = entry;
  ensureDataDir(faviconsDir);
  if (entry.ext) writeFileSync(filePath(host, entry.ext), "x");
  writeIndex(index);
}

export function __getFaviconEntryForTests(host: string): IndexEntry | undefined {
  return readIndex()[host];
}

export function __clearFaviconCacheForTests(): void {
  const index = readIndex();
  for (const [host, entry] of Object.entries(index)) {
    if (entry.ext) {
      const path = filePath(host, entry.ext);
      if (existsSync(path)) unlinkSync(path);
    }
  }
  writeIndex({});
}
