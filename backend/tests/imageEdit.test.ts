import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { __resetImageEditForTests, __setImageToolsForTests, regionForStack } from "@/lib/imageEdit";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient, StackImageToolsStatus } from "@/lib/stack/client";
import { StackError } from "@/lib/stack/errors";
import { TestClient } from "./client";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { resetDb } from "./reset-db";

const READY: StackImageToolsStatus = { state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: { upscale_in: 6 }, operations: ["remove_background", "erase", "upscale", "resize"], reason: null };

async function jpegBytes(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 60, b: 60 } } }).jpeg().toBuffer());
}
async function pngBase64(width = 40, height = 30): Promise<string> {
  return (await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()).toString("base64");
}

type ToolMap = Record<"markup" | "comment" | "remove_background" | "erase" | "resize", { enabled: boolean; reason?: string }>;
interface Stub { client: StackClient; calls: { edits: FormData[]; cancelled: string[] }; script: { reply?: () => Promise<unknown>; job?: () => unknown } }
function stubStack(): Stub {
  const calls = { edits: [] as FormData[], cancelled: [] as string[] };
  const script: Stub["script"] = {};
  const client = {
    imageTools: async () => READY,
    roles: async () => ({ roles: [] }),
    imageEdit: async (form: FormData) => { calls.edits.push(form); return (await script.reply!()) as never; },
    job: async () => script.job!() as never,
    imageEditResult: async () => new Uint8Array(Buffer.from(await pngBase64(), "base64")),
    cancelJob: async (id: string) => { calls.cancelled.push(id); return {} as never; },
  } as unknown as StackClient;
  return { client, calls, script };
}

beforeEach(() => { resetDb(); __resetImageEditForTests(); });
afterEach(() => { __setStackClientForTests(null); __resetStackEngineForTests(); __resetImageEditForTests(); });

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}
async function upload(client: TestClient, conversationId: string, temporary = false): Promise<{ id: string; turnId: string }> {
  const turnId = newConversationTurnId();
  const form = new FormData();
  form.append("file", new File([await jpegBytes()], "robot.jpg", { type: "image/jpeg" }));
  form.append("turn_id", turnId);
  form.append("conversation_id", conversationId);
  form.append("temporary", temporary ? "true" : "false");
  const res = await client.postForm("/api/attachments/upload", form);
  expect(res.status).toBe(201);
  return { id: ((await res.json()) as { image: { id: string } }).image.id, turnId };
}
function editForm(conversationId: string, fields: Record<string, string>, mask?: Uint8Array): FormData {
  const form = new FormData();
  form.append("conversation_id", conversationId);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (mask) form.append("mask", new File([mask], "mask.png", { type: "image/png" }));
  return form;
}

describe("regionForStack", () => {
  test("a box dragged backwards, a click and a huge box all become a valid region inside the picture", () => {
    expect(regionForStack({ x: 0.6, y: 0.7, width: -0.4, height: -0.3 })).toBe("0.2,0.4,0.4,0.3");
    expect(regionForStack({ x: 0.5, y: 0.5, width: 0, height: 0 })).toBe("0.44,0.44,0.12,0.12");
    expect(regionForStack({ x: 0.9, y: 0.9, width: 5, height: 5 })).toBe("0,0,1,1");
    expect(regionForStack({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBeNull();
    expect(regionForStack(null)).toBeNull();
  });
});

describe("picture editor routes", () => {
  test("status reports each tool from the Stack and the reason a tool is off", async () => {
    const { client } = await owner();
    const stub = stubStack();
    __setStackClientForTests(stub.client);
    const ready = (await (await client.get("/api/image-edit/status")).json()) as { state: string; note: string | null; tools: ToolMap };
    expect(ready.state).toBe("ready");
    expect(ready.tools.remove_background.enabled).toBe(true);
    expect(ready.tools.erase.enabled).toBe(true);
    expect(ready.tools.comment).toEqual({ enabled: false, reason: expect.stringContaining("Picture creation isn't set up yet") });
    __setImageToolsForTests({ ...READY, state: "building", phase: "downloading" });
    const building = (await (await client.get("/api/image-edit/status")).json()) as { state: string; note: string; tools: ToolMap };
    expect(building.state).toBe("preparing");
    expect(building.note).toContain("Getting the editing tools ready");
    expect(building.tools.erase.enabled).toBe(false);
    expect(building.tools.markup.enabled).toBe(true);
    __setImageToolsForTests({ ...READY, state: "unsupported", reason: "This computer type is not supported yet." });
    const none = (await (await client.get("/api/image-edit/status")).json()) as { state: string; note: string };
    expect(none.state).toBe("not_installed");
    expect(none.note).toContain("aren't installed");
    __setImageToolsForTests({ ...READY, models: { isnet: true, lama: false, esrgan: true } });
    const noLama = (await (await client.get("/api/image-edit/status")).json()) as { tools: ToolMap };
    expect(noLama.tools.erase.enabled).toBe(false);
    expect(noLama.tools.erase.reason).toContain("isn't installed yet");
    __setImageToolsForTests(null);
    expect(((await (await client.get("/api/image-edit/status")).json()) as { state: string }).state).toBe("not_installed");
  });

  test("an older Stack with no tools route reads as not installed", async () => {
    const { client } = await owner();
    const stub = stubStack();
    (stub.client as unknown as { imageTools: () => Promise<never> }).imageTools = async () => { throw new StackError("unexpected", "Not Found", { status: 404 }); };
    __setStackClientForTests(stub.client);
    const status = (await (await client.get("/api/image-edit/status")).json()) as { state: string; note: string };
    expect(status.state).toBe("not_installed");
  });

  test("remove background previews, applies as a new version with provenance, and keeps the original", async () => {
    const { client, actor } = await owner();
    const stub = stubStack();
    stub.script.reply = async () => ({ kind: "done", job: "job-1", item: { b64_json: await pngBase64(), width: 40, height: 30, content_type: "image/png", operation: "remove_background", engine: "vision", model: "apple-vision", ms: 210 } });
    __setStackClientForTests(stub.client);
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("no conversation");
    const picture = await upload(client, conversation.value.id);
    const res = await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "remove_background" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; preview: { token: string; url: string; transparent: boolean; engine: string } };
    expect(body.state).toBe("done");
    expect(body.preview).toMatchObject({ transparent: true, engine: "vision" });
    expect(stub.calls.edits[0]!.get("operation")).toBe("remove_background");
    expect(stub.calls.edits[0]!.get("timeout_ms")).toBe("2500");
    const previewPng = await client.get(body.preview.url);
    expect(previewPng.headers.get("content-type")).toBe("image/png");
    const applied = await client.post(`/api/image-edit/previews/${body.preview.token}/apply`, {});
    expect(applied.status).toBe(200);
    const { version } = (await applied.json()) as { version: { id: string; label: string; op: string; url: string; source: string } };
    expect(version).toMatchObject({ label: "Background removed", op: "remove_background", source: picture.id });
    const row = db.select().from(attachments).where(eq(attachments.id, version.id)).get()!;
    expect(row.mediaType).toBe("image/png");
    expect(row.retention).toBe("conversation");
    expect(row.turnId).toBe(picture.turnId);
    const note = JSON.parse(row.provenance.replace("image-edit:", "")) as Record<string, unknown>;
    expect(note).toMatchObject({ v: 1, op: "remove_background", source: picture.id, root: picture.id, engine: "vision", model: "apple-vision" });
    expect(typeof note.source_sha256).toBe("string");
    const served = await client.get(version.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect((await sharp(new Uint8Array(await served.arrayBuffer())).metadata()).exif).toBeUndefined();
    const versions = (await (await client.get(`/api/image-edit/pictures/${version.id}/versions?conversation_id=${conversation.value.id}`)).json()) as { versions: { id: string; op: string }[] };
    expect(versions.versions.map((v) => v.op)).toEqual(["original", "remove_background"]);
    expect(versions.versions[0]!.id).toBe(picture.id);
    expect((await client.get(`/api/image-edit/previews/${body.preview.token}`)).status).toBe(404);
  });

  test("a slow edit continues as a job with progress, then done; cancel stops it", async () => {
    const { client, actor } = await owner();
    const stub = stubStack();
    stub.script.reply = async () => ({ kind: "running", job: "job-erase" });
    __setStackClientForTests(stub.client);
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("no conversation");
    const picture = await upload(client, conversation.value.id);
    const mask = new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: "white" } }).png().toBuffer());
    const started = (await (await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "erase" }, mask))).json()) as { state: string; job: string };
    expect(started).toMatchObject({ state: "running", job: "job-erase" });
    expect(stub.calls.edits[0]!.get("mask")).toBeInstanceOf(File);
    stub.script.job = () => ({ id: "job-erase", state: "running", percent: 40, position: null });
    expect(await (await client.get("/api/image-edit/jobs/job-erase")).json()).toMatchObject({ state: "running", percent: 40, label: "Erasing" });
    stub.script.job = () => ({ id: "job-erase", state: "done", percent: 100, position: null });
    const done = (await (await client.get("/api/image-edit/jobs/job-erase")).json()) as { state: string; preview: { operation: string; width: number } };
    expect(done.state).toBe("done");
    expect(done.preview).toMatchObject({ operation: "erase", width: 40 });
    const again = (await (await client.get("/api/image-edit/jobs/job-erase")).json()) as { state: string };
    expect(again.state).toBe("done");
    // a second job, cancelled
    stub.script.reply = async () => ({ kind: "running", job: "job-2" });
    await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "erase" }, mask));
    expect((await client.request("/api/image-edit/jobs/job-2", { method: "DELETE" })).status).toBe(200);
    expect(stub.calls.cancelled).toEqual(["job-2"]);
    expect((await client.get("/api/image-edit/jobs/job-2")).status).toBe(404);
  });

  test("a job the tool declines (no subject found) reads as a plain failure with the Stack's sentence", async () => {
    const { client, actor } = await owner();
    const stub = stubStack();
    stub.script.reply = async () => ({ kind: "running", job: "job-nosubject" });
    stub.script.job = () => ({ id: "job-nosubject", state: "done", percent: 100, position: null, result: { rejected: { code: "no_subject", message: "No subject was found. Try Erase instead." } } });
    __setStackClientForTests(stub.client);
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("no conversation");
    const picture = await upload(client, conversation.value.id);
    await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "remove_background" }));
    expect(await (await client.get("/api/image-edit/jobs/job-nosubject")).json()).toEqual({ state: "failed", error: "No subject was found. Try Erase instead.", code: "no_subject" });
  });

  test("erase without a mask, a bad size and the Stack's refusals come back in plain words", async () => {
    const { client, actor } = await owner();
    const stub = stubStack();
    __setStackClientForTests(stub.client);
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("no conversation");
    const picture = await upload(client, conversation.value.id);
    const noMask = await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "erase" }));
    expect(noMask.status).toBe(422);
    expect(((await noMask.json()) as { error: string }).error).toContain("Paint over");
    const noSize = await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "resize" }));
    expect(noSize.status).toBe(422);
    stub.script.reply = async () => { throw new StackError("unexpected", "The picture is 40 megapixels; upscaling takes up to 6.", { status: 413, body: JSON.stringify({ error: "x", code: "too_large" }) }); };
    const big = await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "upscale", scale: "2" }));
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: "The picture is 40 megapixels; upscaling takes up to 6.", code: "too_large" });
    stub.script.reply = async () => { throw new StackError("unreachable", "refused"); };
    const down = await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "resize", width: "20", height: "15" }));
    expect(down.status).toBe(503);
    expect(((await down.json()) as { error: string }).error).toContain("aren't running");
  });

  test("markup uploads are re-encoded without metadata and saved as a version", async () => {
    const { client, actor } = await owner();
    __setStackClientForTests(stubStack().client);
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("no conversation");
    const picture = await upload(client, conversation.value.id);
    const withExif = await sharp({ create: { width: 20, height: 10, channels: 3, background: "blue" } }).withExif({ IFD0: { Copyright: "someone" } }).png().toBuffer();
    const form = new FormData();
    form.append("conversation_id", conversation.value.id);
    form.append("image", new File([new Uint8Array(withExif)], "m.png", { type: "image/png" }));
    form.append("label", "Markup");
    const res = await client.postForm(`/api/image-edit/pictures/${picture.id}/versions`, form);
    expect(res.status).toBe(201);
    const { version } = (await res.json()) as { version: { id: string; op: string; width: number } };
    expect(version).toMatchObject({ op: "markup", width: 20 });
    const row = db.select().from(attachments).where(eq(attachments.id, version.id)).get()!;
    const stored = new Uint8Array(await Bun.file((await import("@/lib/attachments")).attachmentFilePath(row.storagePath)).arrayBuffer());
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    const bad = new FormData();
    bad.append("conversation_id", conversation.value.id);
    bad.append("image", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
    expect((await client.postForm(`/api/image-edit/pictures/${picture.id}/versions`, bad)).status).toBe(422);
  });

  test("another person cannot read, edit or apply someone else's picture; a child needs photos on", async () => {
    const { client, actor } = await owner();
    const stub = stubStack();
    stub.script.reply = async () => ({ kind: "done", job: "j", item: { b64_json: await pngBase64(), width: 40, height: 30, content_type: "image/png", operation: "resize" } });
    __setStackClientForTests(stub.client);
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("no conversation");
    const picture = await upload(client, conversation.value.id);
    const made = await client.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await made.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });
    const peek = await childClient.get(`/api/image-edit/pictures/${picture.id}?conversation_id=${conversation.value.id}`);
    expect([403, 404]).toContain(peek.status);
    const run = await childClient.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "resize", width: "10", height: "10" }));
    expect([403, 404]).toContain(run.status);
    expect(stub.calls.edits).toHaveLength(0);
    const childStatus = (await (await childClient.get("/api/image-edit/status")).json()) as { state: string; tools: ToolMap };
    // KIDS-CREATE-01: a child's editor is open for the cartoons made for them only; a photo (this one) is refused above whatever the status says.
    expect(childStatus.state).toBe("ready");
    const ok = await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "resize", width: "10", height: "10" }));
    const token = ((await ok.json()) as { preview: { token: string } }).preview.token;
    expect((await childClient.get(`/api/image-edit/previews/${token}`)).status).toBe(404);
    expect((await childClient.post(`/api/image-edit/previews/${token}/apply`, {})).status).toBe(404);
  });

  test("a temporary chat keeps versions in memory only", async () => {
    const { client, actor } = await owner();
    const stub = stubStack();
    stub.script.reply = async () => ({ kind: "done", job: "j", item: { b64_json: await pngBase64(), width: 40, height: 30, content_type: "image/png", operation: "remove_background" } });
    __setStackClientForTests(stub.client);
    const conversation = resolveOrCreateConversation(actor, "chat", undefined, { temporary: true });
    if (!conversation.ok) throw new Error("no conversation");
    const picture = await upload(client, conversation.value.id, true);
    const run = (await (await client.postForm(`/api/image-edit/pictures/${picture.id}/edit`, editForm(conversation.value.id, { operation: "remove_background" }))).json()) as { preview: { token: string } };
    const { version } = (await (await client.post(`/api/image-edit/previews/${run.preview.token}/apply`, {})).json()) as { version: { id: string; url: string } };
    expect(db.select().from(attachments).where(eq(attachments.id, version.id)).get()).toBeUndefined();
    expect((await client.get(version.url)).status).toBe(200);
    const list = (await (await client.get(`/api/image-edit/pictures/${picture.id}/versions?conversation_id=${conversation.value.id}`)).json()) as { versions: { op: string }[] };
    expect(list.versions.map((v) => v.op)).toEqual(["original", "remove_background"]);
  });

  test("Comment says plainly that picture creation is not set up and changes nothing", async () => {
    const { client, actor } = await owner();
    __setStackClientForTests(stubStack().client);
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("no conversation");
    const picture = await upload(client, conversation.value.id);
    const res = await client.post(`/api/image-edit/pictures/${picture.id}/comment`, { conversation_id: conversation.value.id, prompt: "make the sky pink", region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.stringContaining("Picture creation isn't set up yet"), code: "not_set_up" });
    expect(db.select().from(attachments).all()).toHaveLength(1);
  });

  describe("Comment with a picture engine (IMGGEN-EDITOR-01)", () => {
    let fake: FakeImageStack;
    // An uploaded photo must show no one or a named adult in this household; these tests use a photo with no one in it.
    beforeEach(() => { fake = installFakeImageStack(); __setStackClientForTests(stubStack().client); });
    afterEach(() => { fake.restore(); });

    async function commented(client: TestClient, conversationId: string, pictureId: string, body: Record<string, unknown>) {
      return client.post(`/api/image-edit/pictures/${pictureId}/comment`, { conversation_id: conversationId, ...body });
    }

    test("the status reports Comment ready when the Stack has a generative edit model", async () => {
      const { client } = await owner();
      const status = (await (await client.get("/api/image-edit/status")).json()) as { tools: ToolMap };
      expect(status.tools.comment).toEqual({ enabled: true });
    });

    test("a comment on a pointed-at area sends edit_masked with a region, then previews and applies as a new version", async () => {
      const { client, actor } = await owner();
      const conversation = resolveOrCreateConversation(actor, "chat");
      if (!conversation.ok) throw new Error("no conversation");
      const picture = await upload(client, conversation.value.id);
      const started = (await (await commented(client, conversation.value.id, picture.id, { prompt: "Make the sky pink", region: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } })).json()) as { state: string; job: string };
      expect(started.state).toBe("running");
      expect(fake.edits).toHaveLength(1);
      expect(fake.edits[0]).toMatchObject({ operation: "edit_masked", instruction: "Make the sky pink", region: "0.1,0.2,0.5,0.4", timeout_ms: "1" });
      let progress = (await (await client.get(`/api/image-edit/jobs/${started.job}`)).json()) as { state: string; preview?: { token: string; operation: string } };
      for (let i = 0; i < 6 && progress.state !== "done"; i += 1) progress = (await (await client.get(`/api/image-edit/jobs/${started.job}`)).json()) as typeof progress;
      expect(progress.state).toBe("done");
      expect(progress.preview!.operation).toBe("comment");
      // Nothing is saved until Apply.
      expect(db.select().from(attachments).all()).toHaveLength(1);
      const applied = (await (await client.post(`/api/image-edit/previews/${progress.preview!.token}/apply`, {})).json()) as { version: { id: string; label: string; op: string } };
      expect(applied.version).toMatchObject({ label: "Changed as described", op: "comment" });
      expect(db.select().from(attachments).all()).toHaveLength(2);
    });

    test("IMGEDIT-01: a painted area rides as the mask (only it can change) and a second picture of this chat is sent as the reference, an upload with no one in it as an upload", async () => {
      const { client, actor } = await owner();
      const conversation = resolveOrCreateConversation(actor, "chat");
      if (!conversation.ok) throw new Error("no conversation");
      const picture = await upload(client, conversation.value.id);
      const other = await upload(client, conversation.value.id);
      const mask = await pngBase64(40, 30);
      const started = await commented(client, conversation.value.id, picture.id, { prompt: "Remove the lamp", mask, reference_id: other.id });
      expect(started.status).toBe(200);
      expect(fake.edits[0]).toMatchObject({ operation: "edit_masked", instruction: "Remove the lamp", image_source: "uploaded", reference_source: "uploaded" });
      expect(fake.edits[0]!.mask).toMatch(/^file:/);
      expect(fake.edits[0]!.reference).toMatch(/^file:/);
      expect(fake.edits[0]!.region).toBeUndefined();
      // The same picture twice is refused before anything is sent.
      fake.edits.length = 0;
      const same = await commented(client, conversation.value.id, picture.id, { prompt: "Remove the lamp", reference_id: picture.id });
      expect(same.status).toBe(422);
      expect(fake.edits).toHaveLength(0);
      const person = await commented(client, conversation.value.id, picture.id, { prompt: "Add her", reference_id: other.id });
      expect(person.status).toBe(200);
      expect(fake.edits).toHaveLength(1);
    });

    test("IMGGEN-SAFE-01: a described change passes the finished-picture check; a possible minor in a sexual result is withheld and never kept as a preview", async () => {
      const { client, actor } = await owner();
      const conversation = resolveOrCreateConversation(actor, "chat");
      if (!conversation.ok) throw new Error("no conversation");
      const picture = await upload(client, conversation.value.id);
      const { __setAgeCheckRunnerForTests } = await import("@/lib/pictures/ageCheck");
      try {
        // The first run is the INPUT screen of the uploaded source (an empty picture); the second is the finished result.
        let run = 0;
        __setAgeCheckRunnerForTests(async (images) => images.map(() => (run++ === 0
          ? { ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } }
          : { ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 9, label: "child" as const, is_nude_or_sexual: true, confidence: 0.9 } })));
        const started = (await (await commented(client, conversation.value.id, picture.id, { prompt: "Make the sky pink", region: null })).json()) as { job: string };
        let progress = (await (await client.get(`/api/image-edit/jobs/${started.job}`)).json()) as { state: string; error?: string; code?: string; preview?: unknown };
        for (let i = 0; i < 6 && progress.state !== "failed" && progress.state !== "done"; i += 1) progress = (await (await client.get(`/api/image-edit/jobs/${started.job}`)).json()) as typeof progress;
        expect(progress.state).toBe("failed");
        expect(progress.error).toBe("I can't show that picture. It may show a child in a sexual situation, and that is never allowed.");
        expect(progress.code).toBe("withheld_minor_sexual");
        expect(progress.preview).toBeUndefined();
        expect(db.select().from(attachments).all()).toHaveLength(1);
      } finally {
        __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
      }
    });

    test("the input floor: CSAM is refused; ordinary child mentions pass for an adult", async () => {
      const { client, actor } = await owner();
      const conversation = resolveOrCreateConversation(actor, "chat");
      if (!conversation.ok) throw new Error("no conversation");
      const picture = await upload(client, conversation.value.id);
      const { __setAgeCheckRunnerForTests } = await import("@/lib/pictures/ageCheck");
      const none = { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 };
      try {
        __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: none })));
        const cue = await commented(client, conversation.value.id, picture.id, { prompt: "make the person look like a child", region: null });
        expect(cue.status).toBe(200);
        // The ordinary child mention above reached the engine; the refused ask below adds no second edit.
        expect(fake.edits).toHaveLength(1);
        __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { ...none, people_count: 1, apparent_min_age_estimate: 9, label: "child" as const } })));
        const sexualAsk = await commented(client, conversation.value.id, picture.id, { prompt: "make child porn", region: null });
        expect(sexualAsk.status).toBe(422);
        expect(fake.edits).toHaveLength(1);
      } finally {
        __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: none })));
      }
    });

    test("a click with no size becomes a small box around the point; no region edits the whole picture", async () => {
      const { client, actor } = await owner();
      const conversation = resolveOrCreateConversation(actor, "chat");
      if (!conversation.ok) throw new Error("no conversation");
      const picture = await upload(client, conversation.value.id);
      await commented(client, conversation.value.id, picture.id, { prompt: "Add a hat", region: { x: 0.5, y: 0.5, width: 0, height: 0 } });
      expect(fake.edits[0]!.region).toBe("0.44,0.44,0.12,0.12");
      await commented(client, conversation.value.id, picture.id, { prompt: "Make it evening", region: null });
      expect(fake.edits[1]).toMatchObject({ operation: "edit" });
      expect(fake.edits[1]!.region).toBeUndefined();
    });

    test("a child's editor refuses a photo and sends nothing; a teen's is open (owner rulings 2026-10-17)", async () => {
      const { client, actor } = await owner();
      const conversation = resolveOrCreateConversation(actor, "chat");
      if (!conversation.ok) throw new Error("no conversation");
      const picture = await upload(client, conversation.value.id);
      db.update(people).set({ role: "teen" }).where(eq(people.id, actor.id)).run();
      invalidateSessionCacheForPerson(actor.id);
      const teenStatus = (await (await client.get("/api/image-edit/status")).json()) as { tools: ToolMap };
      expect(teenStatus.tools.comment.enabled).toBe(true);
      db.update(people).set({ role: "child" }).where(eq(people.id, actor.id)).run();
      invalidateSessionCacheForPerson(actor.id);
      // A child: the editor works on their own cartoons only, so a photo they were sent or uploaded is refused.
      const refused = await commented(client, conversation.value.id, picture.id, { prompt: "Make it pink", region: null });
      expect([403, 404, 503]).toContain(refused.status);
      expect(fake.edits).toHaveLength(0);
    });

    test("the minor line applies to a comment; an adult is not held to a sexual-edit refusal on a photo (models censor)", async () => {
      const { client, actor } = await owner();
      const conversation = resolveOrCreateConversation(actor, "chat");
      if (!conversation.ok) throw new Error("no conversation");
      const picture = await upload(client, conversation.value.id);
      const minor = await commented(client, conversation.value.id, picture.id, { prompt: "make her a nude child", region: null });
      expect(minor.status).toBe(422);
      for (const words of ["put her in lingerie", "take off her shirt", "make her shirtless", "remove her clothes"]) {
        const photo = await commented(client, conversation.value.id, picture.id, { prompt: words, region: null });
        expect(photo.status).toBe(200);
      }
      const fine = await commented(client, conversation.value.id, picture.id, { prompt: "change her sweater to bright blue", region: null });
      expect(fine.status).toBe(200);
      // The minor line stopped the first request; the adult's four and the ordinary change reached the engine.
      expect(fake.edits).toHaveLength(5);
      expect(fake.edits[4]!.instruction).toBe("change her sweater to bright blue");
    });

    test("Stop reaches the picture engine", async () => {
      const { client, actor } = await owner();
      const conversation = resolveOrCreateConversation(actor, "chat");
      if (!conversation.ok) throw new Error("no conversation");
      const picture = await upload(client, conversation.value.id);
      const started = (await (await commented(client, conversation.value.id, picture.id, { prompt: "Add a hat", region: null })).json()) as { job: string };
      await client.request(`/api/image-edit/jobs/${started.job}`, { method: "DELETE" });
      expect(fake.jobs[0]!.deleted).toBe(true);
    });
  });
});
