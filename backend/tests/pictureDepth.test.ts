// CREATOR-44: Depth is one registered picture edit, ready only when the Stack has its model and operation.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, settingsValues } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { __resetImageEditForTests, __setImageToolsForTests, LIBRARY_SOURCE, loadSource, saveVersion } from "@/lib/imageEdit";
import { listMediaOps, runMediaOp } from "@/lib/mediaOps/registry";
import { editPictureSpec } from "@/lib/mediaOps/chatSchema";
import { toolsOfferedStat, NO_RECORD_BUDGET } from "@/lib/turnMachine/budget";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackImageToolsStatus } from "@/lib/stack/client";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

const READY: StackImageToolsStatus = { state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true, depth: true }, limits: {}, operations: ["depth"], reason: null };
const LOCKED = 'picture-gen:{"v":1,"audience":"adult-only","made_audience":"adult-only","lock":"on","prompt":"a boat"}';
const ALLOWED = 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}';
let owner: PersonRow;
let teen: PersonRow;
let child: PersonRow;
function person(id: string, displayName: string, role: string) {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()!;
}
function allowPhotos(personId: string) {
  db.insert(settingsValues).values({ scope: `person:${personId}`, key: "chat.photo_uploads", value: "true", hlc: "1:0:test", source: "self", setBy: personId, updatedAt: new Date().toISOString() }).run();
}
async function picture(actor: PersonRow, provenance = ALLOWED) {
  const bytes = new Uint8Array(await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 90, g: 140, b: 200 } } }).png().toBuffer());
  const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance, retention: "kept", deduplicate: false });
  if (!saved.ok) throw new Error(saved.error);
  return saved.value;
}
const note = (id: string) => JSON.parse(db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance.replace(/^image-edit:/, "")) as Record<string, unknown>;

beforeEach(() => {
  resetDb(); __resetImageEditForTests(); __setImageToolsForTests(READY, true);
  owner = person("person-depthowner", "Sage", "owner"); teen = person("person-depthteen", "Marlow", "teen"); child = person("person-depthchild", "Nova", "child");
  allowPhotos(owner.id); allowPhotos(teen.id);
});
afterEach(() => { __setStackClientForTests(null); __resetStackEngineForTests(); __setImageToolsForTests(undefined); __resetImageEditForTests(); });

describe("picture.depth", () => {
  test("is registered, listed, has an empty-argument chat choice, and leaves the offered tool count unchanged", async () => {
    const op = (await listMediaOps(owner, { input: "picture" })).find((row) => row.id === "picture.depth");
    expect(op).toMatchObject({ label: "Depth map", summary: "Make a grayscale picture of how near or far things are.", minBand: "child", ready: true });
    expect(op!.args.parse({})).toEqual({});
    const spec = editPictureSpec("edit_picture", { editPictureAllowed: true, editPictureOps: [op!], editPictureIds: [], actor: owner } as never)!;
    expect((spec.args.properties as { op: { enum: string[] } }).op.enum).toEqual(["picture.depth"]);
    const stat = toolsOfferedStat({ ...NO_RECORD_BUDGET, model_transitions: true, rounds: 2, tools_offered: ["edit_picture"] }, () => spec);
    expect(stat.count).toBe(1);
  });

  test("a fake Stack depth reply is saved with provenance and preserves a locked source", async () => {
    const source = await picture(owner, ALLOWED);
    const sourceInfo = loadSource(owner, LIBRARY_SOURCE, source.id, true);
    const depthPng = new Uint8Array(await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 120, g: 120, b: 120 } } }).greyscale().png().toBuffer());
    const asked: string[] = [];
    __setStackClientForTests({ imageEdit: async (form: FormData) => {
      asked.push(String(form.get("operation")));
      return { kind: "done", job: "depth-job", item: { b64_json: Buffer.from(depthPng).toString("base64"), width: 32, height: 24, content_type: "image/png", operation: "depth", engine: "image-tools", model: "image-tool-depth-anything-v2-small", ms: 23 } };
    } } as never);
    const preview = await runMediaOp(owner, "picture.depth", { source: { kind: "picture", via: "file", id: source.id }, args: {} }) as { file: { state: string; preview: { token: string } } };
    expect(preview.file.state).toBe("done"); expect(asked).toEqual(["depth"]);
    // A locked file cannot enter an edit path. Its lock item and a depth result with that same mark both remain locked.
    const saved = await saveVersion(owner, { ...sourceInfo, adultMark: { madeAudience: "adult-only", lock: "on" }, audience: "adult-only" }, depthPng, { op: "depth", label: "Depth map", model: "image-tool-depth-anything-v2-small", engine: "image-tools", ms: 23 });
    const record = note(saved.id);
    expect(record).toMatchObject({ op: "depth", source: source.id, model: "image-tool-depth-anything-v2-small", lock: "on", audience: "adult-only" });
    const locked = await picture(owner, LOCKED);
    expect(() => loadSource(owner, LIBRARY_SOURCE, locked.id, true)).toThrow(/locked/i);
  });

  test("a missing model shows one plain not-ready line and does not call the Stack", async () => {
    __setImageToolsForTests({ ...READY, models: { ...READY.models, depth: false }, operations: [] }, true);
    const listed = (await listMediaOps(owner, { input: "picture" })).find((row) => row.id === "picture.depth")!;
    expect(listed.enabled).toBe(false);
    expect(listed.reason).toBe("Depth maps isn't installed yet. Ask an admin to install the editing models, then try again.");
    const source = await picture(owner);
    await expect(runMediaOp(owner, "picture.depth", { source: { kind: "picture", via: "file", id: source.id }, args: {} })).rejects.toMatchObject({ status: 503, message: listed.reason });
  });

  test("a child and a teen band can run it", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer());
    const asked: string[] = [];
    __setStackClientForTests({ imageEdit: async (form: FormData) => {
      asked.push(String(form.get("operation")));
      return { kind: "done", job: "depth-job", item: { b64_json: Buffer.from(png).toString("base64"), width: 32, height: 24, content_type: "image/png", operation: "depth" } };
    } } as never);
    const cartoonBytes = new Uint8Array(await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer());
    const cartoon = storeFile(child, { conversationId: null, turnId: null, mediaType: "image/png", bytes: cartoonBytes, provenance: 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}', retention: "kept", deduplicate: false });
    if (!cartoon.ok) throw new Error(cartoon.error);
    for (const [actor, source] of [[child, cartoon.value], [teen, await picture(teen)]] as const) {
      const listed = (await listMediaOps(actor, { input: "picture" })).find((row) => row.id === "picture.depth");
      expect(listed?.minBand).toBe("child");
      const result = await runMediaOp(actor, "picture.depth", { source: { kind: "picture", via: "file", id: source.id }, args: {} }) as { file: { state: string } };
      expect(result.file.state).toBe("done");
    }
    expect(asked).toEqual(["depth", "depth"]);
  });
});
