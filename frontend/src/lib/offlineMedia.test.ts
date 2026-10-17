import { afterEach, beforeEach, expect, test } from "bun:test";
import { keepOnDevice, listKept, removeFromDevice, removeAllOfflineMedia, MEDIA_CACHE, USE_GO } from "./offlineMedia";

const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, "storage");
const uaDescriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");
const manifest = () => ({ kind: "media", id: "media-nova00", title: "nova", entries: [{ id: "media-nova00", url: "/api/media/offline/file/media/media-nova00", bytes: 10, mime: "video/mp4", fingerprint: "fp", ready: true, playable: "original" }], total_bytes: 10, generated_at: new Date().toISOString() });
let kept = new Map<string, Response>();
let calls: string[] = [];
let quota = 10_000_000;
let failPut = false;
const keyOf = (key: RequestInfo | URL) => new URL(typeof key === "string" ? key : key instanceof URL ? key.href : key.url, location.origin).href;
beforeEach(() => {
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "https://example.com" } });
  kept = new Map(); calls = []; quota = 10_000_000; failPut = false;
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36" });
  Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: async () => ({ usage: 0, quota }) } });
  Object.assign(globalThis, { caches: {
    open: async (name: string) => {
      expect(name).toBe(MEDIA_CACHE);
      return {
        match: async (key: RequestInfo | URL) => kept.get(keyOf(key))?.clone(),
        put: async (key: RequestInfo | URL, response: Response) => { if (failPut) throw new DOMException("quota", "QuotaExceededError"); kept.set(keyOf(key), response.clone()); },
        delete: async (key: RequestInfo | URL) => kept.delete(keyOf(key)),
        keys: async () => [...kept.keys()].map((url) => new Request(url)),
      };
    },
    delete: async () => { kept.clear(); return true; },
  }, fetch: async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return String(url).includes("/manifest?") ? Response.json(manifest()) : new Response("0123456789", { headers: { ETag: '\"fp\"', "Content-Length": "10" } });
  } });
});
afterEach(() => {
  Object.assign(globalThis, { fetch: originalFetch, caches: originalCaches });
  if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor);
  if (storageDescriptor) Object.defineProperty(navigator, "storage", storageDescriptor); else Reflect.deleteProperty(navigator, "storage");
  if (uaDescriptor) Object.defineProperty(navigator, "userAgent", uaDescriptor); else Reflect.deleteProperty(navigator, "userAgent");
});

test("WebKit returns useGo with the exact next step and makes no requests", async () => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/128.0 Mobile Safari/604.1" });
  expect(await keepOnDevice({ id: "media-nova00" })).toEqual({ ok: false, code: "useGo", message: USE_GO });
  expect(calls).toHaveLength(0);
});
test("estimate comes first; save bypasses stale SW bytes, lists and removes complete copies", async () => {
  Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: async () => { expect(calls).toHaveLength(0); return { usage: 0, quota }; } } });
  expect(await keepOnDevice({ id: "media-nova00" })).toEqual({ ok: true });
  expect(calls[1]).toContain("download=1");
  expect((await listKept()).map((item) => item.id)).toEqual(["media-nova00"]);
  await removeFromDevice("media-nova00"); expect(kept.size).toBe(0);
  calls = [];
  await keepOnDevice({ id: "media-nova00" }); await removeAllOfflineMedia(); expect(await listKept()).toEqual([]);
});
test("quota refusal and quota exceptions map to storageFull", async () => {
  quota = 1;
  expect(await keepOnDevice({ id: "media-nova00" })).toMatchObject({ ok: false, code: "storageFull" });
  expect(calls).toHaveLength(1);
  quota = 10_000_000; failPut = true;
  expect(await keepOnDevice({ id: "media-nova00" })).toMatchObject({ ok: false, code: "storageFull" });
  expect(await listKept()).toEqual([]);
});
test("HTTP failures map to plain codes", async () => {
  for (const [status, code] of [[403, "revoked"], [401, "revoked"], [404, "notOnServer"], [409, "notPlayable"], [503, "notReady"], [500, "network"]] as const) {
    globalThis.fetch = (async () => new Response("", { status })) as unknown as typeof fetch;
    expect(await keepOnDevice({ id: "media-nova00" })).toMatchObject({ ok: false, code });
  }
  globalThis.fetch = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
  expect(await keepOnDevice({ id: "media-nova00" })).toMatchObject({ ok: false, code: "network" });
});
test("unready and unplayable manifests, outside asset paths and changed fingerprints are refused", async () => {
  for (const [patch, code] of [[{ ready: false, reason: "notReady" }, "notReady"], [{ ready: false, reason: "notPlayable", playable: "none" }, "notPlayable"], [{ url: "//example.com/bytes" }, "network"], [{ artwork_url: "/api/other" }, "network"]] as const) {
    const value = manifest(); Object.assign(value.entries[0]!, patch);
    globalThis.fetch = (async () => Response.json(value)) as unknown as typeof fetch;
    expect(await keepOnDevice({ id: "media-nova00" })).toMatchObject({ ok: false, code });
  }
  globalThis.fetch = (async (url: unknown) => String(url).includes("manifest?") ? Response.json(manifest()) : new Response("0123456789", { headers: { ETag: '\"changed\"', "Content-Length": "10" } })) as unknown as typeof fetch;
  expect(await keepOnDevice({ id: "media-nova00" })).toMatchObject({ ok: false, code: "notReady" });
  expect(await listKept()).toEqual([]);
});
