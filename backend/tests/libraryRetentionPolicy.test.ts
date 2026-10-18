import { beforeEach, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, conversationTurns, issues, musicJobs, pictureJobs, notificationDeliveries, notificationHolds, people, settingsValues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { existsSync } from "node:fs";
import { createAttachment, readAttachment, attachmentFilePath } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { expiringLibraryFiles, previewLibraryRetention, runLibraryRetention } from "@/lib/libraryRetention";
import { listLibrary, librarySummary } from "@/lib/library";
import { LIBRARY_RETENTION_TYPES, retentionKeys } from "@/settings/libraryRetentionKeys";
beforeEach(resetDb);
const DAY = 86400000;
function fixture() {
  const now = new Date().toISOString();
  const actor = db.insert(people).values({ id: newPersonId(), displayName: "Sage", role: "owner", avatarSeed: "sage", source: "hub", createdAt: now, updatedAt: now, hlc: nextHlc() }).returning().get()!;
  const chat = resolveOrCreateConversation(actor, "chat");
  if (!chat.ok) throw new Error(chat.error);
  const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId: chat.value.id, userText: "picture", replyText: "saved", source: "model", safetyAction: "allow", createdAt: now, hlc: nextHlc() }).run();
  let distinct = 0; // LIBRARY-DEDUP-01: identical bytes are one stored file, so each fixture file gets its own bytes
  const make = (retention: "kept" | "conversation", generated = true, mediaType = "image/png") => {
    const cap = getHouseholdSettingValue("storage.household.cap_bytes");
    setHouseholdSettingValue("storage.household.cap_bytes", 0);
    const f = createAttachment(actor, { conversationId: chat.value.id, turnId, mediaType, bytes: new Uint8Array(10).fill(++distinct), retention, deduplicate: false });
    setHouseholdSettingValue("storage.household.cap_bytes", cap);
    if (!f.ok) throw new Error(f.error);
    if (generated) db.update(attachments).set({ provenance: `picture-gen:${JSON.stringify({ v: 1 })}` }).where(eq(attachments.id, f.value.id)).run();
    return f.value;
  };
  setHouseholdSettingValue("storage.household.cap_bytes", 25);
  return { actor, turnId, make };
}
test("defaults keep uploads and documents; threshold validation is bounded", () => {
  for (const type of LIBRARY_RETENTION_TYPES) {
    expect(getHouseholdSettingValue(retentionKeys(type).threshold)).toBe(90);
    expect(getHouseholdSettingValue(retentionKeys(type).mode)).toBe(["uploads", "documents", "trash"].includes(type) ? "keep" : "until_storage_threshold");
  }
  expect(getHouseholdSettingValue("storage.library.trash_days")).toBe(30);
  expect(setHouseholdSettingValue(retentionKeys("pictures").threshold, 101).ok).toBe(false);
  expect(setHouseholdSettingValue(retentionKeys("pictures").mode, "age").ok).toBe(false);
});
test("preview is read only; warning precedes removal by 24 hours; kept and uploads survive; chat stays", async () => {
  const f = fixture();
  const old = f.make("conversation"), kept = f.make("kept"), upload = f.make("conversation", false);
  const now = Date.parse("2026-10-18T01:00:00Z");
  const stateBefore = db.select().from(settingsValues).all();
  expect(previewLibraryRetention(now).count).toBe(1);
  expect(previewLibraryRetention(now).bytes).toBe(10);
  expect(db.select().from(settingsValues).all()).toEqual(stateBefore);
  expect((await runLibraryRetention(now)).deleted).toBe(0);
  expect(db.select().from(issues).all().some((i) => i.source === "library_retention")).toBe(true);
  const state = db.select().from(settingsValues).all();
  const notifications = () => db.select().from(notificationDeliveries).all().length + db.select().from(notificationHolds).all().length;
  const warned = notifications();
  expect(warned).toBeGreaterThan(0);
  expect((await runLibraryRetention(now)).deleted).toBe(0);
  expect(notifications()).toBe(warned);
  expect((await runLibraryRetention(now + 3600000)).deleted).toBe(0);
  expect(db.select().from(settingsValues).all()).toEqual(state);
  expect((await runLibraryRetention(now + DAY - 1)).deleted).toBe(0);
  expect((await runLibraryRetention(now + DAY)).deleted).toBe(1);
  expect(db.select().from(attachments).where(eq(attachments.id, old.id)).get()).toBeUndefined();
  expect(readAttachment(f.actor, old.id).ok).toBe(false);
  expect(existsSync(attachmentFilePath(old.storage_path))).toBe(false);
  for (const id of [kept.id, upload.id]) expect(db.select().from(attachments).where(eq(attachments.id, id)).get()).toBeDefined();
  expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, f.turnId)).get()).toBeDefined();
  const sameDayCount = notifications();
  f.make("conversation");
  expect((await runLibraryRetention(now + DAY + 3600000)).deleted).toBe(0);
  expect(notifications()).toBe(sameDayCount);
  expect((await runLibraryRetention(now + 2 * DAY)).deleted).toBe(0);
});
test("threshold is strict and keep rule wins over generated fallback", () => {
  const f = fixture(); f.make("conversation");
  setHouseholdSettingValue("storage.household.cap_bytes", 10 / 0.9);
  expect(previewLibraryRetention().count).toBe(0);
  setHouseholdSettingValue("storage.household.cap_bytes", 10);
  setHouseholdSettingValue(retentionKeys("pictures").mode, "keep");
  expect(previewLibraryRetention().count).toBe(0);
});

test("generated keep rule protects every display type", () => {
  const f = fixture(); f.make("conversation");
  setHouseholdSettingValue("storage.household.cap_bytes", 10);
  setHouseholdSettingValue(retentionKeys("generated").mode, "keep");
  expect(previewLibraryRetention().count).toBe(0);
});
test("an unset storage cap disables automatic removal", async () => {
  const f = fixture(); f.make("conversation");
  setHouseholdSettingValue("storage.household.cap_bytes", 0);
  expect(previewLibraryRetention().configured).toBe(false);
  expect((await runLibraryRetention()).deleted).toBe(0);
});
test("oldest first, stop at threshold, clean output jobs without touching the turn", async () => {
  const f = fixture();
  const old = f.make("conversation"), newer = f.make("conversation"), kept = f.make("kept");
  db.update(attachments).set({ createdAt: "2020-01-01T00:00:00Z" }).where(eq(attachments.id, old.id)).run();
  const at = "2026-10-18T01:00:00Z";
  db.insert(musicJobs).values({ id: "music-retention", personId: f.actor.id, turnId: f.turnId, task: "generate", request: "{}", state: "done", fileId: old.id, createdAt: at, updatedAt: at, hlc: nextHlc() }).run();
  db.insert(pictureJobs).values({ id: "picture-retention", personId: f.actor.id, turnId: f.turnId, kind: "generate", request: "{}", prompt: "a boat", state: "done", files: JSON.stringify([{ id: old.id }]), createdAt: at, updatedAt: at, hlc: nextHlc() }).run();
  expect(previewLibraryRetention().files.map((r) => r.id)).toEqual([old.id]);
  await runLibraryRetention(Date.parse(at));
  expect((await runLibraryRetention(Date.parse(at) + DAY)).deleted).toBe(1);
  expect(db.select().from(musicJobs).all()).toHaveLength(0);
  expect(db.select().from(pictureJobs).all()).toHaveLength(0);
  for (const id of [newer.id, kept.id]) expect(db.select().from(attachments).where(eq(attachments.id, id)).get()).toBeDefined();
  expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, f.turnId)).get()).toBeDefined();
});
test("changed rules restart the grace period", async () => {
  const f = fixture(); f.make("conversation"); f.make("kept"); f.make("kept");
  const now = Date.parse("2026-10-18T01:00:00Z");
  await runLibraryRetention(now);
  setHouseholdSettingValue(retentionKeys("pictures").threshold, 80);
  const warningCount = () => db.select().from(notificationDeliveries).all().length + db.select().from(notificationHolds).all().length;
  const count = warningCount();
  expect((await runLibraryRetention(now + 3600000)).deleted).toBe(0);
  expect(warningCount()).toBe(count);
  expect((await runLibraryRetention(now + DAY)).deleted).toBe(0);
  expect((await runLibraryRetention(now + 2 * DAY)).deleted).toBe(1);
});
test("preview route requires an admin and settings reject non-admin writes", async () => {
  const anon = new TestClient();
  expect((await anon.get("/api/library/retention/preview")).status).toBe(401);
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const res = await owner.get("/api/library/retention/preview");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ count: 0, bytes: 0 });
  const added = await owner.post("/api/people", { displayName: "Nova", role: "adult", secret: "correcthorse2" });
  const person = await added.json() as { id: string };
  const adult = new TestClient();
  await adult.post("/api/auth/verify-secret", { personId: person.id, secret: "correcthorse2" });
  expect((await adult.get("/api/library/retention/preview")).status).toBe(403);
  expect((await adult.put("/api/settings", { scope: "household", key: retentionKeys("pictures").mode, value: "keep" })).status).toBe(403);
});

test("generated type inventory and documents opt-in; uploads stay", () => {
  const f = fixture();
  const media = ["image/png", "video/mp4", "audio/mpeg", "text/plain"];
  for (const type of media) f.make("conversation", true, type);
  f.make("conversation", false, "text/plain");
  setHouseholdSettingValue("storage.household.cap_bytes", 1);
  expect(previewLibraryRetention().files.map((file) => file.type).sort()).toEqual(["pictures", "songs", "videos"]);
  setHouseholdSettingValue(retentionKeys("documents").mode, "until_storage_threshold");
  expect(previewLibraryRetention().files.map((file) => file.type).sort()).toEqual(["documents", "pictures", "songs", "videos"]);
});

test("expiring items and their expires_at appear only after the warning, only for the owner (LIBRARY-RETENTION-PREVIEW-01)", async () => {
  const f = fixture();
  const old = f.make("conversation");
  f.make("kept");
  f.make("conversation", false); // an upload: counts toward usage, never removed
  db.update(attachments).set({ createdAt: "2020-01-01T00:00:00Z" }).where(eq(attachments.id, old.id)).run();
  const now = Date.parse("2026-10-18T01:00:00Z");
  expect(expiringLibraryFiles(f.actor.id, now).size).toBe(0); // over the threshold but nobody has been told yet
  expect(librarySummary(f.actor, {}).expiring).toEqual({ items: 0, bytes: 0 });
  await runLibraryRetention(now); // sends the warning
  const expiring = expiringLibraryFiles(f.actor.id, now);
  expect([...expiring.keys()]).toEqual([old.id]);
  expect(expiring.get(old.id)!.expiresAt).toBe(new Date(now + DAY).toISOString());
  expect(librarySummary(f.actor, {}).expiring).toEqual({ items: 1, bytes: 10 });
  const item = listLibrary(f.actor, {}).items.find((entry) => entry.id === old.id)!;
  expect(item.expires_at).not.toBeNull();
  const stranger = db.insert(people).values({ id: newPersonId(), displayName: "Lucia", role: "adult", avatarSeed: "lucia", source: "hub", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() }).returning().get()!;
  expect(expiringLibraryFiles(stranger.id, now).size).toBe(0);
});
