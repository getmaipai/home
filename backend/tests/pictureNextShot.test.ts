// CREATOR-17 Next shot (still): the scene parser, the scene writer (words skip the model, the model down starts nothing), the operation's
// registration and gates, and a run against the fake picture engine that starts one new generate job with the source as the reference and as the parent.
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
import { recordCreation, creationOfFile } from "@/lib/creations/store";
import { __resetPictureJobsForTests, getPictureJob } from "@/lib/pictures/jobs";
import { NEXT_SHOT_NO_DESCRIPTION_LINE, NEXT_SHOT_STYLE_LINE, NEXT_SHOT_UNAVAILABLE_LINE, __setNextShotCompleterForTests, __setNextShotDescriberForTests, nextShotPrompt, parseNextShotScene, writeNextShotScene } from "@/lib/pictures/nextShot";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { resetDb } from "./reset-db";

const READY = { state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: { upscale_in: 6 }, operations: ["remove_background", "erase", "upscale", "resize"], reason: null } as never;
const ALL_AGES = 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a man on a street"}';
const ADULT_LOCKED = 'picture-gen:{"v":1,"audience":"adult-only","made_audience":"adult-only","lock":"on","prompt":"a boat"}';

let sage: TestClient; let sageActor: PersonRow; let fake: FakeImageStack;
function allowPhotos(personId: string) {
  db.insert(settingsValues).values({ scope: `person:${personId}`, key: "chat.photo_uploads", value: "true", hlc: "1:0:test", source: "self", setBy: personId, updatedAt: new Date().toISOString() }).run();
}
let shade = 10;
async function libraryPicture(owner: PersonRow, provenance = ALL_AGES) {
  shade += 20;
  const bytes = new Uint8Array(await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: shade, g: 120, b: 200 } } }).png().toBuffer());
  const stored = storeFile(owner, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance, retention: "kept", deduplicate: false });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value;
}
const run = (client: TestClient, body: Record<string, unknown>) => client.post("/api/media-ops/picture.next_shot", body);
const reply = (scene: string) => async () => ({ ok: true as const, text: JSON.stringify({ scene }) });

beforeEach(async () => {
  resetDb(); __resetImageEditForTests(); __resetPictureJobsForTests();
  __setImageToolsForTests(READY, true);
  __setRoleHealthForTests({ image: { availability: "ready", reason: null } });
  __setNextShotDescriberForTests(async () => null);
  fake = installFakeImageStack({ pollsToFinish: 1 });
  __setPictureStatusForTests(readyStatusForTests({ edit: { generative: true, masked: true, references: 2 } }));
  sage = new TestClient();
  const made = await sage.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  sageActor = db.select().from(people).where(eq(people.id, ((await made.json()) as { person: { id: string } }).person.id)).get()!;
  allowPhotos(sageActor.id);
});
afterEach(() => { fake.restore(); __setNextShotCompleterForTests(null); __setNextShotDescriberForTests(null); __setImageToolsForTests(undefined); __setRoleHealthForTests({}); __resetImageEditForTests(); });

describe("parseNextShotScene", () => {
  test("reads one scene, trims it and drops the closing full stop", () => {
    expect(parseNextShotScene('{"scene": "  The man walks away   down the street. "}')).toEqual({ ok: true, scene: "The man walks away down the street" });
    expect(parseNextShotScene('```json\n{"scene":"He turns the corner"}\n```')).toEqual({ ok: true, scene: "He turns the corner" });
  });
  test("refuses bad JSON, a wrong shape, an empty scene and a long one", () => {
    expect(parseNextShotScene("walks away").ok).toBe(false);
    expect(parseNextShotScene('{"look": "x"}').ok).toBe(false);
    expect(parseNextShotScene('{"scene": "  . "}')).toMatchObject({ ok: false, problem: "the scene is empty" });
    expect(parseNextShotScene(JSON.stringify({ scene: "x".repeat(301) })).ok).toBe(false);
  });
  test("the prompt is the scene plus the keep-the-look sentence", () => {
    expect(nextShotPrompt("He walks away.")).toBe(`He walks away. ${NEXT_SHOT_STYLE_LINE}`);
    expect(NEXT_SHOT_STYLE_LINE).toBe("Same people, same place, same lighting and style as the reference picture.");
  });
});

describe("writeNextShotScene", () => {
  test("the person's words are the scene and the model is never asked", async () => {
    let calls = 0;
    const result = await writeNextShotScene({ words: "he walks away.", description: "a man" }, async () => { calls += 1; return { ok: true, text: "{}" }; });
    expect(result).toEqual({ ok: true, scene: "he walks away" });
    expect(calls).toBe(0);
  });
  test("one repair try, then the scene", async () => {
    const seen: string[] = [];
    const replies = ["nonsense", '{"scene":"The man turns to look back"}'];
    const result = await writeNextShotScene({ description: "a man on a street" }, async (messages) => { seen.push(messages[0]!.content as string); return { ok: true, text: replies.shift()! }; });
    expect(result).toEqual({ ok: true, scene: "The man turns to look back" });
    expect(seen[1]).toContain("could not be used");
  });
  test("a model that is down gives the plain line; no description gives its own line", async () => {
    expect(await writeNextShotScene({ description: "a man" }, async () => ({ ok: false, unavailable: true }))).toEqual({ ok: false, line: NEXT_SHOT_UNAVAILABLE_LINE, unavailable: true });
    expect(NEXT_SHOT_UNAVAILABLE_LINE).toBe("The shot writer is not available. Try again in a minute.");
    expect(await writeNextShotScene({})).toMatchObject({ ok: false, line: NEXT_SHOT_NO_DESCRIPTION_LINE });
  });
});

describe("the next shot operation", () => {
  test("it is registered, kept out of the Studio rail and offered to chat", async () => {
    const ops = await listMediaOps(sageActor, { input: "picture" });
    expect(ops.find((op) => op.id === "picture.next_shot")).toMatchObject({ label: "Next shot", input: "picture", output: "picture", needs: "image", enabled: true });
    const file = await libraryPicture(sageActor);
    expect((await studioOperationRows(sageActor, { id: file.id })).find((row) => row.id === "picture.next_shot")).toBeUndefined();
    const schema = editPictureSpec("edit_picture", { editPictureAllowed: true, editPictureOps: ops, editPictureIds: [], actor: sageActor } as never)!;
    expect((schema.args.properties as { op: { enum: string[] } }).op.enum).toContain("picture.next_shot");
    expect(schema.description).toContain("picture.next_shot");
  });

  test("the model down gives the plain line and starts nothing", async () => {
    __setNextShotCompleterForTests(async () => ({ ok: false, unavailable: true }));
    const file = await libraryPicture(sageActor);
    recordCreation(sageActor, { kind: "picture", fileIds: [file.id], jobIds: [], recipe: { tool: "pictures", route: "text" }, words: { written: "a man on a street" } } as never);
    const res = await run(sage, { file_id: file.id, args: {} });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(NEXT_SHOT_UNAVAILABLE_LINE);
    expect(fake.submitted.length + fake.edits.length).toBe(0);
  });

  test("a locked source is refused with the locked line", async () => {
    const locked = await libraryPicture(sageActor, ADULT_LOCKED);
    const res = await run(sage, { file_id: locked.id, args: { words: "he walks away" } });
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ error: LIBRARY_PICTURE_LOCKED, code: "locked" });
    expect(fake.edits).toHaveLength(0);
  });

  test("someone else's picture is not found", async () => {
    const now = new Date().toISOString();
    db.insert(people).values({ id: "person-marlow1", displayName: "Marlow", role: "member", avatarSeed: "m", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
    const other = await libraryPicture(db.select().from(people).where(eq(people.id, "person-marlow1")).get()!);
    expect((await run(sage, { file_id: other.id, args: { words: "he walks away" } })).status).toBe(404);
    expect(fake.edits).toHaveLength(0);
  });

  test("with words, no model call: one generate job with the source as the reference and as the parent", async () => {
    let modelCalls = 0;
    __setNextShotCompleterForTests(async () => { modelCalls += 1; return { ok: true, text: "{}" }; });
    const source = await libraryPicture(sageActor);
    recordCreation(sageActor, { kind: "picture", fileIds: [source.id], jobIds: [], recipe: { tool: "pictures", route: "text" }, words: { written: "a man on a street" } } as never);
    const res = await run(sage, { file_id: source.id, args: { words: "he walks away down the street" } });
    expect(res.status).toBe(200);
    const started = (await res.json()) as { state: string; job: string; pictureJobId: string };
    expect(started.state).toBe("running");
    expect(modelCalls).toBe(0);
    await until(() => fake.edits.length === 1);
    expect(fake.edits).toHaveLength(1);
    expect(fake.edits[0]).toMatchObject({ operation: "edit", instruction: expect.stringContaining(`he walks away down the street. ${NEXT_SHOT_STYLE_LINE}`) });
    await until(() => getPictureJob(sageActor, started.job)?.state === "done");
    const job = getPictureJob(sageActor, started.job)!;
    expect(job.request.source_file_id).toBe(source.id);
    expect(job.files).toHaveLength(1);
    const made = creationOfFile(sageActor.id, job.files[0]!.id)!;
    expect(made.sources).toEqual([{ file_id: source.id, role: "reference" }]);
    expect(made.parent_id).toBe(creationOfFile(sageActor.id, source.id)!.id);
    // A new picture, not a version of the old one.
    expect(db.select().from(attachments).where(eq(attachments.id, job.files[0]!.id)).get()).toBeTruthy();
  });

  test("without words the model writes the scene from the stored words of the source", async () => {
    let asked = "";
    __setNextShotCompleterForTests(async (messages) => { asked = String(messages[1]!.content); return reply("The man walks away down the street")(); });
    const source = await libraryPicture(sageActor);
    recordCreation(sageActor, { kind: "picture", fileIds: [source.id], jobIds: [], recipe: { tool: "pictures", route: "text" }, words: { written: "a man on a street" } } as never);
    const res = await run(sage, { file_id: source.id, args: {} });
    expect(res.status).toBe(200);
    expect(asked).toContain("a man on a street");
    await until(() => fake.edits.length === 1);
    expect(String(fake.edits[0]!.instruction)).toContain(`The man walks away down the street. ${NEXT_SHOT_STYLE_LINE}`);
  });
});
