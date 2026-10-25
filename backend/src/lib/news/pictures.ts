// The News picture route's cache and guarded download, with a story-page fallback for a missing or failed feed picture.
//
// `newsPicture` is called from `GET /api/plugins/news/images/:item`, i.e. when a person's screen shows that story, and from the
// idle picture prefetch (prefetchPictures.ts, NEWS-PICTURES-01) under the same switch and per-site pace as NEWS-07. The first request for an item fetches the feed's own `image_url` once, through the SSRF
// guard (10 second timeout, 8 MB cap, one request to a host at a time, a pace ceiling per host, the first 429 or 403 puts the
// host quiet for an hour), resizes it to 1280 and 480 pixels wide as WebP and stores both under the cache folder. Every later
// request is the cache. The publisher's address never leaves this file: callers get bytes, never the address.
//
// The cache is LRU to `news.image_cache_mb` and drops a picture nobody has looked at for 14 days. A picture a saved story
// pinned is kept (and skipped by both) until the save goes. The index holds item ids and byte counts only (RULES 6a).
import type { AgeBand } from "@/lib/ageBand";
import { urlAllowedFor } from "@/lib/blocklists/hostLists";
import { enrichItem } from "./enrich";
import { newsHostQuiet, quietNewsHost, __resetNewsHostBackoffForTests } from "./hostBackoff";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { assertNotPrivateHost, guardedFetch, SsrfBlockedError, type DnsLookup, type PinnedRequest } from "@maipai/core/src/ssrfGuard";
import { cacheDir } from "@/lib/paths";
import { HOME_USER_AGENT } from "@/lib/outbound";
import { tryConsume } from "@/lib/rateLimiter";
import { getHouseholdSettingValue } from "@/lib/settings";
import { NEWS_IMAGES_KEY, NEWS_IMAGE_CACHE_MB_DEFAULT, NEWS_IMAGE_CACHE_MB_KEY, NEWS_IMAGE_CACHE_MB_MIN } from "@/settings/newsKeys";
import { bumpNewsCounter } from "./newsCounters";
import { sharedShelfStore, type ShelfItem } from "@/lib/shelf/shelfStore";

export const NEWS_PICTURE_WIDTHS = [480, 1280] as const;
export type NewsPictureWidth = (typeof NEWS_PICTURE_WIDTHS)[number];

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const UNUSED_EXPIRY_MS = 14 * 86_400_000;
const FAILURE_MEMORY_MS = 30 * 60 * 1000;
// A person's pace: one screen asks for a hero, four featured, a shelf of eight and twenty rows; past that, one a second.
const HOST_RATE = { capacity: 60, refillPerSecond: 1 };
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

export function newsPictureDir(): string {
  return join(cacheDir, "news-images");
}
const indexPath = (): string => join(newsPictureDir(), "index.json");

interface IndexEntry { bytes: number; lastUsedAt: string; pinned?: boolean }
type PictureIndex = Record<string, IndexEntry>;

/** The cache key a stored picture goes by: one per item, from the item id alone. */
export function pictureRefOf(itemId: string): string {
  return `nimg_${itemId.replace(/^news-/, "").replace(/[^a-z0-9]/g, "")}`;
}
/** The cache key of one picture inside an article (NEWS-ARTICLE-FIGURES-01): the item's key and the figure's number. */
export function figureRefOf(itemId: string, n: number): string {
  return `${pictureRefOf(itemId)}_f${n}`;
}
const fileOf = (ref: string, width: NewsPictureWidth): string => join(newsPictureDir(), `${ref}-${width}.webp`);

function readIndex(): PictureIndex {
  try { return JSON.parse(readFileSync(indexPath(), "utf8")) as PictureIndex; } catch { return {}; }
}
function writeIndex(index: PictureIndex): void {
  mkdirSync(newsPictureDir(), { recursive: true });
  const tmp = `${indexPath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(index));
  renameSync(tmp, indexPath());
}

// ---- Settings ------------------------------------------------------------------------------

export function newsImagesOn(): boolean {
  return getHouseholdSettingValue(NEWS_IMAGES_KEY) !== false;
}

export function newsImageCacheBytes(): number {
  const value = getHouseholdSettingValue(NEWS_IMAGE_CACHE_MB_KEY);
  const mb = typeof value === "number" && Number.isFinite(value) && value >= NEWS_IMAGE_CACHE_MB_MIN ? value : NEWS_IMAGE_CACHE_MB_DEFAULT;
  return Math.floor(mb * 1024 * 1024);
}

// ---- Test seams ----------------------------------------------------------------------------

interface PictureDeps { dnsLookup?: DnsLookup; request?: PinnedRequest; now?: () => number }
let deps: PictureDeps = {};
/** Test seam: the resolver and the pinned request the one fetch uses (a test points both at a localhost fixture server). */
export function __setNewsPictureDepsForTests(next: PictureDeps | null): void {
  deps = next ?? {};
}
const failed = new Map<string, number>();
const inFlight = new Map<string, Promise<boolean>>();
const hostQueues = new Map<string, Promise<unknown>>();
export function __resetNewsPicturesForTests(): void {
  __resetNewsHostBackoffForTests();
  failed.clear();
  inFlight.clear();
  hostQueues.clear();
}
const clock = (): number => (deps.now ?? Date.now)();

// ---- The one fetch -------------------------------------------------------------------------

async function readLimited(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    if (signal.aborted) { await reader.cancel().catch(() => undefined); return null; }
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** One request to a host at a time: queued behind the host's last one (the shared limiter paces the rest). */
function perHost<T>(host: string, task: () => Promise<T>): Promise<T> {
  const previous = hostQueues.get(host) ?? Promise.resolve();
  const next = previous.then(task, task);
  hostQueues.set(host, next.catch(() => undefined));
  return next;
}

async function downloadOnce(imageUrl: string, band: AgeBand): Promise<Uint8Array | null> {
  let url: URL;
  try { url = new URL(imageUrl); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !urlAllowedFor(band, imageUrl)) return null;
  const host = url.hostname.toLowerCase();
  if (newsHostQuiet(host, clock())) { bumpNewsCounter("picture_host_quiet"); return null; }
  try {
    await assertNotPrivateHost(host, deps.dnsLookup);
  } catch (error) {
    bumpNewsCounter(error instanceof SsrfBlockedError ? "picture_ssrf_blocked" : "picture_failed");
    return null;
  }
  return perHost(host, async () => {
    if (newsHostQuiet(host, clock())) { bumpNewsCounter("picture_host_quiet"); return null; }
    if (!tryConsume(`net:${host}`, HOST_RATE, clock())) { bumpNewsCounter("picture_paced"); return null; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let current = url;
      let response: Response;
      for (let hop = 0; ; hop++) {
        if (!/^https?:$/.test(current.protocol) || current.username || current.password || !urlAllowedFor(band, current.href)) return null;
        if (newsHostQuiet(current.hostname.toLowerCase(), clock())) return null;
        response = await guardedFetch(current, {
          method: "GET", redirect: "manual", signal: controller.signal,
          headers: { "User-Agent": HOME_USER_AGENT, Accept: "image/avif,image/webp,image/jpeg,image/png" },
        }, deps.dnsLookup, deps.request);
        if (response.status === 403 || response.status === 429) quietNewsHost(current.hostname.toLowerCase(), clock());
        const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
        if (!location) break;
        await response.body?.cancel().catch(() => undefined);
        if (hop >= MAX_REDIRECTS) return null;
        current = new URL(location, current);
      }
      if (response.status === 429 || response.status === 403) {
        quietNewsHost(host, clock());
        bumpNewsCounter("picture_host_backoff");
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); bumpNewsCounter("picture_failed"); return null; }
      const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!ACCEPTED_TYPES.has(type)) { await response.body?.cancel().catch(() => undefined); bumpNewsCounter("picture_failed"); return null; }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_BYTES) { await response.body?.cancel().catch(() => undefined); bumpNewsCounter("picture_too_big"); return null; }
      const bytes = await readLimited(response, MAX_BYTES, controller.signal);
      if (!bytes) { bumpNewsCounter("picture_too_big"); return null; }
      return bytes;
    } catch (error) {
      bumpNewsCounter(error instanceof SsrfBlockedError ? "picture_ssrf_blocked" : "picture_failed");
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
}

async function resizeBoth(bytes: Uint8Array): Promise<Record<NewsPictureWidth, Uint8Array> | null> {
  try {
    const source = sharp(bytes, { failOn: "error", limitInputPixels: 80_000_000 }).rotate();
    const out = {} as Record<NewsPictureWidth, Uint8Array>;
    for (const width of NEWS_PICTURE_WIDTHS) out[width] = new Uint8Array(await source.clone().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
    return out;
  } catch {
    return null;
  }
}

// ---- The cache -----------------------------------------------------------------------------

/** Drops what nobody has looked at for 14 days, then the least recently used until the cache fits `news.image_cache_mb`.
 * A pinned picture (a saved story's) is skipped by both. */
export function sweepNewsPictures(nowMs = clock()): { expired: number; evicted: number } {
  const index = readIndex();
  let expired = 0;
  let evicted = 0;
  const drop = (ref: string): void => {
    for (const width of NEWS_PICTURE_WIDTHS) if (existsSync(fileOf(ref, width))) unlinkSync(fileOf(ref, width));
    delete index[ref];
  };
  for (const [ref, entry] of Object.entries(index)) {
    if (!entry.pinned && nowMs - Date.parse(entry.lastUsedAt) > UNUSED_EXPIRY_MS) { drop(ref); expired++; }
  }
  const cap = newsImageCacheBytes();
  let total = Object.values(index).reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [ref, entry] of Object.entries(index).sort((a, b) => a[1].lastUsedAt.localeCompare(b[1].lastUsedAt))) {
    if (total <= cap) break;
    if (entry.pinned) continue;
    total -= entry.bytes;
    drop(ref);
    evicted++;
  }
  writeIndex(index);
  return { expired, evicted };
}

/** How many pictures the cache holds (a count only). */
export function newsPictureCount(): number {
  return Object.keys(readIndex()).length;
}

/** Pins or unpins an item's stored picture (a saved story keeps it). Returns whether the cache holds one. */
export function pinNewsPicture(itemId: string, pinned: boolean): boolean {
  const index = readIndex();
  const entry = index[pictureRefOf(itemId)];
  if (!entry) return false;
  entry.pinned = pinned;
  writeIndex(index);
  return true;
}

export function newsPictureCached(itemId: string): boolean {
  return readIndex()[pictureRefOf(itemId)] !== undefined;
}

/** One download per item and band at a time, shared by the picture route and a save. */
function ensureShared(item: ShelfItem, band: AgeBand): Promise<boolean> {
  const key = `${item.id}:${band}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = ensure(item, band).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** Fetches, resizes and stores an item's picture if it is not cached yet. True when the cache holds it afterwards. */
async function ensure(item: ShelfItem, band: AgeBand): Promise<boolean> {
  const ref = pictureRefOf(item.id);
  const index = readIndex();
  if (index[ref] && NEWS_PICTURE_WIDTHS.every((width) => existsSync(fileOf(ref, width)))) return true;
  const failureKey = `${item.id}:${band}`;
  if ((failed.get(failureKey) ?? 0) > clock()) return false;
  const bytes = item.image_url ? await downloadOnce(item.image_url, band) : null;
  let sizes = bytes ? await resizeBoth(bytes) : null;
  if (!sizes) {
    const enriched = await enrichItem(item, band);
    if (enriched?.image_url && enriched.image_url !== item.image_url) {
      const fallback = await downloadOnce(enriched.image_url, band);
      sizes = fallback ? await resizeBoth(fallback) : null;
    }
  }
  if (!sizes) {
    failed.set(failureKey, clock() + FAILURE_MEMORY_MS);
    return false;
  }
  persist(ref, sizes);
  sharedShelfStore()?.setImageRef(item.id, ref);
  bumpNewsCounter("picture_fetched");
  sweepNewsPictures();
  return existsSync(fileOf(ref, 480));
}

/** Writes both sizes under one cache key and records them in the index. */
function persist(ref: string, sizes: Record<NewsPictureWidth, Uint8Array>): void {
  mkdirSync(newsPictureDir(), { recursive: true });
  let total = 0;
  for (const width of NEWS_PICTURE_WIDTHS) {
    writeFileSync(fileOf(ref, width), sizes[width]);
    total += sizes[width].byteLength;
  }
  const next = readIndex();
  next[ref] = { bytes: total, lastUsedAt: new Date(clock()).toISOString(), ...(next[ref]?.pinned ? { pinned: true } : {}) };
  writeIndex(next);
}

/** One picture inside an article: fetched once from the address the item's stored article names, then the cache. */
async function ensureFigure(itemId: string, n: number, address: string, band: AgeBand): Promise<boolean> {
  const ref = figureRefOf(itemId, n);
  if (readIndex()[ref] && NEWS_PICTURE_WIDTHS.every((width) => existsSync(fileOf(ref, width)))) return true;
  const failureKey = `${ref}:${band}`;
  if ((failed.get(failureKey) ?? 0) > clock()) return false;
  const bytes = await downloadOnce(address, band);
  const sizes = bytes ? await resizeBoth(bytes) : null;
  if (!sizes) { failed.set(failureKey, clock() + FAILURE_MEMORY_MS); return false; }
  persist(ref, sizes);
  bumpNewsCounter("picture_fetched");
  sweepNewsPictures();
  return existsSync(fileOf(ref, 480));
}

/** A figure of an article at one width. `address` comes from the item's own stored article (the route looks it up), never from a
 * request. Null when pictures are off, the host is backed off or the fetch failed. */
export async function newsFigurePicture(itemId: string, n: number, address: string, width: NewsPictureWidth, band: AgeBand = "adult"): Promise<{ bytes: Uint8Array; etag: string } | null> {
  if (!newsImagesOn()) return null;
  const key = `${figureRefOf(itemId, n)}:${band}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = ensureFigure(itemId, n, address, band).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  if (!(await pending)) return null;
  const ref = figureRefOf(itemId, n);
  const path = fileOf(ref, width);
  if (!existsSync(path)) return null;
  const bytes = new Uint8Array(readFileSync(path));
  const index = readIndex();
  if (index[ref]) { index[ref].lastUsedAt = new Date(clock()).toISOString(); writeIndex(index); }
  return { bytes, etag: `"${createHash("sha1").update(bytes).digest("hex").slice(0, 24)}"` };
}

/** The picture of an item at one width, from the cache; the first request for the item fetches it once. Null when the item
 * has no picture, the household turned pictures off, the host is backed off or the fetch failed (the card is then text only). */
export async function newsPicture(item: ShelfItem, width: NewsPictureWidth, band: AgeBand = "adult"): Promise<{ bytes: Uint8Array; etag: string } | null> {
  if (!newsImagesOn()) return null;
  const ref = pictureRefOf(item.id);
  if (!(await ensureShared(item, band))) return null;
  const path = fileOf(ref, width);
  if (!existsSync(path)) return null;
  const bytes = new Uint8Array(readFileSync(path));
  const index = readIndex();
  if (index[ref]) { index[ref].lastUsedAt = new Date(clock()).toISOString(); writeIndex(index); }
  return { bytes, etag: `"${createHash("sha1").update(bytes).digest("hex").slice(0, 24)}"` };
}

/** For a saved story: make sure the picture is stored (text-only items have none) and pin it. */
export async function ensureAndPinNewsPicture(item: ShelfItem, band: AgeBand = "adult"): Promise<boolean> {
  if (!newsImagesOn()) return false;
  if (!(await ensureShared(item, band))) return false;
  return pinNewsPicture(item.id, true);
}
