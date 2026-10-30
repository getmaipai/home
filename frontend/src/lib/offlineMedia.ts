import { OfflineManifest } from "@maipai/spec/gen/ts/offline-manifest.js";

/** Bucket prefix. Each person's copies live in `${MEDIA_CACHE}:${personId}`; the service worker serves only the bucket of the
 * person the page last announced, so another person on this browser neither sees nor plays someone else's copies. */
export const MEDIA_CACHE = "maipai-media-v1";
export const OWNER_CACHE = "maipai-media-owner";
export const OWNER_MESSAGE = "maipai-media-owner";
let owner: string | null = null;
const bucket = (): string | null => (owner ? `${MEDIA_CACHE}:${owner}` : null);

/** Who owns the kept copies after a `/me` attempt. A signed-in answer names the owner; only a 401 (signed out or session expired
 * on the hub) clears it. A network or server error keeps the last announced owner, so copies play exactly when the hub is
 * unreachable. Explicit sign-out wipes the copies themselves (`removeAllOfflineMedia`). */
export function nextMediaOwner(previous: string | null, result: { person: { id: string } } | { error: unknown }): string | null {
  if ("person" in result) return result.person.id;
  return (result.error as { status?: number } | null)?.status === 401 ? null : previous;
}

/** Tell this module and the service worker who is signed in (null: nobody, so no copy is served or listed). */
export async function setMediaOwner(personId: string | null): Promise<void> {
  owner = personId;
  try {
    const registration = await navigator.serviceWorker?.ready;
    registration?.active?.postMessage({ type: OWNER_MESSAGE, bucket: bucket() });
  } catch { /* No worker (Firefox, Safari, tests): nothing is served from the bucket anyway. */ }
}
const GENERATION_KEY = "maipai-media-generation";
let localGeneration = 0;
function generation(): string {
  try { return localStorage.getItem(GENERATION_KEY) ?? ""; }
  catch { return String(localGeneration); }
}
const INDEX_PATH = "/api/media/offline/kept/";
export const USE_GO = "Use the MaiPai Go app to keep this on your phone.";
export type OfflineCode = "storageFull" | "revoked" | "needsGrant" | "screenTime" | "notOnServer" | "notReady" | "notPlayable" | "network" | "useGo";
export type OfflineResult = { ok: true } | { ok: false; code: OfflineCode; message: string };
export const offlineMessages: Record<OfflineCode, string> = {
  storageFull: "There is not enough room on this device. Remove some copies, then try again.",
  revoked: "This device cannot get this copy. Sign in to Home and check its permission.",
  needsGrant: "This device needs permission to keep copies. Ask a grown-up or an admin to allow it in Settings, Devices.",
  screenTime: "Keeping a title for later is off right now because of screen time. Ask a grown-up.",
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
/** A 403 is "revoked" only for `device_revoked`; a missing or never-given grant and a screen-time refusal say so instead. */
const codeFor = (status: number, body?: unknown): OfflineCode => {
  if (status === 403) {
    const code = (body as { code?: unknown } | null | undefined)?.code;
    if (code === "device_revoked") return "revoked";
    if (code === "media_time_up" || code === "budget_keep_refused") return "screenTime";
    return "needsGrant";
  }
  return status === 401 ? "revoked" : status === 404 ? "notOnServer" : status === 409 ? "notPlayable" : status === 503 ? "notReady" : "network";
};
const hubFile = (path: string): boolean => (path.startsWith("/api/media/offline/file/") || path.startsWith("/api/offline/file/")) && !path.includes("\\") && new URL(path, location.origin).origin === location.origin;
export interface OfflineRecordRef { kind: string; id: string }
// Keep media's existing index key, so upgrades list and remove the same copies without a second bucket.
const indexUrl = ({ kind, id }: OfflineRecordRef): string => `${INDEX_PATH}${kind === "media" ? "" : `${encodeURIComponent(kind)}/`}${encodeURIComponent(id)}`;

/** Fetch directly from the hub, then explicitly put complete responses in the named bucket. No token is stored. */
export async function keepOnDevice(item: OfflineRecordRef): Promise<OfflineResult> {
  if (!isChromium(navigator.userAgent)) return failure(isWebKit(navigator.userAgent) ? "useGo" : "network");
  const name = bucket();
  if (!name) return failure("revoked");
  const started = generation();
  const checkCurrent = () => { if (generation() !== started || bucket() !== name) throw new Error("copy_cancelled"); };
  let cache: Cache | undefined;
  const written: string[] = [];
  try {
    const estimate = await navigator.storage.estimate();
    const response = await fetch(`/api/offline/manifest?kind=${encodeURIComponent(item.kind)}&id=${encodeURIComponent(item.id)}`, { credentials: "same-origin", cache: "no-store", redirect: "error" });
    checkCurrent();
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null);
      if (isDeviceRevoked(response.status, body)) await removeAllOfflineMedia();
      return failure(codeFor(response.status, body));
    }
    const manifest = OfflineManifest.parse(await response.json());
    checkCurrent();
    if (manifest.kind !== item.kind || manifest.id !== item.id) return failure("network");
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
    await removeFromDevice(item);
    checkCurrent();
    cache = await caches.open(name);
    checkCurrent();
    for (const url of urls) {
      // A bypass query avoids a cache-first worker returning the old fingerprint during a refresh.
      const networkUrl = new URL(url, location.origin);
      networkUrl.searchParams.set("download", "1");
      const bytes = await fetch(networkUrl, { credentials: "same-origin", cache: "no-store", redirect: "error" });
      checkCurrent();
      if (!bytes.ok || bytes.status !== 200) {
        const body = await bytes.clone().json().catch(() => null);
        if (isDeviceRevoked(bytes.status, body)) await removeAllOfflineMedia();
        for (const path of written) await cache.delete(path);
        return failure(codeFor(bytes.status, body));
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
    await cache.put(indexUrl(item), new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } }));
    checkCurrent();
    return { ok: true };
  } catch (error) {
    if (cache) for (const path of written) await cache.delete(path).catch(() => false);
    if (cache && (generation() !== started || bucket() !== name)) await cache.delete(indexUrl(item)).catch(() => false);
    return failure((generation() !== started || bucket() !== name) ? "revoked" : error instanceof DOMException && error.name === "QuotaExceededError" ? "storageFull" : "network");
  }
}

export async function listKept(): Promise<OfflineManifest[]> {
  const name = bucket();
  if (!name || !globalThis.caches) return [];
  const cache = await caches.open(name);
  const manifests: OfflineManifest[] = [];
  for (const key of await cache.keys()) {
    if (!new URL(key.url).pathname.startsWith(INDEX_PATH)) continue;
    const response = await cache.match(key);
    const parsed = OfflineManifest.safeParse(await response?.json().catch(() => null));
    if (parsed.success) manifests.push(parsed.data);
  }
  return manifests;
}

/** One kept entry's JSON, read from this person's bucket with no network (a kept reference article, for instance). Null when nothing is kept. */
export async function readKeptJson(item: OfflineRecordRef, entryPrefix: string): Promise<unknown | null> {
  const name = bucket();
  if (!name || !globalThis.caches) return null;
  try {
    const cache = await caches.open(name);
    const manifest = OfflineManifest.safeParse(await (await cache.match(indexUrl(item)))?.json().catch(() => null));
    const entry = manifest.success ? manifest.data.entries.find((e) => e.id.startsWith(entryPrefix)) : undefined;
    const response = entry ? await cache.match(entry.url) : undefined;
    return response ? await response.json() : null;
  } catch { return null; }
}

export async function removeFromDevice(item: OfflineRecordRef): Promise<void> {
  const name = bucket();
  if (!name || !globalThis.caches) return;
  const cache = await caches.open(name);
  const manifest = OfflineManifest.safeParse(await (await cache.match(indexUrl(item)))?.json().catch(() => null));
  if (manifest.success) {
    for (const entry of manifest.data.entries) {
      for (const url of [entry.url, entry.artwork_url, ...entry.subtitles.map((s) => s.url)]) if (url && hubFile(url)) await cache.delete(url);
    }
  }
  await cache.delete(indexUrl(item));
}

/** Sign-out and a revoked device: every person's copies on this browser go, and the worker stops serving. */
export async function removeAllOfflineMedia(): Promise<void> {
  localGeneration++;
  try { localStorage.setItem(GENERATION_KEY, crypto.randomUUID()); } catch { /* The local counter still cancels this tab's save. */ }
  if (!globalThis.caches) return;
  const names = typeof caches.keys === "function" ? await caches.keys() : [];
  for (const name of new Set([...names.filter((n) => n === MEDIA_CACHE || n.startsWith(`${MEDIA_CACHE}:`)), MEDIA_CACHE])) await caches.delete(name);
}

/** Ask the hub whether each kept copy is still readable and unchanged; remove the ones that are gone or changed.
 * Run at app start and when the browser comes back online. A failed check changes nothing (offline is the point). */
export async function reconcileKept(): Promise<number> {
  let removed = 0;
  try {
    const kept = await listKept();
    if (kept.length === 0) return 0;
    const legacy = kept.filter((m) => m.kind === "media" && m.entries.some((e) => e.url.startsWith("/api/media/offline/file/")));
    const items = legacy.flatMap((m) => m.entries.slice(0, 1).map((e) => ({ kind: "media" as const, id: m.id, fingerprint: e.fingerprint })));
    const response = items.length ? await fetch("/api/media/offline/status", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }) : null;
    if (response && !response.ok) {
      if (isDeviceRevoked(response.status, await response.clone().json().catch(() => null))) { await removeAllOfflineMedia(); return kept.length; }
      return 0;
    }
    const { items: results } = (response ? await response.json() : { items: [] }) as { items: Array<{ id: string; status: "ok" | "changed" | "gone" }> };
    for (const result of results) if (result.status !== "ok") { await removeFromDevice({ kind: "media", id: result.id }); removed++; }
    for (const manifest of kept.filter((m) => !legacy.includes(m))) {
      const response = await fetch(`/api/offline/manifest?kind=${encodeURIComponent(manifest.kind)}&id=${encodeURIComponent(manifest.id)}`, { credentials: "same-origin", cache: "no-store", redirect: "error" });
      if (response.status === 404) { await removeFromDevice(manifest); removed++; continue; }
      if (!response.ok) {
        // A revoked device wipes every copy, as on a keep; any other failure changes nothing.
        if (isDeviceRevoked(response.status, await response.clone().json().catch(() => null))) { await removeAllOfflineMedia(); return removed + kept.length; }
        continue;
      }
      const current = OfflineManifest.safeParse(await response.json());
      if (current.success && current.data.kind === manifest.kind && current.data.id === manifest.id &&
        JSON.stringify(current.data.entries.map((e) => [e.id, e.fingerprint, e.ready])) !== JSON.stringify(manifest.entries.map((e) => [e.id, e.fingerprint, e.ready]))) {
        await removeFromDevice(manifest); removed++;
      }
    }
  } catch { /* offline or signed out: keep what is there */ }
  return removed;
}
