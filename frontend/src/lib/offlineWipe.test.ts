import { afterEach, beforeEach, expect, test } from "bun:test";
import { request } from "@/lib/api";
import { MEDIA_CACHE } from "@/lib/offlineMedia";

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
let deleted: string[] = [];
beforeEach(() => {
  deleted = [];
  Object.assign(globalThis, { caches: { delete: async (name: string) => { deleted.push(name); return true; } } });
});
afterEach(() => { Object.assign(globalThis, { fetch: originalFetch, caches: originalCaches }); });
const reply = (status: number, body: object) => { globalThis.fetch = (async () => Response.json(body, { status })) as unknown as typeof fetch; };

test("an expired session (401) keeps the kept copies so signing in again finds them", async () => {
  reply(401, { error: "Unauthorized" });
  await request("/api/media/items").catch(() => undefined);
  expect(deleted).toEqual([]);
});
test("a 403 without the revoked code keeps the copies", async () => {
  reply(403, { error: "No offline permission", code: "offline_scope_missing" });
  await request("/api/media/offline/manifest?id=x").catch(() => undefined);
  expect(deleted).toEqual([]);
});
test("a revoked device (403 device_revoked) removes every copy", async () => {
  reply(403, { error: "No longer paired", code: "device_revoked" });
  await request("/api/media/offline/manifest?id=x").catch(() => undefined);
  expect(deleted).toEqual([MEDIA_CACHE]);
});
test("an explicit sign-out removes every copy, a sign-in does not", async () => {
  reply(200, { success: true });
  await request("/api/auth/verify-secret", { method: "POST", body: "{}" });
  expect(deleted).toEqual([]);
  await request("/api/auth/logout", { method: "POST" });
  expect(deleted).toEqual([MEDIA_CACHE]);
});
