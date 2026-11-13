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


const studioRows = async (client: TestClient, id: string) => client.post("/api/plugins/image/data/studio", { id });
const studioCall = (client: TestClient, name: string, body: Record<string, unknown>) => client.post(`/api/plugins/image/actions/${name}`, body);
const dataUrl = async (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

describe("the Studio page's data and calls (IMG-STUDIO-02)", () => {
  test("the opened picture is one row with its versions; no picture means no row", async () => {
    const source = await libraryPicture(sageActor);
    const none = await studioRows(sage, "$state.file");
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual([]);
    const rows = (await (await studioRows(sage, source.id)).json()) as Array<{ id: string; url: string; locked: boolean; versions: Array<{ id: string; label: string }> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: source.id, locked: false });
    expect(rows[0]!.versions.map((v) => v.id)).toEqual([source.id]);
    // The first picture of a chain has no size in a note: the row carries the real one, so Compare can pair like with like (IMG-STUDIO-03).
    expect(rows[0]).toMatchObject({ width: 40, height: 30 });
    expect((rows[0]!.versions as unknown as Array<{ width: number; height: number }>)[0]).toMatchObject({ width: 40, height: 30 });
    expect((await sage.get(rows[0]!.url)).status).toBe(200);
  });

  test("another person is refused with a 404 on every Studio route, even for a shared picture; nothing is created", async () => {
    const source = await libraryPicture(sageActor);
    createShare(sageActor, { fileId: source.id, to: luciaId });
    const before = db.select().from(attachments).all().length;
    expect((await studioRows(lucia, source.id)).status).toBe(404);
    expect((await lucia.post("/api/plugins/image/data/studio-tools", { id: source.id })).status).toBe(200);
    expect((await studioCall(lucia, "studio-run", { file: source.id, operation: "adjust", args: { brightness: 10 } })).status).toBe(404);
    expect((await studioCall(lucia, "studio-markup", { file: source.id, png: await dataUrl(await twoColour()) })).status).toBe(404);
    expect(db.select().from(attachments).all().length).toBe(before);
  });

  test("a locked picture is a locked row and cannot be run on; the picker offers only the person's own pictures", async () => {
    const locked = await libraryPicture(sageActor, ADULT_LOCKED);
    const open = await libraryPicture(sageActor);
    const row = (await (await studioRows(sage, locked.id)).json()) as Array<{ locked: boolean; url?: string; versions?: unknown }>;
    expect(row[0]).toMatchObject({ locked: true });
    expect(row[0]!.url).toBeUndefined();
    const res = await studioCall(sage, "studio-run", { file: locked.id, operation: "adjust", args: { brightness: 10 } });
    expect(res.status).toBe(423);
    expect(((await res.json()) as { error: string }).error).toBe(LIBRARY_PICTURE_LOCKED);
    const picker = (await (await sage.post("/api/plugins/image/data/studio-picker", {})).json()) as Array<{ id: string }>;
    expect(picker.map((p) => p.id)).toContain(open.id);
    expect(await (await sage.post("/api/plugins/image/data/studio-picker", { id: open.id })).json()).toEqual([]);
    const theirs = (await (await lucia.post("/api/plugins/image/data/studio-picker", {})).json()) as Array<{ id: string }>;
    expect(theirs.map((p) => p.id)).not.toContain(open.id);
  });

  test("Crop with a turn and a mirror is one preview and one Apply: rotate, then flip, then cut", async () => {
    const source = await libraryPicture(sageActor);
    const run1 = await studioCall(sage, "studio-run", { file: source.id, operation: "crop", args: { x: 0, y: 0, width: 1, height: 0.5, aspect: "free", rotate: 90, flip_horizontal: true, flip_vertical: false } });
    expect(run1.status).toBe(200);
    const made = (await run1.json()) as { token: string; preview_url: string; width: number; height: number };
    expect(Object.keys(made).sort()).toEqual(["height", "preview_url", "token", "width"]);
    // 40x30 turned a quarter is 30x40; the top half of it is 30x20.
    expect([made.width, made.height]).toEqual([30, 20]);
    const bytes = new Uint8Array(await (await sage.get(made.preview_url)).arrayBuffer());
    // After the quarter turn the red half is on top; mirrored left to right it stays on top, so the cut is all red.
    expect(await pixel(bytes, 0, 0)).toEqual([255, 0, 0]);
    expect(await pixel(bytes, 29, 19)).toEqual([255, 0, 0]);
    const count = db.select().from(attachments).all().length;
    const applied = await studioCall(sage, "studio-apply", { file: source.id, token: made.token, label: "Cropped and turned" });
    expect(applied.status).toBe(200);
    const version = (await applied.json()) as { id: string; url: string; label: string };
    expect(version).toMatchObject({ label: "Cropped and turned" });
    expect(db.select().from(attachments).all().length).toBe(count + 1);
    const rows = (await (await studioRows(sage, source.id)).json()) as Array<{ versions: Array<{ id: string }> }>;
    expect(rows[0]!.versions.map((v) => v.id)).toEqual([source.id, version.id]);
  });

  test("Adjust runs and applies; a rotate-only crop with no box still works", async () => {
    const source = await libraryPicture(sageActor);
    const adj = await studioCall(sage, "studio-run", { file: source.id, operation: "adjust", args: { brightness: 20, contrast: 0, saturation: 0, warmth: 0, auto: false } });
    expect(adj.status).toBe(200);
    const turn = await studioCall(sage, "studio-run", { file: source.id, operation: "crop", args: { rotate: 180, flip_horizontal: false, flip_vertical: false } });
    expect(turn.status).toBe(200);
    expect(await turn.json()).toMatchObject({ width: 40, height: 30 });
  });

  test("Markup saves a new version", async () => {
    const source = await libraryPicture(sageActor);
    const res = await studioCall(sage, "studio-markup", { file: source.id, png: await dataUrl(await twoColour()) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ label: "Markup" });
    expect((await studioCall(sage, "studio-markup", { file: source.id, png: "" })).status).toBe(422);
  });

  test("a described change with no picture engine says so in one plain line", async () => {
    __setRoleHealthForTests({ image: { availability: "unavailable", reason: "off" } });
    const source = await libraryPicture(sageActor);
    const tools = (await (await sage.post("/api/plugins/image/data/studio-tools", { id: source.id })).json()) as Array<{ id: string; enabled: boolean; reason?: string }>;
    expect(tools.map((t) => t.id)).toEqual(["picture.blur_background"]);
    const res = await studioCall(sage, "studio-comment", { file: source.id, prompt: "make it sunny", region: null, mask: null, reference: null });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(10);
    expect((await studioCall(sage, "studio-comment", { file: source.id, prompt: "  " })).status).toBe(422);
  });

  test("a child reaches the Studio's data without error and the tool list follows the profile", async () => {
    const mine = await libraryPicture(novaActor);
    const row = await studioRows(nova, mine.id);
    expect(row.status).toBe(200);
    const tools = await nova.post("/api/plugins/image/data/studio-tools", { id: mine.id });
    expect(tools.status).toBe(200);
    expect((await studioCall(marlow, "studio-run", { file: mine.id, operation: "adjust", args: { brightness: 10 } })).status).toBe(404);
  });

  test("an edit of a plain upload is saved locked and Apply says so; the lock rule itself is unchanged (IMG-STUDIO-03)", async () => {
    const upload = await libraryPicture(sageActor, "library:upload");
    const run1 = await studioCall(sage, "studio-run", { file: upload.id, operation: "crop", args: { x: 0, y: 0, width: 0.5, height: 1 } });
    expect(run1.status).toBe(200);
    const made = (await run1.json()) as { token: string };
    const applied = await studioCall(sage, "studio-apply", { file: upload.id, token: made.token, label: "Cropped" });
    expect(applied.status).toBe(200);
    const reply = (await applied.json()) as { id: string; locked?: boolean; note?: string };
    expect(reply.locked).toBe(true);
    expect(reply.note).toBe("Saved to your Library behind your Adult lock. Unlock it there to keep editing it.");
    // Still stored the way it always was: adult-only, Adult lock on; and its picture cannot be fetched without the unlock.
    expect(note(reply.id)).toMatchObject({ made_audience: "adult-only", lock: "on" });
    expect((await sage.get(`/api/media-ops/files/${encodeURIComponent(reply.id)}/content`)).status).toBe(423);
    expect(((await (await studioRows(sage, reply.id)).json()) as Array<{ locked: boolean }>)[0]).toMatchObject({ locked: true });
    // The same for Markup, and an open edit carries no lock flag.
    const marked = (await (await studioCall(sage, "studio-markup", { file: upload.id, png: await dataUrl(await twoColour()) })).json()) as { locked?: boolean };
    expect(marked.locked).toBe(true);
    const open = await libraryPicture(sageActor);
    const openRun = (await (await studioCall(sage, "studio-run", { file: open.id, operation: "crop", args: { x: 0, y: 0, width: 0.5, height: 1 } })).json()) as { token: string };
    const openApplied = (await (await studioCall(sage, "studio-apply", { file: open.id, token: openRun.token })).json()) as { locked?: boolean };
    expect(openApplied.locked).toBeUndefined();
  });

  test("the opened version is named for the picture it came from, not Picture (IMG-STUDIO-03)", async () => {
    const source = await libraryPicture(sageActor);
    db.update(attachments).set({ name: "meadow.png" }).where(eq(attachments.id, source.id)).run();
    const made = (await (await studioCall(sage, "studio-run", { file: source.id, operation: "adjust", args: { brightness: 20, contrast: 0, saturation: 0, warmth: 0, auto: false } })).json()) as { token: string };
    const version = (await (await studioCall(sage, "studio-apply", { file: source.id, token: made.token })).json()) as { id: string };
    for (const id of [source.id, version.id]) {
      const rows = (await (await studioRows(sage, id)).json()) as Array<{ title: string }>;
      expect(rows[0]!.title).toBe("meadow.png");
    }
  });

  test("an empty Library is one placeholder row; a Library with pictures is no row until one is picked (IMG-STUDIO-03)", async () => {
    expect(await (await studioRows(sage, "$state.file")).json()).toEqual([{ id: "", empty: true }]);
    await libraryPicture(sageActor);
    expect(await (await studioRows(sage, "$state.file")).json()).toEqual([]);
    // Nobody else's pictures count.
    expect(await (await studioRows(lucia, "")).json()).toEqual([{ id: "", empty: true }]);
  });
});
