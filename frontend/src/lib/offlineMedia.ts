import { OfflineManifest } from "@maipai/spec/gen/ts/offline-manifest.js";

export const MEDIA_CACHE = "maipai-media-v1";
const GENERATION_KEY = "maipai-media-generation";
let localGeneration = 0;
function generation(): string {
  try { return localStorage.getItem(GENERATION_KEY) ?? ""; }
  catch { return String(localGeneration); }
}
const INDEX_PATH = "/api/media/offline/kept/";
export const USE_GO = "Use the MaiPai Go app to keep this on your phone.";
export type OfflineCode = "storageFull" | "revoked" | "notOnServer" | "notReady" | "notPlayable" | "network" | "useGo";
export type OfflineResult = { ok: true } | { ok: false; code: OfflineCode; message: string };
export const offlineMessages: Record<OfflineCode, string> = {
  storageFull: "There is not enough room on this device. Remove some copies, then try again.",
  revoked: "This device cannot get this copy. Sign in to Home and check its permission.",
  notOnServer: "This file is not saved on Home. Save it to the hub first, then try again.",
  notReady: "This copy is not ready. Try again later.",
  notPlayable: "This file cannot play on this device. Choose another item.",
  network: "The copy could not be kept. Check your connection to Home, then try again.",
  useGo: USE_GO,
};
/** Only a revoked device (403 `device_revoked`) wipes copies; an expired session (401) never does. */
export const isDeviceRevoked = (status: number, body: unknown): boolean => status === 403 && (body as { code?: unknown } | null)?.code === "device_revoked";
const failure = (code: OfflineCode): OfflineResult => ({ ok: false, code, message: offlineMessages[code] });
export const isWebKit = (ua: string): boolean => /AppleWebKit\//.test(ua) && (!/\b(?:Chrome|Chromium|Edg)\//.test(ua) || /iPhone|iPad|iPod/.test(ua));
export const isChromium = (ua: string): boolean => /\b(?:Chrome|Chromium|Edg)\//.test(ua) && !isWebKit(ua);
const codeFor = (status: number): OfflineCode => status === 401 || status === 403 ? "revoked" : status === 404 ? "notOnServer" : status === 409 ? "notPlayable" : status === 503 ? "notReady" : "network";
const hubFile = (path: string): boolean => path.startsWith("/api/media/offline/file/") && !path.includes("\\") && new URL(path, location.origin).origin === location.origin;
const indexUrl = (id: string): string => `${INDEX_PATH}${encodeURIComponent(id)}`;

/** Fetch directly from the hub, then explicitly put complete responses in the named bucket. No token is stored. */
export async function keepOnDevice(item: { id: string }): Promise<OfflineResult> {
  if (!isChromium(navigator.userAgent)) return failure(isWebKit(navigator.userAgent) ? "useGo" : "network");
  const started = generation();
  const checkCurrent = () => { if (generation() !== started) throw new Error("copy_cancelled"); };
  let cache: Cache | undefined;
  const written: string[] = [];
  try {
    const estimate = await navigator.storage.estimate();
    const response = await fetch(`/api/media/offline/manifest?id=${encodeURIComponent(item.id)}`, { credentials: "same-origin", cache: "no-store", redirect: "error" });
    checkCurrent();
    if (!response.ok) {
      if (isDeviceRevoked(response.status, await response.clone().json().catch(() => null))) await removeAllOfflineMedia();
      return failure(codeFor(response.status));
    }
    const manifest = OfflineManifest.parse(await response.json());
    checkCurrent();
    if (manifest.kind !== "media" || manifest.id !== item.id) return failure("network");
    for (const entry of manifest.entries) {
      if (!entry.ready) return failure(entry.reason ?? "notReady");
      if (entry.playable !== "original") return failure(entry.playable === "none" ? "notPlayable" : "notReady");
    }
    // Leave room for metadata and artwork too; quota values are estimates, so quota errors are also handled below.
    const available = estimate.quota !== undefined && estimate.usage !== undefined ? estimate.quota - estimate.usage : 0;
    if (available < manifest.total_bytes + 1024 * 1024) return failure("storageFull");
    const urls = [...new Set(manifest.entries.flatMap((entry) => [entry.url, ...(entry.artwork_url ? [entry.artwork_url] : []), ...entry.subtitles.map((s) => s.url)]))];
    if (!urls.every(hubFile)) return failure("network");
    // Replace the old copy first, so a failed update cannot leave a partial old manifest looking complete.
    await removeFromDevice(item.id);
    checkCurrent();
    cache = await caches.open(MEDIA_CACHE);
    checkCurrent();
    for (const url of urls) {
      // A bypass query avoids a cache-first worker returning the old fingerprint during a refresh.
      const networkUrl = new URL(url, location.origin);
      networkUrl.searchParams.set("download", "1");
      const bytes = await fetch(networkUrl, { credentials: "same-origin", cache: "no-store", redirect: "error" });
      checkCurrent();
      if (!bytes.ok || bytes.status !== 200) {
        for (const path of written) await cache.delete(path);
        return failure(codeFor(bytes.status));
      }
      const entry = manifest.entries.find((e) => e.url === url);
      if (entry && (bytes.headers.get("etag") !== JSON.stringify(entry.fingerprint) || Number(bytes.headers.get("content-length")) !== entry.bytes)) {
        for (const path of written) await cache.delete(path);
        return failure("notReady");
      }
      await cache.put(url, bytes);
      written.push(url);
      checkCurrent();
    }
    await cache.put(indexUrl(item.id), new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } }));
    checkCurrent();
    return { ok: true };
  } catch (error) {
    if (cache) for (const path of written) await cache.delete(path).catch(() => false);
    if (cache && generation() !== started) await cache.delete(indexUrl(item.id)).catch(() => false);
    return failure(generation() !== started ? "revoked" : error instanceof DOMException && error.name === "QuotaExceededError" ? "storageFull" : "network");
  }
}

export async function listKept(): Promise<OfflineManifest[]> {
  if (!("caches" in globalThis)) return [];
  const cache = await caches.open(MEDIA_CACHE);
  const manifests: OfflineManifest[] = [];
  for (const key of await cache.keys()) {
    if (!new URL(key.url).pathname.startsWith(INDEX_PATH)) continue;
    const response = await cache.match(key);
    const parsed = OfflineManifest.safeParse(await response?.json().catch(() => null));
    if (parsed.success) manifests.push(parsed.data);
  }
  return manifests;
}

export async function removeFromDevice(id: string): Promise<void> {
  if (!("caches" in globalThis)) return;
  const cache = await caches.open(MEDIA_CACHE);
  const manifest = OfflineManifest.safeParse(await (await cache.match(indexUrl(id)))?.json().catch(() => null));
  if (manifest.success) {
    for (const entry of manifest.data.entries) {
      for (const url of [entry.url, entry.artwork_url, ...entry.subtitles.map((s) => s.url)]) if (url && hubFile(url)) await cache.delete(url);
    }
  }
  await cache.delete(indexUrl(id));
}

export async function removeAllOfflineMedia(): Promise<void> {
  localGeneration++;
  try { localStorage.setItem(GENERATION_KEY, crypto.randomUUID()); } catch { /* The local counter still cancels this tab's save. */ }
  if ("caches" in globalThis) await caches.delete(MEDIA_CACHE);
}
