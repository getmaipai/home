import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, settingsValues } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { __setImageToolsForTests } from "@/lib/imageEdit";
import { __setPicturePollMsForTests, __resetPictureJobsForTests, getPictureJob } from "@/lib/pictures/jobs";
import { pictureEngineStatus } from "@/lib/pictures/ready";
import { readPictureMakeBody, makePictureFor } from "@/lib/pictures/make";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { TestClient } from "./client";

let owner: PersonRow;
let fake: FakeImageStack;
let client: TestClient;
const png = async () => new Uint8Array(await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 90, g: 140, b: 200 } } }).png().toBuffer());
function person(id: string, role: string) {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()!;
}
function allowPhotos(id: string) {
  db.insert(settingsValues).values({ scope: `person:${id}`, key: "chat.photo_uploads", value: "true", hlc: "1:0:test", source: "self", setBy: id, updatedAt: new Date().toISOString() }).run();
}
function file(actor: PersonRow, bytes: Uint8Array, provenance = 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a blue boat"}') {
  const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance, retention: "kept", deduplicate: false });
  if (!saved.ok) throw new Error(saved.error);
  return saved.value;
}

beforeEach(async () => {
  resetDb(); __resetPictureJobsForTests(); __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: {}, limits: { max_n: 4 }, operations: [], reason: null }, true);
  __setRoleHealthForTests({ image: { availability: "ready", reason: null } });
  fake = installFakeImageStack({ pollsToFinish: 1 });
  client = new TestClient();
  const setup = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  owner = db.select().from(people).where(eq(people.id, ((await setup.json()) as { person: { id: string } }).person.id)).get()!;
  allowPhotos(owner.id);
});
afterEach(() => { fake.restore(); __setStackClientForTests(null); __resetStackEngineForTests(); __setImageToolsForTests(undefined); __setRoleHealthForTests({}); __setPicturePollMsForTests(null); __resetPictureJobsForTests(); });

describe("Images Create make", () => {
  test("reads placeholders as empty and validates shape, count, presets, cast and reference limits", () => {
    expect(readPictureMakeBody({ prompt: "a boat", shape: "{shape}", count: "{count}", tier: "none", references: ["{reference}"] })).toMatchObject({ ok: true, body: { prompt: "a boat" } });
    expect(readPictureMakeBody({ prompt: "a boat", shape: "sideways" }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a boat", count: "9" }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a boat", references: ["a", "b", "c", "d"] }).ok).toBe(false);
  });

  test("an empty prompt is allowed with a template and refused without one", () => {
    expect(readPictureMakeBody({ prompt: "", template: "mtpl-poster" })).toMatchObject({ ok: true, body: { prompt: "", template: "mtpl-poster" } });
    expect(readPictureMakeBody({ template: "mtpl-poster" }).ok).toBe(true);
    expect(readPictureMakeBody({ prompt: "x".repeat(1201), template: "mtpl-poster" }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "" }).ok).toBe(false);
  });

  test("folds flat Create preset chip values and one reference into the make request", () => {
    expect(readPictureMakeBody({ prompt: "a boat", shape: "wide", count: 8, tier: "boost", look_oil: "look-oil", light: "none", angle: "angle-high", format: "format-square", reference: "file-one" })).toMatchObject({ ok: true, body: { prompt: "a boat", count: 8, tier: "boost", presets: { look: "look-oil", angle: "angle-high", format: "format-square" }, references: ["file-one"] } });
  });

  test("submits a prompt-only Create job without a conversation and stores the finished image in Library", async () => {
    const read = readPictureMakeBody({ prompt: "a blue boat" });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const made = await makePictureFor(owner, read.body);
    expect(made).toMatchObject({ ok: true });
    if (!made.ok) return;
    expect(made.ids).toHaveLength(1);
    // The reply text is for the chat model; a person is never shown it (the notice is null unless extra references were left out).
    expect(made.notice).toBeNull();
    const job = getPictureJob(owner, made.ids[0]!);
    expect(job).toMatchObject({ conversationId: null, turnId: null, temporary: false, kind: "generate" });
    await until(() => !!db.select().from(attachments).where(eq(attachments.ownerPersonId, owner.id)).all().find((item) => item.provenance.startsWith("picture-gen:")));
    const row = db.select().from(attachments).where(eq(attachments.ownerPersonId, owner.id)).all().find((item) => item.provenance.startsWith("picture-gen:"));
    expect(row).toMatchObject({ conversationId: null, retention: "kept" });
  });

  test("parses references and rejects another person's or locked Library file before submitting", async () => {
    const other = person("person-makeother", "owner");
    const someoneElses = file(other, await png());
    const locked = file(owner, await png(), 'picture-gen:{"v":1,"audience":"adult-only","made_audience":"adult-only","lock":"on","prompt":"a portrait"}');
    const bad = readPictureMakeBody({ prompt: "a portrait", references: [someoneElses.id] });
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    const made = await makePictureFor(owner, bad.body);
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.toLowerCase()).toContain("can't find that picture");
    const lockedRead = readPictureMakeBody({ prompt: "a portrait", references: [locked.id] });
    expect(lockedRead.ok).toBe(true);
    if (lockedRead.ok) {
      const result = await makePictureFor(owner, lockedRead.body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.toLowerCase()).toContain("locked");
    }
    expect(await pictureEngineStatus()).toBeTruthy();
  });

  test("a Library reference is the Stack edit image and makes a new generated file, with one job per take", async () => {
    const reference = file(owner, await png());
    const read = readPictureMakeBody({ prompt: "a boat at sunset", count: 3, references: [reference.id] });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const made = await makePictureFor(owner, read.body);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.ids).toHaveLength(3);
    await until(() => fake.edits.length === 3);
    expect(fake.edits.every((edit) => edit.operation === "edit" && typeof edit.image === "string")).toBe(true);
    expect(fake.edits[0]).toMatchObject({ image_source: "generated" });
    expect(getPictureJob(owner, made.ids[0]!)).toMatchObject({ kind: "generate", conversationId: null, request: { source_file_id: null } });
    expect(getPictureJob(owner, made.ids[0]!)?.request.edit).toBeUndefined();
    await until(() => db.select().from(attachments).where(eq(attachments.ownerPersonId, owner.id)).all().some((row) => row.provenance.startsWith("picture-gen:") && row.id !== reference.id));
    const result = db.select().from(attachments).where(eq(attachments.ownerPersonId, owner.id)).all().find((row) => row.provenance.startsWith("picture-gen:") && row.id !== reference.id)!;
    expect(result.provenance).not.toContain(`source":"${reference.id}`);
  });

  test("a child cannot use a photo reference", async () => {
    const child = person("person-makechild", "child");
    const photo = file(child, await png(), "composer:photo");
    const read = readPictureMakeBody({ prompt: "a cartoon boat", references: [photo.id] });
    expect(read.ok).toBe(true);
    if (read.ok) {
      const result = await makePictureFor(child, read.body);
      expect(result).toMatchObject({ ok: false, error: "I can make cartoons for you, but not from photos. How about a friendly dragon?" });
    }
    expect(fake.edits).toHaveLength(0);
    expect(fake.submitted).toHaveLength(0);
  });

  test("POST /api/plugins/image/actions/make returns the created job id list", async () => {
    fake.pollsToFinish = 20;
    setHouseholdSettingValue("generation.styles.adult_only", "restricted");
    const response = await client.post("/api/plugins/image/actions/make", { prompt: "a picture of a boat" });
    expect(response.status).toBe(200);
    const made = await response.json() as { id: string; ids: string[]; ok: boolean; state: string };
    expect(made.ok).toBe(true);
    expect(made.id.length).toBeGreaterThan(0);
    expect(made.ids).toEqual([made.id]);
    expect(["queued", "running"]).toContain(made.state);
    const activity = await client.get("/api/jobs");
    const rows = await activity.json() as Array<{ id: string; kind: string; title: string }>;
    expect(rows.some((row) => row.id === `picture:${made.id}` && row.kind === "picture" && row.title.length > 0)).toBe(true);
  });
});
