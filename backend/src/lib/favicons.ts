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
import { assertNotPrivateHost, SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";

export const faviconsDir = resolve(dataDir, "favicons");
const indexPath = (): string => join(faviconsDir, "index.json");

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ICON_BYTES = 64 * 1024; // 64 KB per icon
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB across the whole cache
const UNUSED_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days unused

// favicon.ico first (the one every site is most likely to actually
// serve), apple-touch-icon.png second (a PNG some sites only publish
// under this name) - the same two-rung ladder the c-99f4 brief named,
// nothing else tried beyond it.
const CANDIDATE_PATHS = ["/favicon.ico", "/apple-touch-icon.png"];

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
export function __setFaviconDnsLookupForTests(fn: DnsLookup | null): void {
  testDnsLookup = fn;
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
export async function fetchFaviconBytes(host: string, fetchFn: FaviconFetchFn = (url, init) => fetch(url, init)): Promise<FaviconFetchOutcome> {
  let sawDefiniteAnswer = false;
  for (const path of CANDIDATE_PATHS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchFn(`https://${host}${path}`, { signal: controller.signal });
      if (!response.ok) {
        // 404/410 (packageHost.ts's own identical "not found, not
        // unreachable" line): the server positively confirmed this path
        // doesn't exist, a real fact about the site. Any other non-ok
        // status (5xx, 429, 403, ...) is the server itself in trouble,
        // not a fact about whether an icon exists - left unmarked, the
        // same as a thrown network error.
        if (response.status === 404 || response.status === 410) sawDefiniteAnswer = true;
        continue;
      }
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!contentType.startsWith("image/")) {
        sawDefiniteAnswer = true; // the full header set arrived; the content type itself is the definitive fact, no body read needed
        continue;
      }
      const bytes = await readCapped(response, MAX_ICON_BYTES);
      if (!bytes) {
        // readCapped returns null only for its own deliberate size-cap
        // decision (an oversized body IS a definitive fact) - a genuine
        // mid-read connection drop throws instead and lands in the catch
        // below, never here, so this marker stays accurate either way.
        sawDefiniteAnswer = true;
        continue;
      }
      return { kind: "found", bytes, contentType };
    } catch {
      continue; // a timeout, DNS failure, TLS error, or dropped connection - try the next candidate
    } finally {
      clearTimeout(timer);
    }
  }
  return sawDefiniteAnswer ? { kind: "confirmed_absent" } : { kind: "network_failure" };
}

export type FaviconResult = { found: true; bytes: Uint8Array; contentType: string } | { found: false };

/** The route's one entry point: a cache hit (found or confirmed-absent)
 * never touches the network; a miss fetches once, writes the result
 * (including a confirmed absence) to the cache, and sweeps the cache if
 * that write pushed it over budget. */
export async function getFavicon(host: string, fetchFn?: FaviconFetchFn, now: Date = new Date()): Promise<FaviconResult> {
  const index = readIndex();
  const cached = index[host];
  if (cached) {
    cached.lastUsedAt = now.toISOString();
    writeIndex(index);
    if (cached.ext === null || cached.contentType === null) return { found: false };
    const path = filePath(host, cached.ext);
    if (!existsSync(path)) {
      // The index says there should be a file and there isn't (a manual
      // clear, a partial write) - treat it as a fresh miss below rather
      // than serving a 500 for a cache-consistency bug.
      delete index[host];
    } else {
      return { found: true, bytes: readFileSync(path), contentType: cached.contentType };
    }
  }

  const outcome = await fetchFaviconBytes(host, fetchFn);
  if (outcome.kind === "network_failure") {
    // Not cached: a transient failure on the hub's own side is never a
    // fact about the site worth remembering for 30 days - the next
    // request (this one, or the daily sweep's own callers) gets a real
    // retry instead of a stale "no icon" it never actually confirmed.
    return { found: false };
  }
  if (outcome.kind === "confirmed_absent") {
    index[host] = { ext: null, contentType: null, bytes: 0, lastUsedAt: now.toISOString() };
    writeIndex(index);
    return { found: false };
  }

  const ext = EXT_BY_CONTENT_TYPE[outcome.contentType] ?? "img";
  ensureDataDir(faviconsDir);
  writeFileSync(filePath(host, ext), outcome.bytes);
  index[host] = { ext, contentType: outcome.contentType, bytes: outcome.bytes.byteLength, lastUsedAt: now.toISOString() };
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
