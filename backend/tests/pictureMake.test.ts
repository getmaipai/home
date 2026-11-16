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
import { __setCarouselCompleterForTests } from "@/lib/pictures/carouselPlan";
import { readPictureMakeBody, makePictureFor, wordsFromPrompt } from "@/lib/pictures/make";
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

describe("wordsFromPrompt", () => {
  test("reads up to six short quoted phrases and leaves prompt wording intact", () => {
    expect(wordsFromPrompt('Poster: "Summer Fair", “June 8”')).toEqual(["Summer Fair", "June 8"]);
    expect(wordsFromPrompt(`"${"x".repeat(81)}" "ok"`)).toEqual(["ok"]);
    expect(wordsFromPrompt(Array.from({ length: 7 }, (_, i) => `"word ${i}"`).join(" "))).toHaveLength(6);
    expect(readPictureMakeBody({ prompt: 'Poster says "Summer Fair"' })).toMatchObject({ ok: true, body: { words: ["Summer Fair"] } });
  });
});
afterEach(() => { __setCarouselCompleterForTests(null); fake.restore(); __setStackClientForTests(null); __resetStackEngineForTests(); __setImageToolsForTests(undefined); __setRoleHealthForTests({}); __setPicturePollMsForTests(null); __resetPictureJobsForTests(); });

describe("Images Create make", () => {
  test("reads placeholders as empty and validates shape, count, presets, cast and reference limits", () => {
    expect(readPictureMakeBody({ prompt: "a boat", shape: "{shape}", count: "{count}", tier: "none", references: ["{reference}"] })).toMatchObject({ ok: true, body: { prompt: "a boat" } });
    expect(readPictureMakeBody({ prompt: "a boat", shape: "sideways" }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a boat", count: "9" }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a boat", references: ["a", "b", "c", "d"] }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a boat", template: "none" })).toEqual(readPictureMakeBody({ prompt: "a boat" }));
  });

  test("a cast id from the Create page's Cast slot reaches the make body, and an unfilled slot reads as empty", () => {
    expect(readPictureMakeBody({ prompt: "a boat", cast: "msub-abc" })).toMatchObject({ ok: true, body: { prompt: "a boat", cast: ["msub-abc"] } });
    const empty = readPictureMakeBody({ prompt: "a boat", cast: "{cast}" });
    expect(empty.ok && empty.body.cast).toBeFalsy();
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

  test("accepts comma-joined reference ids, merges references, and keeps three distinct pictures", () => {
    expect(readPictureMakeBody({ prompt: "a boat", reference: " file-one, none, {reference},file-two,file-one ", references: ["file-three", "file-two"] })).toMatchObject({ ok: true, body: { references: ["file-one", "file-two", "file-three"] } });
    expect(readPictureMakeBody({ prompt: "a boat", reference: "one,two,three,four" })).toMatchObject({ ok: false, error: "Choose up to 3 reference pictures, then try again." });
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

  test("CREATOR-16: set reads 2 to 8, treats 0 and a blank chip as none, and refuses the rest", () => {
    expect(readPictureMakeBody({ prompt: "a fox", set: 4 })).toMatchObject({ ok: true, body: { set: 4 } });
    expect(readPictureMakeBody({ prompt: "a fox", set: "6" })).toMatchObject({ ok: true, body: { set: 6 } });
    for (const none of [0, "0", "", "{set}"]) { const read = readPictureMakeBody({ prompt: "a fox", set: none }); expect(read.ok && read.body.set).toBeFalsy(); }
    expect(readPictureMakeBody({ prompt: "a fox", set: 1 }).ok).toBe(false);
    expect(readPictureMakeBody({ prompt: "a fox", set: 9 }).ok).toBe(false);
  });

  test("CREATOR-16: a set plans once, starts one job per scene on one seed and one model, and says one plain line", async () => {
    const look = "Soft watercolor, warm light.";
    let planned = 0;
    __setCarouselCompleterForTests(async () => { planned += 1; return { ok: true, text: JSON.stringify({ look, scenes: ["a fox at a gate", "a fox on a hill", "a fox by a stream"] }) }; });
    const read = readPictureMakeBody({ prompt: "a fox through one day", set: 3 });
    if (!read.ok) throw new Error(read.error);
    const made = await makePictureFor(owner, read.body);
    expect(made).toMatchObject({ ok: true, notice: "Making a set of 3 pictures." });
    if (!made.ok) return;
    expect(planned).toBe(1);
    expect(made.ids).toHaveLength(3);
    await until(() => fake.submitted.length === 3);
    const bodies = fake.submitted as Array<{ prompt: string; seed?: number; model?: string; n?: number }>;
    expect(bodies.every((body) => body.prompt.startsWith(look) && body.n === 1)).toBe(true);
    expect(new Set(bodies.map((body) => body.seed)).size).toBe(1);
    expect(typeof bodies[0]!.seed).toBe("number");
    expect(new Set(bodies.map((body) => body.model)).size).toBe(1);
    expect(new Set(bodies.map((body) => body.prompt)).size).toBe(3);
  });

  test("CREATOR-16: with the planner down nothing starts and the person gets one plain line", async () => {
    __setCarouselCompleterForTests(async () => ({ ok: false, unavailable: true }));
    const read = readPictureMakeBody({ prompt: "a fox through one day", set: 4 });
    if (!read.ok) throw new Error(read.error);
    const made = await makePictureFor(owner, read.body);
    expect(made).toMatchObject({ ok: false, error: "The planner is not available. Try again in a minute." });
    expect(fake.submitted).toHaveLength(0);
  });

  test("CREATOR-16: a refused theme stops the set before the planner runs", async () => {
    let planned = 0;
    __setCarouselCompleterForTests(async () => { planned += 1; return { ok: false, unavailable: true }; });
    const kid = person("person-setkid", "child");
    const read = readPictureMakeBody({ prompt: "a naked adult woman", set: 4 });
    if (!read.ok) throw new Error(read.error);
    const made = await makePictureFor(kid, read.body);
    expect(made.ok).toBe(false);
    expect(planned).toBe(0);
    expect(fake.submitted).toHaveLength(0);
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

describe("USE-AS-REFERENCE: how many reference pictures a call keeps", () => {
  test("the limit is the engine's own count, at least 1 and at most 3", async () => {
    const { pictureReferenceLimit, readyStatusForTests } = await import("@/lib/pictures/ready");
    const withRefs = (references: number | undefined) => readyStatusForTests({ edit: { generative: true, masked: true, ...(references === undefined ? {} : { references }) } });
    expect(pictureReferenceLimit(withRefs(3))).toBe(3);
    expect(pictureReferenceLimit(withRefs(1))).toBe(1);
    expect(pictureReferenceLimit(withRefs(2))).toBe(2);
    expect(pictureReferenceLimit(withRefs(7))).toBe(3);
    expect(pictureReferenceLimit(withRefs(0))).toBe(1);
    expect(pictureReferenceLimit(withRefs(undefined))).toBe(1);
    expect(pictureReferenceLimit(null)).toBe(1);
  });

  test("more references than the engine takes make one plain line, not a failure", async () => {
    const { __setPictureStatusForTests, readyStatusForTests } = await import("@/lib/pictures/ready");
    __setPictureStatusForTests(readyStatusForTests({ edit: { generative: true, masked: true, references: 1 } }));
    try {
      const refs = [file(owner, await png()), file(owner, await png()), file(owner, await png())];
      const read = readPictureMakeBody({ prompt: "a boat at sunset", references: refs.map((ref) => ref.id) });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const made = await makePictureFor(owner, read.body);
      expect(made.ok).toBe(true);
      if (made.ok) expect(made.notice).toBe("Some extra reference pictures were not used.");
    } finally { __setPictureStatusForTests(undefined); }
  });
});

describe("USE-AS-REFERENCE: the chat tool says how many references it takes", () => {
  test("generate_image offers references and says up to 3", async () => {
    const manifest = JSON.parse(await Bun.file(new URL("../packages/generate_image/manifest.json", import.meta.url)).text()) as { args: { properties: Record<string, { type: string; maxItems?: number; description?: string }> } };
    const references = manifest.args.properties.references;
    expect(references?.type).toBe("array");
    expect(references?.maxItems).toBe(3);
    expect(references?.description).toBe("references: ids of pictures to use as references, up to 3.");
  });
});
