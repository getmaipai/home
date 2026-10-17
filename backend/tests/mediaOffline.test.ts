import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { OfflineManifest } from "@maipai/spec/gen/ts/offline-manifest.js";
import { db } from "@/db";
import { devices, deviceTokens, mediaItems, mediaSources, people, mediaProgress } from "@/db/schema";
import { issueDeviceToken, hashDeviceToken } from "@/lib/deviceTokens";
import { deleteDevice, setDeviceOfflineScope } from "@/lib/devices";
import { __resetProgressForTests, getProgress, writeProgress } from "@/lib/media/progress";
import { readableItem } from "@/lib/media/access";
import { decidePlayable } from "@/lib/media/kinds";
import { newMediaItemId, newMediaSourceId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { runBackup, restoreBackup } from "@/lib/backup";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const dirs: string[] = [];
beforeEach(() => { resetDb(); __resetProgressForTests(); });
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const iso = (ms: number) => new Date(ms).toISOString();
const base = "/api/media/offline";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function setup() {
  const owner = new TestClient();
  const response = await owner.post("/api/auth/setup", { displayName: "atlas", secret: "correcthorse" });
  expect(response.status).toBe(201);
  const actor = db.select().from(people).get()!;
  const root = mkdtempSync(join(tmpdir(), "maipai-offline-")); dirs.push(root);
  writeFileSync(join(root, "nova.mp4"), "0123456789");
  writeFileSync(join(root, "cover.jpg"), "picture");
  utimesSync(join(root, "nova.mp4"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  const sourceId = newMediaSourceId();
  const id = newMediaItemId();
  const now = new Date().toISOString();
  db.insert(mediaSources).values({ id: sourceId, kind: "root", scope: "household", label: "nova", rootPath: root, rootKinds: '["video"]', createdAt: now, hlc: nextHlc(), provenance: "hub" }).run();
  db.insert(mediaItems).values({ id, kind: "video", title: "nova", sourceId, locRootId: sourceId, locPath: "nova.mp4", mediaType: "video/mp4", durationS: 100, size: 10, videoCodec: "h264", playable: "original", fingerprint: "10-1767225600000", bandOk: "child", addedAt: now, createdAt: now, hlc: nextHlc(), provenance: "hub", artwork: JSON.stringify({ path: "cover.jpg" }), chapters: JSON.stringify([{ start_s: 0, title: "nova", source: "manual" }]) }).run();
  const issued = issueDeviceToken(actor.id, "phone", "atlas");
  const client = new TestClient();
  const allow = () => setDeviceOfflineScope(issued.deviceId, ["media.offline"]);
  const get = (path: string, headers: Record<string, string> = {}) => client.get(base + path, { ...auth(issued.token), ...headers });
  const post = (path: string, body: unknown) => client.request(base + path, { method: "POST", headers: auth(issued.token), body });
  const event = (at = iso(Date.now()), position_s = 10) => ({ kind: "media", id, position_s, duration_s: 100, at, finished: false });
  return { owner, actor, root, id, sourceId, issued, client, allow, get, post, event };
}

async function refusedFour(s: Awaited<ReturnType<typeof setup>>) {
  expect((await s.get(`/manifest?id=${s.id}`)).status).toBe(403);
  expect((await s.get(`/file/media/${s.id}`)).status).toBe(403);
  expect((await s.post("/status", { items: [{ kind: "media", id: s.id, fingerprint: "old" }] })).status).toBe(403);
  expect((await s.post("/progress", { sent_at: iso(Date.now()), events: [s.event()] })).status).toBe(403);
}

describe("offline admission", () => {
  test("default-deny on all four, including the wrong scope, malformed scope and a valid cookie beside a bad bearer", async () => {
    const s = await setup();
    expect(db.select().from(devices).get()!.offlineScope).toBe("[]");
    await refusedFour(s);
    setDeviceOfflineScope(s.issued.deviceId, ["offline.records"]); await refusedFour(s);
    for (const offlineScope of ['"media.offline"', '["media.offline","unknown"]', 'oops']) {
      db.update(devices).set({ offlineScope }).where(eq(devices.id, s.issued.deviceId)).run(); await refusedFour(s);
    }
    expect((await s.owner.get(`${base}/manifest?id=${s.id}`, auth("bad"))).status).toBe(403);
    expect((await s.owner.get(`${base}/manifest?id=${s.id}`)).status).toBe(200);
    expect((await s.client.get(`${base}/manifest?id=${s.id}`)).status).toBe(401);
  });
  test("only a revoked device carries the device_revoked code; a missing scope or an expired session does not", async () => {
    const s = await setup();
    const code = async (res: Response) => (await res.json() as { code?: string }).code;
    expect(await code(await s.get(`/manifest?id=${s.id}`))).toBe("offline_scope_missing");
    s.allow();
    expect(deleteDevice(s.issued.deviceId, s.actor.id)).toBe(true);
    const gone = await s.get(`/manifest?id=${s.id}`);
    expect(gone.status).toBe(403); expect(await code(gone)).toBe("device_revoked");
    const expired = await s.client.get(`${base}/manifest?id=${s.id}`);
    expect(expired.status).toBe(401); expect(await code(expired)).toBeUndefined();
  });
  test("scoped device bearer stays denied outside the offline router, and cannot grant itself scope", async () => {
    const s = await setup(); s.allow();
    expect((await s.get(`/manifest?id=${s.id}`)).status).toBe(200);
    for (const path of ["/api/media/sources", "/api/media/items", "/api/people", "/api/settings", "/api/devices", "/api/auth/me", "/api/media/progress/" + s.id]) expect([401, 403]).toContain((await s.client.get(path, auth(s.issued.token))).status);
    expect((await s.client.request(`/api/devices/${s.issued.deviceId}/offline-scope`, { method: "PATCH", headers: auth(s.issued.token), body: { offline_scope: ["media.offline"] } })).status).toBeOneOf([401, 403]);
  });
  test("revocation, expiry, inactivity, disabled or deleted person all refuse every route immediately", async () => {
    const s = await setup(); s.allow();
    for (const change of [{ expiresAt: iso(Date.now() - 1) }, { expiresAt: iso(Date.now() + 86400_000), lastSeenAt: iso(Date.now() - 181 * 86400_000) }]) {
      db.update(deviceTokens).set(change).run(); await refusedFour(s);
    }
    db.update(deviceTokens).set({ expiresAt: iso(Date.now() + 86400_000), lastSeenAt: iso(Date.now()) }).run();
    db.update(people).set({ enabled: false }).run(); await refusedFour(s);
    db.update(people).set({ enabled: true, deletedAt: iso(Date.now()) }).run(); await refusedFour(s);
    db.update(people).set({ deletedAt: null }).run();
    expect(deleteDevice(s.issued.deviceId, s.actor.id)).toBe(true); await refusedFour(s);
  });
  test("password change revokes a previously working bearer", async () => {
    const s = await setup(); s.allow();
    expect((await s.get(`/manifest?id=${s.id}`)).status).toBe(200);
    expect((await s.owner.post("/api/auth/change-secret", { currentSecret: "correcthorse", newSecret: "anothercorrecthorse" })).status).toBe(200);
    await refusedFour(s);
  });
  test("scope editing is own-or-admin only, rejects unknown scopes and honours CSRF", async () => {
    const s = await setup();
    const otherResponse = await s.owner.post("/api/people", { displayName: "pippa", role: "adult", secret: "0000" });
    const otherId = (await otherResponse.json() as { id: string }).id;
    const other = new TestClient(); await other.post("/api/auth/verify-secret", { personId: otherId, secret: "0000" });
    const path = `/api/devices/${s.issued.deviceId}/offline-scope`;
    const body = { offline_scope: ["media.offline"] };
    expect((await other.request(path, { method: "PATCH", body })).status).toBe(404);
    expect((await s.owner.request(path, { method: "PATCH", body, headers: { origin: "https://example.com" } })).status).toBe(403);
    expect((await s.owner.request(path, { method: "PATCH", body: { offline_scope: ["all"] } })).status).toBe(400);
    expect((await s.owner.request(path, { method: "PATCH", body })).status).toBe(200);
    expect((await s.get(`/manifest?id=${s.id}`)).status).toBe(200);
    expect((await s.owner.request(path, { method: "PATCH", body: { offline_scope: [] } })).status).toBe(200);
    await refusedFour(s);
  });
});

describe("manifest, file and status", () => {
  test("manifest validates against spec, with hub-only assets, chapters and this person's progress", async () => {
    const s = await setup(); s.allow();
    writeProgress(s.actor, readableItem(s.actor, s.id)!, { position: { seconds: 12 }, stamp: iso(Date.now()), duration_s: 100 }, { immediate: true });
    const res = await s.get(`/manifest?id=${s.id}`);
    expect(res.status).toBe(200);
    const manifest = OfflineManifest.parse(await res.json());
    expect(manifest).toMatchObject({ kind: "media", id: s.id, total_bytes: 10 });
    expect(manifest.entries[0]).toMatchObject({ fingerprint: "10-1767225600000", ready: true, playable: "original", reason: null, duration_s: 100, progress: { position_s: 12, completed: false }, chapters: [{ start_s: 0, title: "nova" }] });
    expect(manifest.entries[0]!.url).toBe(`${base}/file/media/${s.id}`);
    expect(await (await s.get(`/file/artwork/${s.id}`)).text()).toBe("picture");
    expect((await s.get(`/file/subtitle/${s.id}`)).status).toBe(404);
    rmSync(join(s.root, "nova.mp4"));
    expect((await (await s.get(`/manifest?id=${s.id}`)).json() as OfflineManifest).entries[0]).toMatchObject({ ready: false, reason: "notOnServer" });
    expect((await s.get(`/file/media/${s.id}`)).status).toBe(404);
  });
  test("Range, ETag, Last-Modified, If-Range match and mismatch, 416 and no-store", async () => {
    const s = await setup(); s.allow();
    const full = await s.get(`/file/media/${s.id}`);
    expect(full.status).toBe(200); expect(await full.text()).toBe("0123456789");
    const etag = full.headers.get("etag")!; const modified = full.headers.get("last-modified")!;
    expect(etag).toBe('"10-1767225600000"'); expect(modified).toBe("Thu, 01 Jan 2026 00:00:00 GMT");
    expect(full.headers.get("cache-control")).toBe("private, no-store");
    for (const ifRange of [etag, modified]) {
      const part = await s.get(`/file/media/${s.id}`, { Range: "bytes=2-4", "If-Range": ifRange });
      expect(part.status).toBe(206); expect(await part.text()).toBe("234"); expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    }
    for (const ifRange of ['"old"', `W/${etag}`, "Wed, 31 Dec 2025 00:00:00 GMT", "bad"]) expect((await s.get(`/file/media/${s.id}`, { Range: "bytes=2-4", "If-Range": ifRange })).status).toBe(200);
    expect(await (await s.get(`/file/media/${s.id}`, { Range: "bytes=-3" })).text()).toBe("789");
    const unsatisfiable = await s.get(`/file/media/${s.id}`, { Range: "bytes=99-100" });
    expect(unsatisfiable.status).toBe(416); expect(unsatisfiable.headers.get("etag")).toBe(etag);
  });
  test("not playable gives 409; transcode and unknown give 503 with Retry-After", async () => {
    const s = await setup(); s.allow();
    for (const [playable, status, reason] of [["none", 409, "notPlayable"], ["transcode", 503, "notReady"], ["unknown", 503, "notReady"]] as const) {
      db.update(mediaItems).set({ playable, videoCodec: null }).run();
      const res = await s.get(`/file/media/${s.id}`);
      expect(res.status).toBe(status); expect(typeof (await res.json() as { error: string }).error).toBe("string");
      if (status === 503) expect(res.headers.get("retry-after")).toBe("60");
      expect((await (await s.get(`/manifest?id=${s.id}`)).json() as OfflineManifest).entries[0]).toMatchObject({ ready: false, reason });
    }
    expect(decidePlayable({ ext: "mp4", hasVideo: true, hasAudio: true, videoCodec: "hvc1", audioCodec: "aac" })).toBe("original");
    expect(decidePlayable({ ext: "mp4", hasVideo: true, hasAudio: false, videoCodec: "hevc", audioCodec: null })).toBe("transcode");
  });
  test("status ok, changed, gone and wrong-kind; hidden, trashed and invisible sources look gone", async () => {
    const s = await setup(); s.allow();
    const check = async () => await (await s.post("/status", { items: [{ kind: "media", id: s.id, fingerprint: "10-1767225600000" }, { kind: "media", id: s.id, fingerprint: "old" }, { kind: "track", id: s.id, fingerprint: "old" }] })).json() as { items: Array<{ status: string }> };
    expect((await check()).items.map((i) => i.status)).toEqual(["ok", "changed", "gone"]);
    for (const change of [{ hidden: true }, { hidden: false, deletedAt: iso(Date.now()) }]) {
      db.update(mediaItems).set(change).run(); expect((await check()).items.every((i) => i.status === "gone")).toBe(true);
      expect((await s.get(`/manifest?id=${s.id}`)).status).toBe(404);
      expect((await s.get(`/file/media/${s.id}`)).status).toBe(404);
    }
    db.update(mediaItems).set({ deletedAt: null }).run(); db.update(mediaSources).set({ visibleTo: "[]" }).run();
    expect((await check()).items.every((i) => i.status === "gone")).toBe(true);
  });
  test("a child's scoped device cannot read an adult item or its assets, nor write progress", async () => {
    const s = await setup(); s.allow();
    db.update(people).set({ role: "child", birthdate: "2018-03-01" }).run();
    db.update(mediaItems).set({ bandOk: "adult" }).run();
    for (const path of [`/manifest?id=${s.id}`, `/file/media/${s.id}`, `/file/artwork/${s.id}`, `/file/subtitle/${s.id}`]) expect((await s.get(path)).status).toBe(404);
    const statuses = await (await s.post("/status", { items: [{ kind: "media", id: s.id, fingerprint: "old" }] })).json() as { items: Array<{ status: string }> };
    expect(statuses.items[0]!.status).toBe("gone");
    expect((await (await s.post("/progress", { sent_at: iso(Date.now()), events: [s.event()] })).json() as { results: Array<{ status: string }> }).results[0]!.status).toBe("gone");
    expect(db.select().from(mediaProgress).all()).toHaveLength(0);
  });
});

describe("progress batches", () => {
  test("corrects negative clock skew, clamps a small future stamp and keeps the newer position including a rewind", async () => {
    const s = await setup(); s.allow();
    const now = Date.now(); const sent_at = iso(now - 3600_000);
    const res = await s.post("/progress", { sent_at, events: [s.event(iso(now - 3600_000 - 60_000), 70), s.event(iso(now - 3600_000 - 120_000), 10), s.event(iso(now - 3600_000 + 1000), 20)] });
    expect(res.status).toBe(200);
    expect((await res.json() as { results: Array<{ status: string }> }).results.map((r) => r.status)).toEqual(["applied", "older", "applied"]);
    const saved = getProgress(s.actor.id, s.id)!;
    expect(saved.position).toEqual({ seconds: 20 }); expect(saved.device_id).toBe(s.issued.deviceId);
    expect(Date.parse(saved.updated_at)).toBeGreaterThanOrEqual(now); expect(Date.parse(saved.updated_at)).toBeLessThanOrEqual(Date.now());
  });
  test("restamp is atomic for a batch over five minutes ahead, whether sent_at or a corrected event", async () => {
    const s = await setup(); s.allow();
    for (const [sent_at, at] of [[iso(Date.now() + 600_000), iso(Date.now() + 600_000)], [iso(Date.now()), iso(Date.now() + 600_000)]]) {
      const res = await s.post("/progress", { sent_at, events: [s.event(sent_at, 10), s.event(at, 20)] });
      expect(res.status).toBe(400); expect(await res.json()).toEqual({ error: "restamp" });
      expect(getProgress(s.actor.id, s.id)).toBeNull();
    }
  });
  test("minor device identity cannot be supplied or forged, and a device transferred away from the token owner fails closed", async () => {
    const s = await setup(); s.allow();
    db.update(people).set({ role: "child", birthdate: "2018-03-01" }).run();
    const now = iso(Date.now());
    expect((await s.post("/progress", { sent_at: now, events: [{ ...s.event(now), device_id: "device-forged000" }] })).status).toBe(400);
    expect((await s.post("/progress", { sent_at: now, events: [s.event(now)] })).status).toBe(200);
    const row = db.select().from(mediaProgress).get()!; expect(row.deviceId).toBe(s.issued.deviceId);
    const otherId = "person-pippa0000";
    db.insert(people).values({ id: otherId, displayName: "pippa", role: "child", avatarSeed: "pippa", birthdate: "2018-03-01", source: "hub", createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
    db.update(devices).set({ personId: otherId }).run(); await refusedFour(s);
    const actor = db.select().from(people).where(eq(people.id, s.actor.id)).get()!;
    const refused = writeProgress(actor, readableItem(actor, s.id)!, { position: { seconds: 1 }, device_id: s.issued.deviceId, stamp: now }, { immediate: true });
    expect(refused).toEqual({ ok: false, refusal: "other_persons_device" });
  });
  test("batch caps and malformed input refuse before writing", async () => {
    const s = await setup(); s.allow();
    expect((await s.post("/status", { items: Array.from({ length: 501 }, () => ({ kind: "media", id: s.id, fingerprint: "old" })) })).status).toBe(400);
    expect((await s.post("/progress", { sent_at: iso(Date.now()), events: Array.from({ length: 201 }, () => s.event()) })).status).toBe(400);
    for (const event of [{ ...s.event(), position_s: -1 }, { ...s.event(), at: "invalid" }, { ...s.event(), id: "" }]) expect((await s.post("/progress", { sent_at: iso(Date.now()), events: [event] })).status).toBe(400);
    expect(db.select().from(mediaProgress).all()).toHaveLength(0);
  });
});

test("a real backup contains no device tokens or token hash bytes, while the live token stays usable", async () => {
  const s = await setup(); s.allow();
  const backup = await runBackup();
  const dir = mkdtempSync(join(tmpdir(), "maipai-offline-restore-")); dirs.push(dir);
  const path = join(dir, "restored.db"); await restoreBackup(backup.filename, path);
  const restored = new Database(path, { readonly: true });
  try { expect(restored.query("SELECT count(*) AS n FROM device_tokens").get()).toEqual({ n: 0 }); }
  finally { restored.close(); }
  expect(readFileSync(path).includes(Buffer.from(hashDeviceToken(s.issued.token)))).toBe(false);
  expect((await s.get(`/manifest?id=${s.id}`)).status).toBe(200);
});
