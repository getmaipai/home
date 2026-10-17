// MEDIA-KID-01: refusal tests first. All rows are hand-written, with no media service traffic.
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources, people, notificationDeliveries, notificationHolds } from "@/db/schema";
import { getSettingValueForPerson } from "@/lib/settings";
import { discoveryAllowed } from "@/lib/media/access";
import { mediaBudget, mediaDay, extendMediaBudget, MEDIA_KID_COPY, SESSION_ROW_CAP } from "@/lib/media/watchTime";
import { createDevice } from "@/lib/devices";
import { erasePersonData } from "@/lib/personLifecycle";
import { lintSettingCopy } from "@maipai/spec/interpreters/ts/describeSetting.js";
import { MEDIA_SETTINGS_KEYS } from "@/settings/mediaKeys";
import { mediaWatchDays, mediaWatchSessions } from "@/db/schema";
import { __resetProgressForTests, writeProgress, getProgress } from "@/lib/media/progress";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); __resetProgressForTests(); });

async function setup() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "atlas", secret: "correcthorse" })).status).toBe(201);
  async function person(displayName: string, role: string) {
    const res = await owner.post("/api/people", { displayName, role, secret: "0000" });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const client = new TestClient();
    expect((await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" })).status).toBe(200);
    return { id, client, row: db.select().from(people).where(eq(people.id, id)).get()! };
  }
  const child = await person("sprout", "child");
  const teen = await person("nova", "teen");
  const adult = await person("pippa", "adult");
  const admin = await person("orbit", "admin");
  const now = new Date().toISOString();
  function source(id: string, kind = "root", visibleTo: string | string[] = "household", scope = "household") {
    db.insert(mediaSources).values({ id, kind, scope, ownerPersonId: scope === "person" ? child.id : null, label: "Library", rootPath: kind === "root" ? "/fixture" : null, rootKinds: '["video","track"]', url: kind === "root" ? null : "https://example.com/channel", visibleTo: JSON.stringify(visibleTo), createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  }
  function item(id: string, sourceId: string, kind = "video", explicit = false) {
    db.insert(mediaItems).values({ id, sourceId, kind, title: "Moon song", locUrl: "https://example.com/media", mediaType: "video/mp4", playable: "unknown", size: 100, bandOk: "child", advisoryExplicit: explicit, addedAt: now, createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
    return id;
  }
  source("msrc-library0001");
  const video = item("media-video000001", "msrc-library0001");
  const set = (scope: string, key: string, value: unknown, client = owner) => client.put("/api/settings", { scope, key, value });
  const put = (client: TestClient, id = video, body: Record<string, unknown> = {}) => client.put(`/api/media/progress/${id}`, { position: { seconds: 0 }, immediate: true, ...body });
  return { owner, child, teen, adult, admin, source, item, video, set, put };
}

test("allowlist defaults and write refusals survive set and reset; an admin can override one child", async () => {
  const { child, adult, admin, set } = await setup();
  expect(getSettingValueForPerson(child.id, "media.allowlist_only")).toBe(true);
  expect(getSettingValueForPerson(adult.id, "media.allowlist_only")).toBe(false);
  expect((await set(`person:${child.id}`, "media.allowlist_only", false, child.client)).status).toBe(403);
  expect((await child.client.post("/api/settings/reset", { scope: `person:${child.id}`, key: "media.allowlist_only" })).status).toBe(403);
  expect((await set(`person:${child.id}`, "allowance.media.daily_minutes", 0, child.client)).status).toBe(403);
  expect((await child.client.post("/api/settings/reset", { scope: `person:${child.id}`, key: "allowance.media.daily_minutes" })).status).toBe(403);
  expect((await set(`person:${child.id}`, "media.allowlist_only", false, admin.client)).status).toBe(200);
  expect(getSettingValueForPerson(child.id, "media.allowlist_only")).toBe(false);
});

test("a child's library and search hide unfollowed sources and explicit tracks for both minor bands", async () => {
  const { child, teen, adult, source, item, video, set } = await setup();
  source("msrc-channel0001", "channel");
  const unfollowed = item("media-channel001", "msrc-channel0001");
  source("msrc-followed001", "channel", [child.id]);
  const followed = item("media-followed01", "msrc-followed001");
  const explicit = item("media-explicit01", "msrc-library0001", "track", true);
  for (const query of ["", "q=Moon", "kind=track", "kind=track&q=Moon"]) {
    const rows = await (await child.client.get(`/api/media/items?${query}`)).json() as { items: Array<{ id: string }> };
    expect(rows.items.map((i) => i.id)).not.toContain(unfollowed);
    expect(rows.items.map((i) => i.id)).not.toContain(explicit);
    const teenRows = await (await teen.client.get(`/api/media/items?${query}`)).json() as { items: Array<{ id: string }> };
    expect(teenRows.items.map((i) => i.id)).not.toContain(explicit);
  }
  expect((await child.client.get(`/api/media/items/${unfollowed}`)).status).toBe(404);
  for (const id of [video, followed]) expect((await child.client.get(`/api/media/items/${id}`)).status).toBe(200);
  expect((await adult.client.get(`/api/media/items/${explicit}`)).status).toBe(200);
  await set(`person:${child.id}`, "media.allowlist_only", false);
  expect((await child.client.get(`/api/media/items/${unfollowed}`)).status).toBe(200);
  expect((await child.client.get(`/api/media/items/${explicit}`)).status).toBe(404);
});

test("only admins can extend, only the asking person reads a budget, and minors cannot exempt audio", async () => {
  const { owner, child, teen, adult, admin, set } = await setup();
  for (const client of [child.client, teen.client, adult.client]) expect((await client.post(`/api/media/budget/${child.id}/extend`, { minutes: 10 })).status).toBe(403);
  expect((await set("household", "media.budget.exempt_bedtime_audio", true, child.client)).status).toBe(403);
  expect((await new TestClient().get("/api/media/budget")).status).toBe(401);
  expect((await set(`person:${child.id}`, "allowance.media.daily_minutes", 5)).status).toBe(200);
  expect((await admin.client.post(`/api/media/budget/${child.id}/extend`, { minutes: 10 })).status).toBe(200);
  expect(await (await child.client.get("/api/media/budget")).json()).toEqual({ limit_min: 15, used_min: 0, left_min: 15, exhausted: false });
  expect(await (await owner.get("/api/media/budget")).json()).toEqual({ limit_min: 0, used_min: 0, left_min: 0, exhausted: false });
});

test("budget routes reject invalid extensions and missing people", async () => {
  const { owner, child } = await setup();
  for (const minutes of [0, -1, 0.5, "10"]) expect((await owner.post(`/api/media/budget/${child.id}/extend`, { minutes })).status).toBe(400);
  expect((await owner.post("/api/media/budget/pers-missing000/extend", { minutes: 10 })).status).toBe(404);
});

// Notification assertions are used by the metering tests below too: both ready and held deliveries count.
function timeUpRows() {
  return [...db.select().from(notificationDeliveries).where(eq(notificationDeliveries.typeId, "media_time_up")).all(), ...db.select().from(notificationHolds).where(eq(notificationHolds.typeId, "media_time_up")).all()];
}


// The injected clock keeps elapsed-time assertions deterministic, with no server, service or waits.
function clock() { const date = new Date(); date.setHours(12, 0, 0, 0); return date; }
function at(base: Date, seconds: number) { return new Date(base.getTime() + seconds * 1000); }
function tick(person: Awaited<ReturnType<typeof setup>>["child"], mediaId: string, now: Date, seconds: number, options: Partial<Parameters<typeof writeProgress>[2]> & { meterKey?: string } = {}, kind: "video" | "track" | "audiobook" | "chapter" | "podcast_episode" | "book" = "video") {
  const { meterKey, ...write } = options;
  return writeProgress(person.row, { id: mediaId, kind }, { position: { seconds }, stamp: now.toISOString(), ...write }, { now, immediate: true, meterKey: meterKey ?? "run" });
}

test("discovery follows the allowlist, and both new settings pass the copy lint", async () => {
  const { child, teen, adult, set } = await setup();
  expect(discoveryAllowed(child.row)).toBe(false);
  expect(discoveryAllowed(teen.row)).toBe(true);
  expect(discoveryAllowed(adult.row)).toBe(true);
  await set(`person:${child.id}`, "media.allowlist_only", false);
  expect(discoveryAllowed(child.row)).toBe(true);
  expect(lintSettingCopy(MEDIA_SETTINGS_KEYS, [])).toEqual([]);
  expect(Object.values(MEDIA_KID_COPY)).toEqual(["Screen time is done for today.", "Ask a grown-up for more.", "Not for you yet. Tap to ask a grown-up."]);
});

test("playing time accumulates from the server clock; seeks count only wall-clock time, rewinds and replays nothing", async () => {
  const { child, video } = await setup(); const start = clock();
  tick(child, video, start, 0);
  tick(child, video, at(start, 10), 10); // +10
  tick(child, video, at(start, 20), 900); // forward seek: only the 10 s of wall clock
  tick(child, video, at(start, 30), 910); // +10
  tick(child, video, at(start, 30), 910); // replay
  tick(child, video, at(start, 25), 905); // old
  tick(child, video, at(start, 40), 100); // rewind: nothing
  tick(child, video, at(start, 50), 110); // +10
  tick(child, video, at(start, 600), 110); // no forward movement: nothing
  tick(child, video, at(start, 610), 120); // +10
  tick(child, video, at(start, 620), 125); // +5, position advanced less than the clock
  tick(child, video, at(start, 630), 135); // +10
  expect(mediaBudget(child.id, start).used_min).toBeCloseTo(65 / 60);
  tick(child, video, at(start, 640), 149); // a 14 s jump in 10 s is a seek: 10 s
  expect(mediaBudget(child.id, start).used_min).toBeCloseTo(75 / 60);
});

test("cursors are per server key and item; a foreign device adds no usage or place", async () => {
  const { child, adult, video } = await setup(); const start = clock();
  const a = createDevice("browser", "Tablet", child.id);
  const b = createDevice("browser", "Phone", child.id);
  const foreign = createDevice("browser", "TV", adult.id);
  tick(child, video, start, 0, { device_id: a.id });
  tick(child, video, at(start, 10), 10, { device_id: a.id });
  tick(child, video, at(start, 11), 500, { device_id: b.id, meterKey: "other" });
  tick(child, video, at(start, 21), 510, { device_id: b.id, meterKey: "other" });
  expect(tick(child, video, at(start, 42), 920, { device_id: foreign.id })).toEqual({ ok: false, refusal: "other_persons_device" });
  expect(mediaBudget(child.id, start).used_min).toBeCloseTo(20 / 60);
  expect(getProgress(child.id, video)?.position).toEqual({ seconds: 510 });
  __resetProgressForTests(); // cursor is persisted, no in-memory reset can forget usage or baseline
  tick(child, video, at(start, 30), 20, { device_id: a.id });
  expect(mediaBudget(child.id, start).used_min).toBeCloseTo(30 / 60);
});

test("coalescing never drops metered ticks, and switching items starts a baseline", async () => {
  const { child, video, item } = await setup(); const start = clock();
  const other = item("media-another001", "msrc-library0001");
  for (let n = 0; n <= 10; n++) writeProgress(child.row, { id: video, kind: "video" }, { position: { seconds: n }, stamp: at(start, n).toISOString() }, { now: at(start, n), coalesceMs: 100000 });
  expect(mediaBudget(child.id, start).used_min).toBeCloseTo(10 / 60);
  expect(getProgress(child.id, video)?.position).toEqual({ seconds: 10 });
  tick(child, other, at(start, 20), 1000, { meterKey: "-" });
  expect(mediaBudget(child.id, start).used_min).toBeCloseTo(10 / 60);
});

test("a child sending seeking:true and playing:false on every write while the position advances still reaches the budget", async () => {
  const { child, video, set } = await setup(); const start = clock();
  await set(`person:${child.id}`, "allowance.media.daily_minutes", 1);
  for (let n = 0; n <= 6; n++) tick(child, video, at(start, n * 10), n * 10, { seeking: true, playing: false, events: { skip: true } });
  expect(mediaBudget(child.id, start)).toEqual({ limit_min: 1, used_min: 1, left_min: 0, exhausted: true });
});

test("the client stamp is not trusted: back-dated or future stamps meter by the server clock", async () => {
  const { child, video } = await setup(); const start = clock();
  tick(child, video, start, 0, { stamp: new Date(start.getTime() - 3_600_000).toISOString() });
  tick(child, video, at(start, 10), 10, { stamp: new Date(start.getTime() + 3_600_000).toISOString() });
  expect(mediaBudget(child.id, start).used_min).toBeCloseTo(10 / 60);
});

test("a client rotating session_id and device_id on every write still reaches the daily budget", async () => {
  const { child, video, set, put } = await setup(); const start = clock();
  await set(`person:${child.id}`, "allowance.media.daily_minutes", 1);
  const devices = Array.from({ length: 7 }, (_, n) => createDevice("browser", `Tablet ${n}`, child.id));
  for (let n = 0; n <= 6; n++) {
    // The metering key is the server's (here one authenticated session); every field the client varies is ignored for it.
    tick(child, video, at(start, n * 10), n * 10, { device_id: devices[n]!.id, session_id: `fresh-${n}` } as never, "video");
  }
  expect(mediaBudget(child.id, start)).toEqual({ limit_min: 1, used_min: 1, left_min: 0, exhausted: true });
  // Over HTTP an unknown session_id field is simply not part of the request any more.
  expect((await put(child.client, video, { position: { seconds: 80 }, session_id: "rotating" })).status).toBe(200);
});

test("cursor rows are pruned after two days and capped per person", async () => {
  const { child, adult, video } = await setup(); const start = clock();
  const old = new Date(start.getTime() - 3 * 86_400_000);
  tick(child, video, old, 0, { meterKey: "ancient" });
  for (let n = 0; n < SESSION_ROW_CAP + 20; n++) tick(child, video, at(start, n), 0, { meterKey: `k${n}` });
  const mine = db.select().from(mediaWatchSessions).where(eq(mediaWatchSessions.personId, child.id)).all();
  expect(mine.length).toBe(SESSION_ROW_CAP);
  expect(mine.some((row) => row.sessionKey.includes("ancient"))).toBe(false);
  tick(adult, video, start, 0, { meterKey: "adult-key" });
  expect(db.select().from(mediaWatchSessions).where(eq(mediaWatchSessions.personId, adult.id)).all()).toHaveLength(1);
});

test("every media kind counts across devices; the admin audio switch excludes only music and audiobooks", async () => {
  const { child, item, set } = await setup(); const start = clock();
  let t = 0;
  for (const kind of ["video", "track", "audiobook", "chapter", "podcast_episode", "book"] as const) {
    const id = item(`media-kind00000${t}`, "msrc-library0001", kind);
    const position = (seconds: number) => kind === "book" ? { locator: { kind: "page" as const, page: 1 }, percent: seconds } : { seconds };
    tick(child, id, at(start, t), 0, { position: position(0) }, kind);
    tick(child, id, at(start, t + 10), 10, { position: position(10) }, kind);
    t += 20;
  }
  expect(mediaBudget(child.id, start).used_min).toBe(1);
  expect((await set("household", "media.budget.exempt_bedtime_audio", true)).status).toBe(200);
  expect(mediaBudget(child.id, start).used_min).toBe(0.5);
  await set("household", "media.budget.exempt_bedtime_audio", false);
  expect(mediaBudget(child.id, start).used_min).toBe(1);
});

test("a minor saves a place after exhaustion; an admin extends today; notification is once per child/day", async () => {
  const { owner, child, video, set, put } = await setup(); const start = clock();
  await set(`person:${child.id}`, "allowance.media.daily_minutes", 1);
  for (let n = 0; n <= 6; n++) tick(child, video, at(start, n * 10), n * 10);
  expect(mediaBudget(child.id, start)).toEqual({ limit_min: 1, used_min: 1, left_min: 0, exhausted: true });
  const saved = await put(child.client, video, { position: { seconds: 70 } });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ progress: { position: { seconds: 70 } }, budget: { exhausted: true } });
  await Promise.resolve();
  expect(timeUpRows()).toHaveLength(2); // owner and admin, one delivery each
  for (const row of timeUpRows()) { expect(row.text).toBe("The daily screen time ran out. You can add more minutes for today."); }
  await owner.post(`/api/media/budget/${child.id}/extend`, { minutes: 1 });
  expect(mediaBudget(child.id, start)).toMatchObject({ limit_min: 2, exhausted: false });
  for (let n = 7; n <= 12; n++) tick(child, video, at(start, n * 10), n * 10);
  await Promise.resolve();
  expect(mediaBudget(child.id, start).exhausted).toBe(true);
  expect(timeUpRows()).toHaveLength(2);
  const tomorrow = new Date(start); tomorrow.setDate(tomorrow.getDate() + 1);
  expect(mediaBudget(child.id, tomorrow)).toEqual({ limit_min: 1, used_min: 0, left_min: 1, exhausted: false });
  for (let n = 0; n <= 6; n++) tick(child, video, at(tomorrow, n * 10), n * 10);
  await Promise.resolve();
  expect(timeUpRows()).toHaveLength(4);
});

test("teen exhaustion is enforced without sending their activity to admins", async () => {
  const { teen, video, set } = await setup(); const start = clock();
  expect((await set(`person:${teen.id}`, "allowance.media.daily_minutes", 1)).status).toBe(200);
  for (let n = 0; n <= 6; n++) tick(teen, video, at(start, n * 10), n * 10);
  expect(mediaBudget(teen.id, start).exhausted).toBe(true);
  expect(timeUpRows()).toHaveLength(0);
});

test("local midnight splits usage and expires today's extension", async () => {
  const { child, video, set } = await setup();
  await set(`person:${child.id}`, "allowance.media.daily_minutes", 1);
  const before = new Date(2026, 9, 17, 23, 59, 55);
  const after = at(before, 10);
  extendMediaBudget(child.id, 20, before);
  tick(child, video, before, 0);
  tick(child, video, after, 10);
  expect(mediaDay(before)).toBe("2026-10-17");
  expect(mediaDay(after)).toBe("2026-10-18");
  expect(mediaBudget(child.id, before)).toMatchObject({ limit_min: 21, used_min: 5 / 60 });
  expect(mediaBudget(child.id, after)).toMatchObject({ limit_min: 1, used_min: 5 / 60 });
});

test("leaving erases budget totals and session samples along with progress", async () => {
  const { child, video } = await setup(); const start = clock();
  tick(child, video, start, 0); tick(child, video, at(start, 10), 10);
  erasePersonData(child.id, []);
  expect(db.select().from(mediaWatchDays).where(eq(mediaWatchDays.personId, child.id)).all()).toEqual([]);
  expect(db.select().from(mediaWatchSessions).where(eq(mediaWatchSessions.personId, child.id)).all()).toEqual([]);
});
