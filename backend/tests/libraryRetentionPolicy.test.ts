import { beforeEach, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, conversationTurns, issues, musicJobs, pictureJobs, notificationDeliveries, notificationHolds, people, settingsValues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { existsSync } from "node:fs";
import { createAttachment, storeFile, deleteAttachmentsForTurns, readAttachment, attachmentFilePath } from "@/lib/attachments";
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
  // A generated file is detached from its chat (as LIBRARY-REVAMP-02 does when the chat goes) unless `tied`: a file a live chat
  // still shows is never a storage-rule candidate, since removing its Library reference would free nothing.
  const make = (retention: "kept" | "conversation", generated = true, mediaType = "image/png", tied = false) => {
    const cap = getHouseholdSettingValue("storage.household.cap_bytes");
    setHouseholdSettingValue("storage.household.cap_bytes", 0);
    const f = createAttachment(actor, { conversationId: chat.value.id, turnId, mediaType, bytes: new Uint8Array(10).fill(++distinct), retention, deduplicate: false });
    setHouseholdSettingValue("storage.household.cap_bytes", cap);
    if (!f.ok) throw new Error(f.error);
    if (generated) db.update(attachments).set({ provenance: `picture-gen:${JSON.stringify({ v: 1 })}`, ...(tied ? {} : { turnId: null }) }).where(eq(attachments.id, f.value.id)).run();
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

test("a generated file a live chat still shows is not removed by the storage rules; once its chat goes it is (independent review)", async () => {
  const f = fixture();
  const tied = f.make("conversation", true, "image/png", true);
  f.make("kept");
  const upload = f.make("conversation", false);
  db.update(attachments).set({ turnId: null }).where(eq(attachments.id, upload.id)).run(); // an upload that no chat holds, so the chat going leaves the totals alone
  db.update(attachments).set({ createdAt: "2020-01-01T00:00:00Z" }).where(eq(attachments.id, tied.id)).run();
  const at = Date.parse("2026-10-18T01:00:00Z");
  expect(previewLibraryRetention(at).count).toBe(0);
  await runLibraryRetention(at);
  expect((await runLibraryRetention(at + DAY)).deleted).toBe(0);
  expect(readAttachment(f.actor, tied.id).ok).toBe(true);
  deleteAttachmentsForTurns([f.turnId]); // the chat goes: a generated file outlives it and becomes a candidate
  expect(previewLibraryRetention(at + DAY).count).toBe(1);
});

test("the run plans only what it can remove now: a type still in its warning does not count as saving space (review round 2)", async () => {
  const f = fixture();
  const picture = f.make("conversation"); // older, but its type is only warned at the second run
  const video = f.make("conversation", true, "video/mp4");
  f.make("kept");
  db.update(attachments).set({ createdAt: "2020-01-01T00:00:00Z" }).where(eq(attachments.id, picture.id)).run();
  const t0 = Date.parse("2026-10-18T01:00:00Z");
  setHouseholdSettingValue(retentionKeys("pictures").mode, "keep");
  await runLibraryRetention(t0); // warns videos only
  setHouseholdSettingValue(retentionKeys("pictures").mode, "until_storage_threshold");
  const result = await runLibraryRetention(t0 + DAY); // videos are ready, pictures are only just warned
  expect(result.deleted).toBe(1);
  expect(db.select().from(attachments).where(eq(attachments.id, video.id)).get()).toBeUndefined();
  expect(db.select().from(attachments).where(eq(attachments.id, picture.id)).get()).toBeDefined();
});

test("expiring bytes count identical content once (review round 2)", async () => {
  const f = fixture();
  const a = f.make("conversation");
  const b = f.make("conversation");
  f.make("kept");
  f.make("conversation", false); // an upload, so the home is over its threshold even with the two identical files counted once
  db.update(attachments).set({ sha256: a.sha256 }).where(eq(attachments.id, b.id)).run();
  const now = Date.parse("2026-10-18T01:00:00Z");
  await runLibraryRetention(now);
  const summary = librarySummary(f.actor, {});
  expect(summary.expiring.items).toBe(2);
  expect(summary.expiring.bytes).toBe(10);
});

test("Keep pins a detached generated Library item before the grace expires", async () => {
  const f = fixture();
  const generated = f.make("conversation");
  f.make("kept"); f.make("kept");
  const { updateLibraryFile } = await import("@/lib/libraryEdit");
  expect(listLibrary(f.actor, {}).items.some(item => item.id === generated.id)).toBe(true);
  const now = Date.parse("2026-10-19T01:00:00Z");
  await runLibraryRetention(now);
  expect(updateLibraryFile(f.actor, generated.id, { keep: true }).ok).toBe(true);
  expect((await runLibraryRetention(now + DAY)).deleted).toBe(0);
  expect(db.select().from(attachments).where(eq(attachments.id, generated.id)).get()!.retention).toBe("kept");
});


test("an unpinned generated file with no chat remains a Library item", () => {
  const f = fixture();
  const made = storeFile(f.actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]), provenance: 'picture-gen:{"v":1,"audience":"all-ages"}', deduplicate: false });
  if (!made.ok) throw new Error(made.error);
  expect(made.value.retention).toBe("conversation");
  expect(listLibrary(f.actor, {}).items.find(item => item.id === made.value.id)).toMatchObject({ chat_id: null, retention: "conversation", can_edit: false });
});

for (const kind of ["video", "song", "edit"] as const) for (const keep of [true, false]) test(`${kind} companions follow their parent after chat deletion with different storage rules (keep=${keep})`, async () => {
  const f = fixture();
  const parent = f.make("conversation", true, kind === "video" ? "video/mp4" : kind === "song" ? "audio/mpeg" : "image/png", true);
  const { updateLibraryFile } = await import("@/lib/libraryEdit");
  if (keep && kind === "song") expect(updateLibraryFile(f.actor, parent.id, { keep: true }).ok).toBe(true);
  const child = f.make("conversation", true, "image/png", true);
  if (keep && kind !== "song") expect(updateLibraryFile(f.actor, parent.id, { keep: true }).ok).toBe(true);
  db.update(attachments).set({ provenance: kind === "video" ? 'video-gen:{"v":1,"job":"retention-video"}' : kind === "song" ? 'music-gen:{"kind":"music"}' : 'picture-gen:{"v":1}', createdAt: "2020-01-01T00:00:00Z" }).where(eq(attachments.id, parent.id)).run();
  db.update(attachments).set({ provenance: kind === "video" ? 'video-poster:{"v":1,"job":"retention-video"}' : kind === "edit" ? `image-edit:${JSON.stringify({ v: 1, root: parent.id })}` : 'picture-gen:{"v":1}', createdAt: "2026-10-18T00:00:00Z" }).where(eq(attachments.id, child.id)).run();
  if (kind === "song") db.insert(musicJobs).values({ id: "old-song", personId: f.actor.id, turnId: f.turnId, task: "generate", request: "{}", state: "done", fileId: parent.id, coverFileId: child.id, createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", hlc: nextHlc() }).run();
  deleteAttachmentsForTurns([f.turnId]);
  setHouseholdSettingValue("storage.household.cap_bytes", 1);
  const parentType = kind === "video" ? "videos" : kind === "song" ? "songs" : "pictures";
  setHouseholdSettingValue(retentionKeys(parentType).mode, "keep");
  expect(previewLibraryRetention().count).toBe(0);
  setHouseholdSettingValue(retentionKeys(parentType).mode, "until_storage_threshold");
  if (!keep && kind !== "edit") setHouseholdSettingValue(retentionKeys("pictures").mode, "keep");
  const now = Date.parse("2026-10-19T01:00:00Z");
  await runLibraryRetention(now);
  await runLibraryRetention(now + DAY);
  for (const id of [parent.id, child.id]) expect(Boolean(db.select().from(attachments).where(eq(attachments.id, id)).get())).toBe(keep);
  if (kind === "song") expect(db.select().from(musicJobs).all()).toHaveLength(keep ? 1 : 0);
});

test("old kept generated files and kept uploads retain their existing retention after chat deletion", async () => {
  const f = fixture();
  const made = f.make("kept", true, "image/png", true);
  const upload = f.make("kept", false, "text/plain", true);
  for (const id of [made.id, upload.id]) db.update(attachments).set({ createdAt: "2000-01-01T00:00:00Z" }).where(eq(attachments.id, id)).run();
  deleteAttachmentsForTurns([f.turnId]);
  setHouseholdSettingValue("storage.household.cap_bytes", 1);
  setHouseholdSettingValue(retentionKeys("uploads").mode, "until_storage_threshold");
  const now = Date.parse("2026-10-19T01:00:00Z");
  await runLibraryRetention(now);
  expect((await runLibraryRetention(now + DAY)).deleted).toBe(0);
  for (const id of [made.id, upload.id]) expect(db.select().from(attachments).where(eq(attachments.id, id)).get()).toMatchObject({ retention: "kept", turnId: null });
});
test("a purged Library item held only by chat is neither a retention candidate nor a Library item, and leaves with chat", async () => {
  const f = fixture(); const made = f.make("conversation", true, "image/png", true);
  const { dropLibraryReference } = await import("@/lib/libraryTrash");
  const row = db.select().from(attachments).where(eq(attachments.id, made.id)).get()!;
  expect(dropLibraryReference([row])).toMatchObject([{ id: made.id, freed: false }]);
  setHouseholdSettingValue("storage.household.cap_bytes", 1);
  expect(previewLibraryRetention().count).toBe(0);
  expect(listLibrary(f.actor, {}).items.some(item => item.id === made.id)).toBe(false);
  expect(existsSync(attachmentFilePath(made.storage_path))).toBe(true);
  deleteAttachmentsForTurns([f.turnId]);
  expect(db.select().from(attachments).where(eq(attachments.id, made.id)).get()).toBeUndefined();
  expect(existsSync(attachmentFilePath(made.storage_path))).toBe(false);
});
