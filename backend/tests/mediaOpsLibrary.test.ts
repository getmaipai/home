// IMG-OPS-02: picture operations addressed by Library file id. Owner only, not in Trash, not locked; the registry's gates run on every call; the result is a NEW
// Library picture (the source is never written) that keeps the strictest audience of its source; rotate and flip are exact; the page action and the media-ops
// route give one answer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, settingsValues } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { createShare } from "@/lib/shares";
import { __resetImageEditForTests, __setImageToolsForTests, LIBRARY_PICTURE_LOCKED } from "@/lib/imageEdit";
import { getMediaOp, runMediaOp } from "@/lib/mediaOps/registry";
import { withAttachments } from "@/lib/mediaOps/http";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __resetAdapterCacheForTests } from "@/lib/pictures/adapters";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient, StackImageToolsStatus } from "@/lib/stack/client";
import type { PersonRow } from "@/types";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const READY: StackImageToolsStatus = { state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: { upscale_in: 6 }, operations: ["remove_background", "erase", "upscale", "resize"], reason: null };
const ALL_AGES = 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}';
const ADULT_LOCKED = 'picture-gen:{"v":1,"audience":"adult-only","made_audience":"adult-only","lock":"on","prompt":"a boat"}';
const ADULT_OPEN = 'picture-gen:{"v":1,"audience":"adult-only","made_audience":"adult-only","lock":"off","prompt":"a boat"}';

/** 40 wide, 30 high: the left half red, the right half blue, so a flip or turn can be read from pixels. */
async function twoColour(): Promise<Uint8Array> {
  const left = await sharp({ create: { width: 20, height: 30, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  return new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 0, g: 0, b: 255 } } }).composite([{ input: left, left: 0, top: 0 }]).png().toBuffer());
}
const pixel = async (bytes: Uint8Array, x: number, y: number) => { const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true }); const at = (y * info.width + x) * info.channels; return [data[at]!, data[at + 1]!, data[at + 2]!]; };

let sage: TestClient; let sageActor: PersonRow;
let lucia: TestClient; let luciaId: string;
let marlow: TestClient; let nova: TestClient; let novaActor: PersonRow;

async function addPerson(owner: TestClient, displayName: string, role: string) {
  const made = await owner.post("/api/people", { displayName, role, secret: "0000" });
  const id = ((await made.json()) as { id: string }).id;
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  return { client, id, actor: db.select().from(people).where(eq(people.id, id)).get()! };
}
function allowPhotos(personId: string) {
  db.insert(settingsValues).values({ scope: `person:${personId}`, key: "chat.photo_uploads", value: "true", hlc: "1:0:test", source: "self", setBy: personId, updatedAt: new Date().toISOString() }).run();
}
async function libraryPicture(owner: PersonRow, provenance = ALL_AGES, bytes?: Uint8Array) {
  const stored = storeFile(owner, { conversationId: null, turnId: null, mediaType: "image/png", bytes: bytes ?? await twoColour(), provenance, retention: "kept", deduplicate: false });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value;
}
const note = (id: string) => JSON.parse(db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance.replace(/^image-edit:/, "")) as Record<string, unknown>;
const run = (client: TestClient, op: string, body: Record<string, unknown>) => client.post(`/api/media-ops/${op}`, body);
type Preview = { state: string; preview: { token: string; url: string; width: number; height: number } };
async function runAndApply(client: TestClient, op: string, fileId: string, args: Record<string, unknown>) {
  const res = await run(client, op, { file_id: fileId, args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Preview;
  expect(body.state).toBe("done");
  const applied = await client.post(`/api/media-ops/previews/${body.preview.token}/apply`, {});
  expect(applied.status).toBe(200);
  return { preview: body.preview, version: ((await applied.json()) as { version: { id: string; url: string; op: string; source: string; label: string } }).version };
}

beforeEach(async () => {
  resetDb(); __resetImageEditForTests();
  __setImageToolsForTests(READY, true);
  __setRoleHealthForTests({ image: { availability: "ready", reason: null } });
  sage = new TestClient();
  const made = await sage.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  sageActor = db.select().from(people).where(eq(people.id, ((await made.json()) as { person: { id: string } }).person.id)).get()!;
  allowPhotos(sageActor.id);
  ({ client: lucia, id: luciaId } = await addPerson(sage, "Lucia", "adult"));
  allowPhotos(luciaId);
  const teen = await addPerson(sage, "Marlow", "teen"); marlow = teen.client; allowPhotos(teen.id);
  const child = await addPerson(sage, "Nova", "child"); nova = child.client; novaActor = child.actor;
});
afterEach(() => { __setStackClientForTests(null); __resetStackEngineForTests(); __setImageToolsForTests(undefined); __setPictureStatusForTests(undefined); __setPicturesFetchForTests(null); __resetAdapterCacheForTests(); __setRoleHealthForTests({}); __resetImageEditForTests(); });

describe("an edit by Library file id", () => {
  test("rotate and flip give exact sizes and pixels, save a new Library picture, and never touch the source", async () => {
    const source = await libraryPicture(sageActor);
    const before = db.select().from(attachments).where(eq(attachments.id, source.id)).get()!;
    for (const [degrees, size] of [[90, [30, 40]], [180, [40, 30]], [270, [30, 40]]] as const) {
      const res = await run(sage, "picture.rotate", { file_id: source.id, args: { degrees } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Preview;
      expect([body.preview.width, body.preview.height]).toEqual([...size]);
    }
    const turned = await runAndApply(sage, "picture.rotate", source.id, { degrees: 90 });
    const bytes = new Uint8Array(await (await sage.get(turned.version.url)).arrayBuffer());
    expect(await pixel(bytes, 0, 0)).toEqual([255, 0, 0]); // the red left half is now the top
    expect(await pixel(bytes, 0, 39)).toEqual([0, 0, 255]);
    const flipped = await runAndApply(sage, "picture.flip", source.id, { direction: "horizontal" });
    const flippedBytes = new Uint8Array(await (await sage.get(flipped.version.url)).arrayBuffer());
    expect((await sharp(flippedBytes).metadata()).width).toBe(40);
    expect(await pixel(flippedBytes, 0, 0)).toEqual([0, 0, 255]);
    expect(await pixel(flippedBytes, 39, 0)).toEqual([255, 0, 0]);
    const upsideDown = await runAndApply(sage, "picture.flip", source.id, { direction: "vertical" });
    expect((await sharp(new Uint8Array(await (await sage.get(upsideDown.version.url)).arrayBuffer())).metadata()).height).toBe(30);
    // The source row and bytes are untouched; each result is a new kept Library file with no chat, linked to the source.
    expect(db.select().from(attachments).where(eq(attachments.id, source.id)).get()).toEqual(before);
    const row = db.select().from(attachments).where(eq(attachments.id, turned.version.id)).get()!;
    expect(row).toMatchObject({ conversationId: null, turnId: null, retention: "kept", ownerPersonId: sageActor.id, mediaType: "image/png" });
    expect(note(row.id)).toMatchObject({ v: 1, op: "rotate", source: source.id, root: source.id, audience: "all-ages" });
    expect(note(row.id).source_sha256).toBe(before.sha256);
  });

  test("versions list the original and each edit, oldest first; an edit of an edit keeps one root; undo is opening the version before", async () => {
    const source = await libraryPicture(sageActor);
    const first = await runAndApply(sage, "picture.rotate", source.id, { degrees: 90 });
    const second = await runAndApply(sage, "picture.flip", first.version.id, { direction: "vertical" });
    expect(note(second.version.id)).toMatchObject({ source: first.version.id, root: source.id });
    for (const askedAbout of [source.id, first.version.id, second.version.id]) {
      const listed = (await (await sage.get(`/api/media-ops/files/${askedAbout}/versions`)).json()) as { versions: Array<{ id: string; op: string; url: string }> };
      expect(listed.versions.map((v) => [v.id, v.op])).toEqual([[source.id, "original"], [first.version.id, "rotate"], [second.version.id, "flip"]]);
    }
    const original = await sage.get(`/api/media-ops/files/${source.id}/content`);
    expect(original.status).toBe(200);
    expect((await sharp(new Uint8Array(await original.arrayBuffer())).metadata()).width).toBe(40);
    // Nothing was deleted by editing: the first version still opens.
    expect((await sage.get(first.version.url)).status).toBe(200);
  });

  test("another person gets a 404 everywhere, even when the picture was shared with them; nothing is created", async () => {
    const source = await libraryPicture(sageActor);
    createShare(sageActor, { fileId: source.id, to: luciaId });
    const count = () => db.select().from(attachments).all().length;
    const before = count();
    expect((await run(lucia, "picture.rotate", { file_id: source.id, args: { degrees: 90 } })).status).toBe(404);
    expect((await lucia.get(`/api/media-ops?file_id=${source.id}`)).status).toBe(404);
    expect((await lucia.get(`/api/media-ops/files/${source.id}/versions`)).status).toBe(404);
    expect((await lucia.get(`/api/media-ops/files/${source.id}/content`)).status).toBe(404);
    expect((await lucia.post("/api/plugins/image/actions/op", { op: "picture.rotate", file_id: source.id, args: { degrees: 90 } })).status).toBe(404);
    expect(count()).toBe(before);
  });

  test("a picture in Trash cannot be edited", async () => {
    const source = await libraryPicture(sageActor);
    db.update(attachments).set({ deletedAt: new Date().toISOString(), trashUntil: new Date(Date.now() + 86_400_000).toISOString() }).where(eq(attachments.id, source.id)).run();
    const res = await run(sage, "picture.rotate", { file_id: source.id, args: { degrees: 90 } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("not_found");
    expect((await sage.get(`/api/media-ops/files/${source.id}/content`)).status).toBe(404);
  });

  test("a locked adult-only picture is refused with the locked line until it is unlocked, and nothing starts", async () => {
    const source = await libraryPicture(sageActor, ADULT_LOCKED);
    const before = db.select().from(attachments).all().length;
    const res = await run(sage, "picture.rotate", { file_id: source.id, args: { degrees: 90 } });
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ error: LIBRARY_PICTURE_LOCKED, code: "locked" });
    const listed = (await (await sage.get(`/api/media-ops?file_id=${source.id}`)).json()) as { operations: Array<{ enabled: boolean; reason?: string }> };
    expect(listed.operations.length).toBeGreaterThan(0);
    expect(listed.operations.every((op) => !op.enabled && op.reason === LIBRARY_PICTURE_LOCKED)).toBe(true);
    expect((await sage.get(`/api/media-ops/files/${source.id}/content`)).status).toBe(423);
    expect(db.select().from(attachments).all().length).toBe(before);
    // With the proof (the passcode unlock) the same call runs.
    const proof = ((await (await sage.post("/api/adult-lock/unlock", { secret: "correcthorse", visit: "ops-test" })).json()) as { proof: string }).proof;
    const open = await sage.request("/api/media-ops/picture.rotate", { method: "POST", body: { file_id: source.id, args: { degrees: 90 } }, headers: { "x-adult-unlock": proof } });
    expect(open.status).toBe(200);
  });

  test("the result keeps the source's audience: adult-only stays adult-only (lock kept), all-ages stays all-ages, a simple edit of an unlabelled upload carries the upload's own state (no label, lock off)", async () => {
    const adult = await libraryPicture(sageActor, ADULT_OPEN);
    const fromAdult = await runAndApply(sage, "picture.flip", adult.id, { direction: "horizontal" });
    expect(note(fromAdult.version.id)).toMatchObject({ audience: "adult-only", made_audience: "adult-only", lock: "off" });
    const plain = await libraryPicture(sageActor, ALL_AGES);
    const fromPlain = await runAndApply(sage, "picture.flip", plain.id, { direction: "horizontal" });
    expect(note(fromPlain.version.id)).toMatchObject({ audience: "all-ages", made_audience: "all-ages", lock: "off" });
    const upload = await libraryPicture(sageActor, "composer:upload");
    const fromUpload = await runAndApply(sage, "picture.flip", upload.id, { direction: "horizontal" });
    expect(note(fromUpload.version.id)).toMatchObject({ lock: "off" });
    expect(note(fromUpload.version.id).audience).toBeUndefined();
  });

  test("an app cannot run an operation the list does not offer: helpers, unknown ids and bad arguments are refused", async () => {
    const source = await libraryPicture(sageActor);
    expect((await run(sage, "picture.locate", { file_id: source.id })).status).toBe(404);
    expect((await run(sage, "picture.save_subject", { file_id: source.id, args: { name: "x", kind: "prop", look: "y" } })).status).toBe(404);
    expect((await run(sage, "picture.nope", { file_id: source.id })).status).toBe(404);
    expect((await run(sage, "video.animate", { file_id: source.id })).status).toBe(404);
    expect((await run(sage, "picture.rotate", { file_id: source.id, args: { degrees: 45 } })).status).toBe(422);
    expect((await run(sage, "picture.crop", { file_id: source.id, args: {} })).status).toBe(422);
    expect((await run(sage, "picture.crop", { file_id: source.id, args: { aspect: "1:1" }, mask: Buffer.from("x").toString("base64") })).status).toBe(422);
    expect((await run(sage, "picture.rotate", { file_id: source.id, args: { degrees: 90 }, references: ["a"] })).status).toBe(422);
  });
});

describe("who may run what", () => {
  test("GET /api/media-ops lists each operation with its arguments and, when off, one plain reason", async () => {
    __setImageToolsForTests({ ...READY, vision: false, models: { isnet: false, lama: true, esrgan: true } }, false);
    const source = await libraryPicture(sageActor);
    const listed = (await (await sage.get(`/api/media-ops?file_id=${source.id}`)).json()) as { operations: Array<{ id: string; label: string; params: Record<string, unknown>; controls: unknown[]; enabled: boolean; reason?: string }>; note: string | null };
    const byId = new Map(listed.operations.map((op) => [op.id, op]));
    for (const id of ["picture.rotate", "picture.flip", "picture.crop", "picture.adjust", "picture.resize", "picture.make_clearer", "picture.erase", "picture.remove_background", "picture.blur_background", "picture.change"]) expect(byId.has(id)).toBe(true);
    expect(byId.has("picture.locate")).toBe(false);
    expect(byId.has("picture.upscale")).toBe(false);
    expect(byId.get("picture.rotate")).toMatchObject({ enabled: true, label: "Rotate", params: { type: "object", required: ["degrees"] } });
    expect(byId.get("picture.flip")!.params.properties).toMatchObject({ direction: { enum: ["horizontal", "vertical"] } });
    expect(byId.get("picture.remove_background")).toMatchObject({ enabled: false, reason: expect.stringContaining("background remover") });
    expect(byId.get("picture.change")).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't set up") });
    expect(byId.get("picture.crop")!.enabled).toBe(true);
  });

  test("a teen with photos on edits; with photos off every call is refused with the settings line", async () => {
    const source = await libraryPicture(sageActor);
    const teen = db.select().from(people).where(eq(people.displayName, "Marlow")).get()!;
    const own = await libraryPicture(teen);
    const done = await run(marlow, "picture.rotate", { file_id: own.id, args: { degrees: 90 } });
    expect(done.status).toBe(200);
    expect((await run(marlow, "picture.rotate", { file_id: source.id, args: { degrees: 90 } })).status).toBe(404); // not theirs
    expect((await marlow.request("/api/settings", { method: "PUT", body: { scope: `person:${teen.id}`, key: "chat.photo_uploads", value: false } })).status).toBe(200);
    const off = await run(marlow, "picture.rotate", { file_id: own.id, args: { degrees: 90 } });
    expect(off.status).toBe(403);
    expect(((await off.json()) as { code: string }).code).toBe("pictures_off");
  });

  test("a child edits only their own cartoons; a photo or a cartoon lane switched off is refused with the line", async () => {
    const cartoon = await libraryPicture(novaActor, ALL_AGES);
    const photo = await libraryPicture(novaActor, "composer:upload");
    expect((await run(nova, "picture.rotate", { file_id: cartoon.id, args: { degrees: 90 } })).status).toBe(200);
    const refusedPhoto = await run(nova, "picture.rotate", { file_id: photo.id, args: { degrees: 90 } });
    expect(refusedPhoto.status).toBe(403);
    expect(((await refusedPhoto.json()) as { code: string }).code).toBe("child_cartoons_only");
    const listed = (await (await nova.get(`/api/media-ops?file_id=${photo.id}`)).json()) as { operations: Array<{ enabled: boolean; reason?: string }> };
    expect(listed.operations.length).toBeGreaterThan(0);
    expect(listed.operations.every((op) => !op.enabled && Boolean(op.reason))).toBe(true);
    expect((await run(sage, "picture.rotate", { file_id: cartoon.id, args: { degrees: 90 } })).status).toBe(404); // a parent's account is not the child's
    expect((await sage.request("/api/settings", { method: "PUT", body: { scope: "household", key: "generation.kids", value: false } })).status).toBe(200);
    const laneOff = await run(nova, "picture.rotate", { file_id: cartoon.id, args: { degrees: 90 } });
    expect(laneOff.status).toBe(403);
    expect(((await laneOff.json()) as { code: string }).code).toBe("pictures_off");
  });

  test("a guest is refused by the registry on a Library picture", async () => {
    const now = new Date().toISOString();
    db.insert(people).values({ id: "person-opsguest", displayName: "Gus", role: "guest", avatarSeed: "g", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
    const guest = db.select().from(people).where(eq(people.id, "person-opsguest")).get()!;
    const own = await libraryPicture(guest);
    await expect(runMediaOp(guest, "picture.rotate", { source: { kind: "picture", via: "file", id: own.id }, args: { degrees: 90 } })).rejects.toMatchObject({ status: 403 });
  });
});

describe("the page action and the route are one handler", () => {
  test("POST /api/plugins/image/actions/op answers exactly what POST /api/media-ops/{id} does, including a refusal", async () => {
    const source = await libraryPicture(sageActor);
    const viaRoute = await run(sage, "picture.crop", { file_id: source.id, args: { aspect: "1:1" } });
    const viaPage = await sage.post("/api/plugins/image/actions/op", { op: "picture.crop", file_id: source.id, args: { aspect: "1:1" } });
    expect(viaRoute.status).toBe(200); expect(viaPage.status).toBe(200);
    const [a, b] = [(await viaRoute.json()) as Preview, (await viaPage.json()) as Preview];
    expect([a.state, a.preview.width, a.preview.height]).toEqual([b.state, b.preview.width, b.preview.height]);
    expect([a.preview.width, a.preview.height]).toEqual([30, 30]);
    const bad = { op: "picture.rotate", file_id: source.id, args: { degrees: 45 } };
    const badRoute = await run(sage, bad.op, { file_id: bad.file_id, args: bad.args });
    const badPage = await sage.post("/api/plugins/image/actions/op", bad);
    expect([badRoute.status, await badRoute.json()]).toEqual([badPage.status, await badPage.json()]);
    const locked = await libraryPicture(sageActor, ADULT_LOCKED);
    const lockedPage = await sage.post("/api/plugins/image/actions/op", { op: "picture.flip", file_id: locked.id, args: { direction: "vertical" } });
    expect(lockedPage.status).toBe(423);
    expect(await lockedPage.json()).toEqual({ error: LIBRARY_PICTURE_LOCKED, code: "locked" });
    expect((await sage.post("/api/plugins/image/actions/op", { file_id: source.id })).status).toBe(422);
    // The page can apply the result too (same applyPreview).
    const applied = await sage.post("/api/plugins/image/actions/op-apply", { token: a.preview.token });
    expect(applied.status).toBe(200);
    expect(((await applied.json()) as { version: { source: string } }).version.source).toBe(source.id);
    // Not signed in: refused.
    expect((await new TestClient().post("/api/plugins/image/actions/op", { op: "picture.crop", file_id: source.id, args: { aspect: "1:1" } })).status).toBe(401);
  });

  test("a child through the page action gets the same lane rules: their own cartoon runs, a photo is refused", async () => {
    const cartoon = await libraryPicture(novaActor, ALL_AGES);
    const photo = await libraryPicture(novaActor, "composer:upload");
    expect((await nova.post("/api/plugins/image/actions/op", { op: "picture.rotate", file_id: cartoon.id, args: { degrees: 90 } })).status).toBe(200);
    const before = db.select().from(attachments).all().length;
    const refused = await nova.post("/api/plugins/image/actions/op", { op: "picture.rotate", file_id: photo.id, args: { degrees: 90 } });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe("child_cartoons_only");
    expect(db.select().from(attachments).all().length).toBe(before);
  });
});

describe("the chat route runs every local operation", () => {
  async function chatPicture() {
    const { resolveOrCreateConversation } = await import("@/lib/conversationHistory");
    const { newConversationTurnId } = await import("@/lib/id");
    const conversation = resolveOrCreateConversation(sageActor, "chat");
    if (!conversation.ok) throw new Error("no conversation");
    const turnId = newConversationTurnId();
    const form = new FormData();
    form.append("file", new File([await twoColour()], "robot.png", { type: "image/png" }));
    form.append("turn_id", turnId); form.append("conversation_id", conversation.value.id); form.append("temporary", "false");
    const res = await sage.postForm("/api/attachments/upload", form);
    expect(res.status).toBe(201);
    return { id: ((await res.json()) as { image: { id: string } }).image.id, conversationId: conversation.value.id };
  }
  const form = (conversationId: string, fields: Record<string, string>) => { const f = new FormData(); f.append("conversation_id", conversationId); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };

  test("crop, adjust, rotate, flip and blur_background are accepted over HTTP", async () => {
    const picture = await chatPicture();
    const edit = async (fields: Record<string, string>) => { const res = await sage.postForm(`/api/image-edit/pictures/${picture.id}/edit`, form(picture.conversationId, fields)); return { status: res.status, body: (await res.json()) as Preview & { error?: string } }; };
    const crop = await edit({ operation: "crop", aspect: "1:1" });
    expect([crop.status, crop.body.preview.width, crop.body.preview.height]).toEqual([200, 30, 30]);
    const rect = await edit({ operation: "crop", x: "0", y: "0", width: "0.5", height: "0.5" });
    expect([rect.body.preview.width, rect.body.preview.height]).toEqual([20, 15]);
    expect((await edit({ operation: "adjust", brightness: "20", auto: "true" })).status).toBe(200);
    const turned = await edit({ operation: "rotate", degrees: "90" });
    expect([turned.body.preview.width, turned.body.preview.height]).toEqual([30, 40]);
    expect((await edit({ operation: "flip", direction: "vertical" })).status).toBe(200);
    expect((await edit({ operation: "rotate", degrees: "45" })).status).toBe(422);
    expect((await edit({ operation: "crop" })).status).toBe(422);
    __setStackClientForTests({ imageEdit: async () => ({ kind: "done", job: "m", item: { b64_json: (await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()).toString("base64"), width: 40, height: 30, content_type: "image/png", operation: "remove_background" } }) } as unknown as StackClient);
    const blur = await edit({ operation: "blur_background", radius: "8" });
    expect([blur.status, blur.body.state]).toEqual([200, "done"]);
  });
});

describe("a painted area and second pictures reach the change", () => {
  test("withAttachments puts a mask under the key each operation reads and refuses it where it is not used", async () => {
    const ops = new Map(await Promise.all(["picture.change", "picture.erase", "picture.crop"].map(async (id) => [id, (await getMediaOp(id))!] as const)));
    const find = (id: string) => ops.get(id)!;
    const mask = Buffer.from("png-bytes").toString("base64");
    expect(withAttachments(find("picture.change"), { args: { prompt: "x" }, mask }).maskPng).toBeInstanceOf(Uint8Array);
    expect(withAttachments(find("picture.erase"), { mask }).mask).toBeInstanceOf(Uint8Array);
    expect(() => withAttachments(find("picture.crop"), { mask })).toThrow();
    expect(withAttachments(find("picture.change"), { args: { prompt: "x" }, references: ["ref-1"] }).references).toEqual([{ kind: "picture", via: "file", id: "ref-1" }]);
    expect(withAttachments(find("picture.change"), { references: ["ref-1"] }, { conversationId: "chat-1" }).references).toEqual([{ kind: "picture", via: "chat", id: "ref-1", conversationId: "chat-1" }]);
    // A byte field inside `args` is ignored: bytes only arrive as base64 beside it.
    expect(withAttachments(find("picture.erase"), { args: { mask: [1, 2, 3] } }).mask).toBeUndefined();
  });

  test("a described change on a Library picture sends the painted area and both reference pictures to the engine", async () => {
    __setPictureStatusForTests(readyStatusForTests());
    const sent: FormData[] = [];
    __setPicturesFetchForTests((async (_input, init) => { sent.push(init?.body as FormData); return new Response(JSON.stringify({ job: "library-change-job" }), { status: 202, headers: { "content-type": "application/json" } }); }) as typeof fetch);
    const base = await libraryPicture(sageActor); const ref1 = await libraryPicture(sageActor, ALL_AGES, new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#123456" } }).png().toBuffer())); const ref2 = await libraryPicture(sageActor, ALL_AGES, new Uint8Array(await sharp({ create: { width: 12, height: 12, channels: 3, background: "#654321" } }).png().toBuffer()));
    const mask = Buffer.from(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#ffffff" } }).png().toBuffer()).toString("base64");
    const res = await run(sage, "picture.change", { file_id: base.id, args: { prompt: "put them together" }, mask, references: [ref1.id, ref2.id] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "running", job: "library-change-job" });
    expect(sent[0]?.get("operation")).toBe("edit_masked");
    expect(sent[0]?.get("mask")).not.toBeNull();
    expect(sent[0]?.get("reference")).not.toBeNull();
    expect(sent[0]?.get("reference2")).not.toBeNull();
    // A reference that is another person's picture is not found, so it is never sent.
    const luciaActor = db.select().from(people).where(eq(people.id, luciaId)).get()!;
    const theirs = await libraryPicture(luciaActor);
    sent.length = 0;
    expect((await run(sage, "picture.change", { file_id: base.id, args: { prompt: "x" }, references: [theirs.id] })).status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  test("the words box on a Library picture picks an operation and runs it with the painted area", async () => {
    const base = await libraryPicture(sageActor);
    const stub = { imageTools: async () => READY, roles: async () => ({ roles: [] }), imageEdit: async () => ({ kind: "done", job: "j", item: { b64_json: (await sharp({ create: { width: 40, height: 30, channels: 3, background: "#000" } }).png().toBuffer()).toString("base64"), width: 40, height: 30, content_type: "image/png", operation: "erase", engine: "lama", model: "lama", ms: 5 } }),
      chat: async () => ({ data: { choices: [{ message: { role: "assistant", tool_calls: [{ id: "e1", type: "function", function: { name: "edit_picture", arguments: JSON.stringify({ op: "picture.erase", source: "latest", args: {} }) } }], content: null }, finish_reason: "tool_calls" }] }, identity: { host: "local", build: "x" } }) } as unknown as StackClient;
    __setStackClientForTests(stub);
    const mask = Buffer.from(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#fff" } }).png().toBuffer()).toString("base64");
    const res = await sage.post("/api/media-ops/words", { file_id: base.id, prompt: "remove that", mask });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "done" });
    const other = await lucia.post("/api/media-ops/words", { file_id: base.id, prompt: "remove that" });
    expect(other.status).toBe(404);
  });
});
