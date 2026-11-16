// CREATOR-17 Expand: the canvas and mask geometry for each shape, the operation's registration and gates, the one plain line when the engine
// has no masked fill, and a run against the fake picture engine that sends the expected canvas and mask and makes a new version.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, settingsValues } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { __resetImageEditForTests, __setImageToolsForTests, LIBRARY_PICTURE_LOCKED } from "@/lib/imageEdit";
import { editPictureSpec } from "@/lib/mediaOps/chatSchema";
import { listMediaOps } from "@/lib/mediaOps/registry";
import { studioOperationRows } from "@/lib/mediaOps/studio";
import { EXPAND_NEEDS_ENGINE, EXPAND_SHAPES, expandGeometry, expandMaskPixels, planExpand, type ExpandShape } from "@/lib/pictures/expand";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackImageToolsStatus } from "@/lib/stack/client";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";
import { resetDb } from "./reset-db";

const READY: StackImageToolsStatus = { state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: { upscale_in: 6 }, operations: ["remove_background", "erase", "upscale", "resize"], reason: null };
const ALL_AGES = 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}';
const ADULT_LOCKED = 'picture-gen:{"v":1,"audience":"adult-only","made_audience":"adult-only","lock":"on","prompt":"a boat"}';
const ASPECT: Record<ExpandShape, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1 };
const SOURCES = { landscape: [1200, 800], portrait: [800, 1200], square: [1000, 1000] } as const;

describe("expand geometry", () => {
  for (const [name, [w, h]] of Object.entries(SOURCES)) {
    for (const shape of EXPAND_SHAPES) {
      test(`${name} ${w}x${h} to ${shape}: the shape is right, the picture is centred, never cropped and only scaled down`, () => {
        const g = expandGeometry(w, h, shape);
        // Right shape, within the rounding to the engine's size step.
        expect(Math.abs(g.canvasWidth / g.canvasHeight - ASPECT[shape]) / ASPECT[shape]).toBeLessThan(0.02);
        expect(g.canvasWidth % 16).toBe(0);
        expect(g.canvasHeight % 16).toBe(0);
        expect(Math.max(g.canvasWidth, g.canvasHeight)).toBeLessThanOrEqual(2048 + 16);
        // The whole picture is on the canvas, in proportion, centred (within one pixel), never bigger than it was.
        expect(g.placedWidth).toBeLessThanOrEqual(w);
        expect(g.placedHeight).toBeLessThanOrEqual(h);
        expect(Math.abs(g.placedWidth / g.placedHeight - w / h)).toBeLessThan(0.01);
        expect(g.left + g.placedWidth).toBeLessThanOrEqual(g.canvasWidth);
        expect(g.top + g.placedHeight).toBeLessThanOrEqual(g.canvasHeight);
        expect(Math.abs(g.left - (g.canvasWidth - g.placedWidth - g.left))).toBeLessThanOrEqual(1);
        expect(Math.abs(g.top - (g.canvasHeight - g.placedHeight - g.top))).toBeLessThanOrEqual(1);
        // The part kept untouched is inside the picture.
        expect(g.keep.x).toBeGreaterThanOrEqual(g.left);
        expect(g.keep.y).toBeGreaterThanOrEqual(g.top);
        expect(g.keep.x + g.keep.width).toBeLessThanOrEqual(g.left + g.placedWidth);
        expect(g.keep.y + g.keep.height).toBeLessThanOrEqual(g.top + g.placedHeight);
      });
    }
  }

  test("literal sizes: a 1200x800 landscape to 16:9 gets a wider canvas at full size; to 9:16 it is scaled down to fit the engine", () => {
    expect(expandGeometry(1200, 800, "16:9")).toMatchObject({ canvasWidth: 1424, canvasHeight: 800, placedWidth: 1200, placedHeight: 800, left: 112, top: 0, grows: true });
    expect(expandGeometry(1200, 800, "9:16")).toMatchObject({ canvasWidth: 1152, canvasHeight: 2048, placedWidth: 1152, placedHeight: 768, left: 0, top: 640, grows: true });
    expect(expandGeometry(1000, 1000, "1:1").grows).toBe(false);
    expect(expandGeometry(1600, 900, "16:9").grows).toBe(false);
  });

  test("the mask is white over the new area and a thin ring of the original, black over the rest of the original", () => {
    const g = expandGeometry(1200, 800, "16:9");
    const mask = expandMaskPixels(g);
    const at = (x: number, y: number) => mask[y * g.canvasWidth + x];
    expect(mask.length).toBe(g.canvasWidth * g.canvasHeight);
    expect(at(10, 400)).toBe(255); // new area on the left
    expect(at(g.canvasWidth - 10, 400)).toBe(255); // new area on the right
    expect(at(g.left + 2, 400)).toBe(255); // inside the ring
    expect(at(g.left + g.ring + 2, 400)).toBe(0); // the original
    expect(at(g.canvasWidth / 2, 400)).toBe(0);
    // The edges that meet no new area keep no ring: the top and bottom rows of the original stay black.
    expect(at(g.canvasWidth / 2, 0)).toBe(0);
    expect(at(g.canvasWidth / 2, g.canvasHeight - 1)).toBe(0);
    const white = mask.reduce((n, v) => n + (v === 255 ? 1 : 0), 0);
    expect(white).toBeGreaterThan((g.canvasWidth - g.placedWidth) * g.canvasHeight);
    expect(white).toBeLessThan((g.canvasWidth - g.placedWidth + 2 * g.ring) * g.canvasHeight + 1);
  });

  test("planExpand draws a canvas with the original in the middle and a PNG mask of the same size", async () => {
    const red = new Uint8Array(await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer());
    const plan = await planExpand(red, "1:1");
    expect([plan.canvasWidth, plan.canvasHeight]).toEqual([128, 128]);
    const canvas = sharp(plan.canvas); const maskMeta = await sharp(plan.mask).metadata();
    expect(await canvas.metadata()).toMatchObject({ width: 128, height: 128 });
    expect([maskMeta.width, maskMeta.height]).toEqual([128, 128]);
    const { data, info } = await sharp(plan.canvas).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(px(64, 64)).toEqual([255, 0, 0]);
    expect(px(64, 2)).toEqual([128, 128, 128]);
  });
});

let sage: TestClient; let sageActor: PersonRow;
let nova: TestClient; let novaActor: PersonRow;
function allowPhotos(personId: string) {
  db.insert(settingsValues).values({ scope: `person:${personId}`, key: "chat.photo_uploads", value: "true", hlc: "1:0:test", source: "self", setBy: personId, updatedAt: new Date().toISOString() }).run();
}
async function landscape(w = 120, h = 80) { return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer()); }
async function libraryPicture(owner: PersonRow, provenance = ALL_AGES) {
  const stored = storeFile(owner, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await landscape(), provenance, retention: "kept", deduplicate: false });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value;
}
const run = (client: TestClient, op: string, body: Record<string, unknown>) => client.post(`/api/media-ops/${op}`, body);

beforeEach(async () => {
  resetDb(); __resetImageEditForTests();
  __setImageToolsForTests(READY, true);
  __setRoleHealthForTests({ image: { availability: "ready", reason: null } });
  sage = new TestClient();
  const made = await sage.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  sageActor = db.select().from(people).where(eq(people.id, ((await made.json()) as { person: { id: string } }).person.id)).get()!;
  allowPhotos(sageActor.id);
  const child = await sage.post("/api/people", { displayName: "Nova", role: "child", secret: "0000" });
  const id = ((await child.json()) as { id: string }).id;
  nova = new TestClient();
  await nova.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  novaActor = db.select().from(people).where(eq(people.id, id)).get()!;
});
afterEach(() => { __setStackClientForTests(null); __resetStackEngineForTests(); __setImageToolsForTests(undefined); __setPictureStatusForTests(undefined); __setPicturesFetchForTests(null); __setRoleHealthForTests({}); __resetImageEditForTests(); });

describe("the expand operation", () => {
  test("it is registered for pictures, listed in the Studio under More and offered to chat", async () => {
    __setPictureStatusForTests(readyStatusForTests());
    const ops = await listMediaOps(sageActor, { input: "picture" });
    const expand = ops.find((op) => op.id === "picture.expand")!;
    expect(expand).toMatchObject({ label: "Expand", input: "picture", output: "picture", needs: "image", enabled: true });
    expect(expand.controls[0]).toMatchObject({ kind: "choice", name: "shape", options: ["16:9", "9:16", "4:5", "1:1"] });
    const file = await libraryPicture(sageActor);
    const rows = await studioOperationRows(sageActor, { id: file.id });
    expect(rows.find((row) => row.id === "picture.expand")).toMatchObject({ label: "Expand", enabled: true });
    const schema = editPictureSpec("edit_picture", { editPictureAllowed: true, editPictureOps: ops, editPictureIds: [], actor: sageActor } as never)!;
    expect((schema.args.properties as { op: { enum: string[] } }).op.enum).toContain("picture.expand");
  });

  test("an engine with no masked fill is listed off with one plain line and starts nothing", async () => {
    const sent: unknown[] = [];
    __setPicturesFetchForTests((async (_i, init) => { sent.push(init?.body); return new Response("{}", { status: 500 }); }) as typeof fetch);
    __setPictureStatusForTests(readyStatusForTests({ edit: { generative: true, masked: false, references: 2 } }));
    const file = await libraryPicture(sageActor);
    const rows = await studioOperationRows(sageActor, { id: file.id });
    expect(rows.find((row) => row.id === "picture.expand")).toMatchObject({ enabled: false, reason: EXPAND_NEEDS_ENGINE });
    const res = await run(sage, "picture.expand", { file_id: file.id, args: { shape: "16:9" } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("Making a picture wider or taller needs a picture model that can fill just the new area. The model on this computer cannot do that yet.");
    expect(sent).toHaveLength(0);
    expect(db.select().from(attachments).all()).toHaveLength(1);
  });

  test("a locked picture is refused with the locked line and nothing starts", async () => {
    __setPictureStatusForTests(readyStatusForTests());
    const sent: unknown[] = [];
    __setPicturesFetchForTests((async (_i, init) => { sent.push(init?.body); return new Response("{}", { status: 500 }); }) as typeof fetch);
    const file = await libraryPicture(sageActor, ADULT_LOCKED);
    const res = await run(sage, "picture.expand", { file_id: file.id, args: { shape: "1:1" } });
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ error: LIBRARY_PICTURE_LOCKED, code: "locked" });
    expect(sent).toHaveLength(0);
  });

  test("another person's picture is not found, and a shape that is not offered is refused", async () => {
    __setPictureStatusForTests(readyStatusForTests());
    const file = await libraryPicture(sageActor);
    expect((await run(nova, "picture.expand", { file_id: file.id, args: { shape: "16:9" } })).status).toBe(404);
    expect((await run(sage, "picture.expand", { file_id: file.id, args: { shape: "3:1" } })).status).toBe(422);
    void novaActor;
  });

  describe("with the fake picture engine", () => {
    let fake: FakeImageStack;
    beforeEach(() => { fake = installFakeImageStack(); });
    afterEach(() => { fake.restore(); });

    test("a masked fill is sent with the canvas, the mask and the words, and the result is a new version of the picture", async () => {
      const file = await libraryPicture(sageActor);
      const forms: FormData[] = [];
      const inner = fake.handler;
      __setPicturesFetchForTests((async (input, init) => { if (init?.body instanceof FormData) forms.push(init.body); return inner(input, init); }) as typeof fetch);
      const res = await run(sage, "picture.expand", { file_id: file.id, args: { shape: "1:1", words: "more sea" } });
      expect(res.status).toBe(200);
      const started = (await res.json()) as { state: string; job: string };
      expect(started.state).toBe("running");
      expect(forms).toHaveLength(1);
      const form = forms[0]!;
      expect(form.get("operation")).toBe("edit_masked");
      expect(String(form.get("instruction"))).toBe("Continue the scene naturally into the new area: more sea.");
      const canvas = await sharp(new Uint8Array(await (form.get("image") as File).arrayBuffer())).metadata();
      const mask = await sharp(new Uint8Array(await (form.get("mask") as File).arrayBuffer())).metadata();
      expect([canvas.width, canvas.height]).toEqual([128, 128]);
      expect([mask.width, mask.height]).toEqual([128, 128]);
      // It shows on the Activity list while it runs, like any other edit.
      let progress = (await (await sage.get(`/api/media-ops/jobs/${started.job}`)).json()) as { state: string; preview?: { token: string } };
      for (let i = 0; i < 8 && progress.state !== "done"; i += 1) progress = (await (await sage.get(`/api/media-ops/jobs/${started.job}`)).json()) as typeof progress;
      expect(progress.state).toBe("done");
      const before = db.select().from(attachments).all().length;
      const applied = await sage.post(`/api/media-ops/previews/${progress.preview!.token}/apply`, {});
      expect(applied.status).toBe(200);
      const version = ((await applied.json()) as { version: { id: string; source: string } }).version;
      expect(version.source).toBe(file.id);
      expect(db.select().from(attachments).all().length).toBe(before + 1);
      // The original is untouched.
      expect((await sharp(new Uint8Array(await (await sage.get(`/api/media-ops/files/${file.id}/content`)).arrayBuffer())).metadata()).width).toBe(120);
    });

    test("a picture that already has the shape is refused in one plain line and nothing is sent", async () => {
      const file = await libraryPicture(sageActor);
      const res = await run(sage, "picture.expand", { file_id: file.id, args: { shape: "4:5" } });
      expect(res.status).toBe(200);
      const same = storeFile(sageActor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await landscape(100, 100), provenance: ALL_AGES, retention: "kept", deduplicate: false });
      if (!same.ok) throw new Error(same.error);
      const before = fake.edits.length;
      const refused = await run(sage, "picture.expand", { file_id: same.value.id, args: { shape: "1:1" } });
      expect(refused.status).toBe(422);
      expect(((await refused.json()) as { error: string }).error).toBe("That picture is already that shape. Choose a different shape.");
      expect(fake.edits.length).toBe(before);
    });
  });
});
