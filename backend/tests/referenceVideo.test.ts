// REFVIDEO-01: `make_reference_video`. Pictures become a reference sheet (a sheet the person attached is used as it is), the sheet shows on the video card, and one Max job
// asks the (fake) Stack's `POST /v1/videos/ingredients` for the clip. The Stack lane is not deployed when this was written: every Stack answer here is a fixture.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { purgeFileRecord, storeFile } from "@/lib/attachments";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { companionsOf } from "@/lib/libraryTrash";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setRolesVisionForTests } from "@/lib/pictures/roles";
import { getVideoJobFor, type VideoJob } from "@/lib/videos/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __setVideosFetchForTests, StackVideoError, submitVideoIngredients } from "@/lib/videos/stack";
import { INGREDIENTS_FAILURE_COPY } from "@/lib/failureCopy";
import { phaseLabel } from "@/lib/videos/phaseLabel";
import { __setSheetVisionForTests, checkPictureIsSheet, describeProvidedSheet, fitToSheetSize, parseSheetCheck } from "@/lib/videos/referenceSheetCheck";
import {
  FULL_FRAME_SENTENCE, MAKE_REFERENCE_VIDEO_TOOL_ID, REFERENCE_ADAPTER_LINE, REFERENCE_BUSY_LINE, REFERENCE_MINOR_LINE, REFERENCE_NO_PICTURES_LINE, REFERENCE_NO_SHEET_LINE, REFERENCE_PROMPT_MAX, REFERENCE_SHEET_FAILED_LINE,
  __setParagraphWriterForTests, __setSheetCheckerForTests, __setSheetMakerForTests, anotherReferenceTake, composePrompt, conversationHasReferenceVideo, generatedParagraph, getReferenceVideoRecipe, makeReferenceVideoArgs, runMakeReferenceVideoTurn,
} from "@/lib/videos/referenceVideo";
import { videoCardView } from "@/routes/videos";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";
import type { MadeSheet } from "@/lib/videos/referenceVideo";

const SAFE = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() } as never;
let fake: FakeVideoStack;
let ingredients: Array<{ sheets: Array<{ width: number; height: number; type: string }>; fields: Record<string, string> }>;
let ingredientRefusal: { status: number; code: string; error: string } | null;
let makerCalls: number;
let actor: PersonRow;

const png = (color: string, width = 64, height = 64) => sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer().then((b) => new Uint8Array(b));
const SHEET_PNG = () => png("#f4f4f4", 768, 448);

function person(role: string, name = role): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${name}ref`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}

/** A chat turn with n pictures attached (stored like an upload in this conversation). */
async function chatWithPictures(who: PersonRow, count: number, conversationId?: string): Promise<TurnState> {
  const conv = resolveOrCreateConversation(who, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(who, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "make_reference_video", routing: { tier: "tool", score: 1 }, safety: SAFE, conversation_id: conv.value.id, turn_id: turnId } as never);
  const images: Array<{ id: string; name: string; width: number; height: number; media_type: string }> = [];
  const colors = ["#aa3322", "#2233aa", "#33aa22", "#aaaa22", "#22aaaa", "#aa22aa", "#555555"];
  for (let i = 0; i < count; i++) {
    const saved = storeFile(who, { conversationId: conv.value.id, turnId, mediaType: "image/png", bytes: await png(colors[i]!), provenance: "upload", retention: "kept", name: `p${i}.png`, deduplicate: false });
    if (!saved.ok) throw new Error(saved.error);
    images.push({ id: saved.value.id, name: `p${i}.png`, width: 64, height: 64, media_type: "image/png" });
  }
  return { actor: who, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false, images } as unknown as TurnState;
}

const run = (state: TurnState, args: Record<string, unknown>) => runMakeReferenceVideoTurn({ state, args, callId: "ref", spoken: false });
const refusedWhy = (outcome: Awaited<ReturnType<typeof run>>) => (outcome.result?.data as { refused?: string } | undefined)?.refused;
const replyOf = (outcome: Awaited<ReturnType<typeof run>>) => outcome.result?.reply?.text ?? "";
async function finished(who: PersonRow, outcome: Awaited<ReturnType<typeof run>>): Promise<VideoJob> {
  const id = (outcome.result?.data as { videoJobId?: string }).videoJobId;
  if (!id) throw new Error(`no job: ${replyOf(outcome)}`);
  await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(who, id)?.state ?? ""));
  return getVideoJobFor(who, id)!;
}
const ROLE_ANSWERS = [
  { role: "actor", name: "girl in a red jacket", look: "young girl, red jacket, brown hair", medium: "photograph" },
  { role: "prop", name: "stack of cards", look: "playing cards with blue backs", medium: "photograph" },
  { role: "end_shot", name: "stone building", look: "grey stone building with tall windows", medium: "photograph" },
];
function fakeMaker() {
  __setSheetMakerForTests(async (pictures): Promise<MadeSheet> => {
    makerCalls += 1;
    return {
      png: await SHEET_PNG(), description: `Reference sheet: ${pictures.map((picture, index) => `${["Top Left", "Top Right", "Far Right"][index] ?? "Far Right"} (${picture.role === "actor" ? "Character" : "Prop"}, Front View): ${picture.look}`).join(" ")}`,
      panels: pictures.map((picture, index) => ({ name: picture.name, view: "Front View", slot: ["Top Left", "Top Right", "Far Right"][index] ?? "Far Right" })),
    };
  });
}
const notSheet = async () => ({ isSheet: false, panels: [] });

beforeEach(() => {
  resetDb();
  fake = installFakeVideoStack();
  fake.ltx25max = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25max: "ready" }));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  ingredients = []; ingredientRefusal = null; makerCalls = 0;
  actor = person("owner");
  fakeMaker();
  __setSheetCheckerForTests(notSheet);
  __setParagraphWriterForTests(async (request) => `The woman from the Top Left panel does this: ${request}`);
  let n = 0; __setRolesVisionForTests(async () => JSON.stringify(ROLE_ANSWERS[n++ % ROLE_ANSWERS.length]));
  const base = fake.handler;
  __setVideosFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if ((init?.method ?? "GET").toUpperCase() === "POST" && url.pathname === "/v1/videos/ingredients") {
      const form = init?.body as FormData;
      const sheets = await Promise.all(form.getAll("sheet").map(async (part) => { const blob = part as Blob; const meta = await sharp(Buffer.from(await blob.arrayBuffer())).metadata(); return { width: meta.width ?? 0, height: meta.height ?? 0, type: blob.type }; }));
      const fields: Record<string, string> = {};
      for (const [key, value] of form.entries()) if (typeof value === "string") fields[key] = value;
      ingredients.push({ sheets, fields });
      if (ingredientRefusal) return new Response(JSON.stringify({ error: ingredientRefusal.error, code: ingredientRefusal.code }), { status: ingredientRefusal.status, headers: { "content-type": "application/json" } });
      const job = { id: `vjob-${fake.jobs.length + 1}`, body: fields, polls: 0, state: "queued", deleted: false };
      fake.jobs.push(job as never);
      return new Response(JSON.stringify({ created: 1, job: job.id, data: [] }), { status: 202, headers: { "content-type": "application/json" } });
    }
    // The real Stack answers an adult job's status without its result unless the call carries the full-view header (ADULT-LOCK-04): the ingredients
    // job is sent as adult, so a read-back that forgets the header sees a finished job with no clip (seen live 2026-11-12, "could not be read back").
    const response = await base(input as never, init);
    const isStatus = (init?.method ?? "GET").toUpperCase() === "GET" && /^\/v1\/videos\/generations\/[^/]+$/.test(url.pathname);
    if (isStatus && ingredients.length > 0 && !new Headers(init?.headers).get("x-maipai-view")) {
      const body = await response.clone().json().catch(() => null) as { data?: unknown[] } | null;
      if (body && Array.isArray(body.data)) return new Response(JSON.stringify({ ...body, data: [] }), { status: response.status, headers: { "content-type": "application/json" } });
    }
    return response;
  }) as unknown as typeof fetch);
});
afterEach(async () => {
  fake.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); __setRolesVisionForTests(null); __setSheetVisionForTests(null);
  __setSheetMakerForTests(null); __setSheetCheckerForTests(null); __setParagraphWriterForTests(null);
  await new Promise((resolve) => setTimeout(resolve, 50));
});

describe("the package and its arguments", () => {
  test("the manifest declares an adult conditional tool with its own gate", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../packages/make_reference_video/manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ id: MAKE_REFERENCE_VIDEO_TOOL_ID, kind: "plugin", min_role: "adult", offer: { mode: "conditional", gate: "referenceVideoAllowed", bench_row: "make-reference-video-tool" } });
    expect(Object.keys(manifest.args.properties)).toEqual(["request", "seconds", "reuse_video"]);
    expect(manifest.routing.examples.length).toBeGreaterThanOrEqual(4);
  });
  test("arguments: seconds 4 to 8, words up to 2000 characters", () => {
    expect(makeReferenceVideoArgs.safeParse({ request: "the girl plays", seconds: 8 }).success).toBe(true);
    expect(makeReferenceVideoArgs.safeParse({ request: "the girl plays", seconds: 9 }).success).toBe(false);
    expect(makeReferenceVideoArgs.safeParse({ request: "the girl plays", seconds: 3 }).success).toBe(false);
    expect(makeReferenceVideoArgs.safeParse({ request: "x".repeat(2001) }).success).toBe(false);
    expect(makeReferenceVideoArgs.safeParse({ reuse_video: "latest", request: "make her walk away" }).success).toBe(true);
  });
  test("bad arguments fail the call without starting anything", async () => {
    const outcome = await run(await chatWithPictures(actor, 1), { seconds: 40 });
    expect(outcome.status).toBe("failed");
    expect(ingredients).toHaveLength(0);
  });
});

describe("refusals come as one plain line before any work", () => {
  test("no pictures attached", async () => {
    const outcome = await run(await chatWithPictures(actor, 0), { request: "the girl plays" });
    expect(refusedWhy(outcome)).toBe("no_pictures");
    expect(replyOf(outcome)).toContain(REFERENCE_NO_PICTURES_LINE);
  });
  test("a child or a teen", async () => {
    for (const role of ["child", "teen"]) {
      const kid = person(role);
      const outcome = await run(await chatWithPictures(kid, 1), { request: "the girl plays" });
      expect(refusedWhy(outcome)).toBe("minor");
      expect(replyOf(outcome)).toContain(REFERENCE_MINOR_LINE);
    }
    expect(makerCalls).toBe(0);
  });
  test("Max not ready", async () => {
    __setVideoStatusForTests(readyVideoStatusForTests());
    const outcome = await run(await chatWithPictures(actor, 1), { request: "the girl plays" });
    expect(refusedWhy(outcome)).toBe("max_not_ready");
    expect(replyOf(outcome)).toMatch(/Max is not (ready|installed)/);
    expect(makerCalls).toBe(0);
  });
  test("the adapter missing, when the Stack reports it", async () => {
    const status = readyVideoStatusForTests({ ltx25max: "ready" });
    (status.qualities!.ltx25max as { ingredients?: boolean }).ingredients = false;
    __setVideoStatusForTests(status);
    const outcome = await run(await chatWithPictures(actor, 1), { request: "the girl plays" });
    expect(refusedWhy(outcome)).toBe("adapter_missing");
    expect(replyOf(outcome)).toContain(REFERENCE_ADAPTER_LINE);
    expect(makerCalls).toBe(0);
  });
  test("a video already being made", async () => {
    fake.pollsToFinish = 1000;
    const first = await run(await chatWithPictures(actor, 1), { request: "the girl plays" });
    expect((first.result?.data as { videoJobId?: string }).videoJobId).toBeTruthy();
    const second = await run(await chatWithPictures(actor, 1), { request: "the girl plays again" });
    expect(refusedWhy(second)).toBe("already_making");
    expect(replyOf(second)).toContain(REFERENCE_BUSY_LINE);
    expect(makerCalls).toBe(1);
  });
  test("a words-only call with no pictures and nothing to reuse", async () => {
    const outcome = await run(await chatWithPictures(actor, 0), { request: "make her walk away", reuse_video: "latest" });
    expect(refusedWhy(outcome)).toBe("no_sheet");
    expect(replyOf(outcome)).toContain(REFERENCE_NO_SHEET_LINE);
  });
  test("a refused prompt never reaches the sheet maker", async () => {
    const outcome = await run(await chatWithPictures(actor, 1), { request: "a child porn scene" });
    expect(outcome.result?.data).toHaveProperty("refused");
    expect(makerCalls).toBe(0);
    expect(ingredients).toHaveLength(0);
  });
});

describe("the happy path", () => {
  test("pictures become a stored sheet, the Stack gets the multipart, and the clip is made and readable", async () => {
    const state = await chatWithPictures(actor, 3);
    const outcome = await run(state, { request: "the girl plays in a pile of these cards in front of this building" });
    expect(outcome.status).toBe("succeeded");
    const data = outcome.result?.data as { videoJobId: string; sheetFileIds: string[] };
    expect(data.sheetFileIds).toHaveLength(1);
    // The reply tells the model the sheet is shown, the clip is on its way, and not to describe it.
    expect(replyOf(outcome)).toMatch(/shown on the video card/);
    expect(replyOf(outcome)).toMatch(/about three minutes/);
    expect(replyOf(outcome)).toMatch(/do not describe/);
    // The sheet is a kept file of the person.
    const row = db.select().from(attachments).where(eq(attachments.id, data.sheetFileIds[0]!)).get()!;
    expect(row.retention).toBe("kept");
    expect(row.ownerPersonId).toBe(actor.id);
    expect(row.mediaType).toBe("image/png");
    // The job is a Max "making from the sheet" job with its recipe saved.
    const running = getVideoJobFor(actor, data.videoJobId)!;
    expect(running.request.reference?.sheetFileIds).toEqual(data.sheetFileIds);
    expect(running.request.edit?.change).toBe("ingredients");
    expect(phaseLabel({ ...running, phase: "making from the sheet", state: "running" }, "adult")).toBe("Making your video from the sheet");
    const job = await finished(actor, outcome);
    expect(job.state).toBe("done");
    expect(job.files[0]).toBeTruthy();
    // The multipart the Stack received: one 768x448 PNG sheet and the full prompt.
    expect(ingredients).toHaveLength(1);
    expect(ingredients[0]!.sheets).toEqual([{ width: 768, height: 448, type: "image/png" }]);
    const fields = ingredients[0]!.fields;
    expect(fields.seconds).toBe("8");
    expect(fields.audience).toBe("adult");
    expect(Number(fields.seed)).toBeGreaterThan(0);
    expect(fields.prompt!.startsWith("Reference sheet: Top Left (Character, Front View): young girl, red jacket, brown hair")).toBe(true);
    expect(fields.prompt!).toContain("\n\nGenerated video: The woman from the Top Left panel does this: the girl plays in a pile of these cards in front of this building.");
    expect(fields.prompt!).toContain(FULL_FRAME_SENTENCE);
    expect(fields.prompt!.length).toBeLessThanOrEqual(REFERENCE_PROMPT_MAX);
    // The card carries the sheet address, so the chat shows it while the clip renders and afterwards.
    const card = videoCardView(actor, job, true);
    expect(card.items.at(-1)?.sheets).toEqual([`/api/files/${data.sheetFileIds[0]}/content`]);
    expect(card.items.at(-1)?.clip?.file_id).toBe(job.files[0]!.id);
    expect(conversationHasReferenceVideo(actor, state.conversationId!)).toBe(true);
  });
  test("the recipe keeps the sheets, words, seed, panels and the pictures each panel came from", async () => {
    const state = await chatWithPictures(actor, 3);
    const job = await finished(actor, await run(state, { request: "the girl plays" }));
    const recipe = getReferenceVideoRecipe(actor, job.id)!;
    expect(recipe).toMatchObject({ v: 1, seconds: 8, providedAsIs: [false] });
    expect(recipe.sheetFileIds).toHaveLength(1);
    expect(recipe.request).toContain("the girl plays");
    expect(recipe.prompt).toContain("Generated video: ");
    expect(recipe.seed).toBe(Number(ingredients[0]!.fields.seed));
    expect(recipe.pictureFileIds).toEqual(state.images!.map((image) => image.id));
    expect(recipe.panels.map((panel) => ({ name: panel.name, slot: panel.slot, sheet: panel.sheet }))).toEqual([{ name: "girl in a red jacket", slot: "Top Left", sheet: 0 }, { name: "stack of cards", slot: "Top Right", sheet: 0 }, { name: "stone building", slot: "Far Right", sheet: 0 }]);
    expect(recipe.panels[0]!.pictures).toEqual([state.images![0]!.id]);
    // Another person never reads it.
    expect(getReferenceVideoRecipe(person("owner", "other"), job.id)).toBeNull();
  });
  test("pictures are capped at six", async () => {
    const state = await chatWithPictures(actor, 7);
    let seen = 0; __setSheetMakerForTests(async (pictures) => { seen = pictures.length; return { png: await SHEET_PNG(), description: "Reference sheet: Top Left (Character, Front View): x.", panels: [{ name: pictures[0]!.name, view: "Front View", slot: "Top Left" }] }; });
    await run(state, { request: "everyone waves" });
    expect(seen).toBe(6);
  });
  test("when the person's words cannot be rewritten, their own words are used and the full-frame line is still there", async () => {
    __setParagraphWriterForTests(async () => null);
    const paragraph = await generatedParagraph("the girl   plays\nwith the cards", "Reference sheet: Top Left (Character, Front View): x.");
    expect(paragraph).toBe(`the girl plays with the cards. ${FULL_FRAME_SENTENCE}`);
    expect(await generatedParagraph("it rains", "x")).toContain(FULL_FRAME_SENTENCE);
  });
  test("a long sheet text is cut at a panel boundary; the paragraph stays whole", () => {
    const description = `Reference sheet: ${Array.from({ length: 30 }, (_, i) => `Panel ${i} (Prop, Front View): ${"detail ".repeat(12).trim()}.`).join(" ")}`;
    const paragraph = `The woman walks. ${FULL_FRAME_SENTENCE}`;
    const prompt = composePrompt(description, paragraph);
    expect(prompt.length).toBeLessThanOrEqual(REFERENCE_PROMPT_MAX);
    expect(prompt.endsWith(`\n\nGenerated video: ${paragraph}`)).toBe(true);
  });
});

describe("failures are plain, never a crash", () => {
  test("a sheet step that fails gives the plain refusal and starts nothing", async () => {
    __setSheetMakerForTests(async () => { throw new Error("remove_background exploded"); });
    const outcome = await run(await chatWithPictures(actor, 2), { request: "the girl plays" });
    expect(outcome.status).toBe("succeeded");
    expect(refusedWhy(outcome)).toBe("sheet_failed");
    expect(replyOf(outcome)).toContain(REFERENCE_SHEET_FAILED_LINE);
    expect(ingredients).toHaveLength(0);
    expect(db.select().from(attachments).where(eq(attachments.provenance, "reference-sheet:")).all()).toHaveLength(0);
  });
  test("pictures the vision model cannot read give its plain line", async () => {
    __setRolesVisionForTests(async () => "not json");
    const outcome = await run(await chatWithPictures(actor, 1), { request: "the girl plays" });
    expect(refusedWhy(outcome)).toBe("sheet_failed");
    expect(replyOf(outcome)).toContain("couldn't look at your pictures");
  });
  test("a missing adapter at the Stack (409) becomes a plain sentence on the card", async () => {
    ingredientRefusal = { status: 409, code: "ic_lora_missing", error: "ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors not found in /models" };
    const job = await finished(actor, await run(await chatWithPictures(actor, 1), { request: "the girl plays" }));
    expect(job.state).toBe("failed");
    expect(job.error).toContain(INGREDIENTS_FAILURE_COPY.ic_lora_missing);
    expect(job.error).not.toContain(".safetensors");
  });
  test("a bad-sheet 400 keeps the Stack's plain sentence; an unknown code gets a stable one", async () => {
    ingredientRefusal = { status: 400, code: "bad_sheet", error: "Each reference sheet must be 768 by 448 pixels. Make the sheet again." };
    await expect(submitVideoIngredients(new FormData())).rejects.toMatchObject({ status: 400, code: "bad_sheet", message: "Each reference sheet must be 768 by 448 pixels. Make the sheet again." });
    ingredientRefusal = { status: 500, code: "boom", error: "Traceback (most recent call last)" };
    const error = await submitVideoIngredients(new FormData()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StackVideoError);
    expect((error as Error).message).toBe("The video could not be made from those pictures. Try again, or use different pictures.");
  });
  test("a job the Stack fails with a known code says it plainly", async () => {
    fake.failWith = { error: "raw failure text", code: "no_memory" } as never;
    const job = await finished(actor, await run(await chatWithPictures(actor, 1), { request: "the girl plays" }));
    expect(job.state).toBe("failed");
    expect(job.error).toContain(INGREDIENTS_FAILURE_COPY.no_memory);
  });
});

describe("a picture that is already a reference sheet", () => {
  const SHEET_JSON = JSON.stringify({ is_sheet: true, panels: [
    { position: "Top Left", kind: "Character", view: "Front View", look: "a young woman in a red jacket" },
    { position: "Top Right", kind: "Character", view: "Side View", look: "the same woman seen from the side" },
    { position: "Far Right", kind: "Setting", view: "Setting", look: "a grey stone building" },
  ] });
  const PHOTO_JSON = JSON.stringify({ is_sheet: false, panels: [] });

  test("the check: a sheet needs is_sheet and at least two panels; a plain photo is not mistaken for one", async () => {
    __setSheetVisionForTests(async () => SHEET_JSON);
    expect((await checkPictureIsSheet(await png("#fff", 400, 300))).isSheet).toBe(true);
    __setSheetVisionForTests(async () => PHOTO_JSON);
    expect((await checkPictureIsSheet(await png("#fff"))).isSheet).toBe(false);
    __setSheetVisionForTests(async () => JSON.stringify({ is_sheet: true, panels: [{ position: "Top Left", kind: "Character", view: "Front View", look: "one woman" }] }));
    expect((await checkPictureIsSheet(await png("#fff"))).isSheet).toBe(false);
    __setSheetVisionForTests(async () => "not json at all");
    expect((await checkPictureIsSheet(await png("#fff"))).isSheet).toBe(false);
    __setSheetVisionForTests(async () => { throw new Error("vision is down"); });
    expect((await checkPictureIsSheet(await png("#fff"))).isSheet).toBe(false);
    expect(parseSheetCheck('{"is_sheet":true,"panels":[{"position":"A","kind":"Thing","view":"v","look":"l"}]}')?.panels).toEqual([]);
  });
  test("a provided sheet is fitted to 768x448 without cropping and described in the sheet maker's format", async () => {
    const wide = await png("#ffffff", 1200, 400);
    const fitted = await fitToSheetSize(wide);
    const meta = await sharp(Buffer.from(fitted)).metadata();
    expect([meta.width, meta.height]).toEqual([768, 448]);
    // The padding takes the corner colour of the picture itself.
    const coloured = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#204060" } }).png().toBuffer();
    const { data } = await sharp(Buffer.from(await fitToSheetSize(new Uint8Array(coloured)))).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([0x20, 0x40, 0x60]);
    expect(describeProvidedSheet(parseSheetCheck(SHEET_JSON)!.panels)).toBe("Reference sheet: Top Left (Character, Front View): a young woman in a red jacket Top Right (Character, Side View): the same woman seen from the side Far Right (Setting, Setting): a grey stone building");
  });
  test("one attached sheet is used as it is: no sheet maker, no roles, the panels become the description", async () => {
    __setSheetCheckerForTests(null);
    __setSheetVisionForTests(async () => SHEET_JSON);
    __setRolesVisionForTests(async () => { throw new Error("roles must not be asked"); });
    const outcome = await run(await chatWithPictures(actor, 1), { request: "she walks along the building" });
    const job = await finished(actor, outcome);
    expect(job.state).toBe("done");
    expect(makerCalls).toBe(0);
    expect(replyOf(outcome)).toContain("already a reference sheet, so it was used as provided");
    expect(ingredients[0]!.sheets).toEqual([{ width: 768, height: 448, type: "image/png" }]);
    expect(ingredients[0]!.fields.prompt!.startsWith("Reference sheet: Top Left (Character, Front View): a young woman in a red jacket Top Right (Character, Side View)")).toBe(true);
    expect(getReferenceVideoRecipe(actor, job.id)).toMatchObject({ providedAsIs: [true] });
  });
  test("a plain photo goes through the sheet maker, not as a sheet", async () => {
    __setSheetCheckerForTests(null);
    __setSheetVisionForTests(async () => PHOTO_JSON);
    await finished(actor, await run(await chatWithPictures(actor, 1), { request: "she walks" }));
    expect(makerCalls).toBe(1);
  });
  test("a sheet plus loose photos makes two sheets: the provided one and one built from the rest", async () => {
    const state = await chatWithPictures(actor, 3);
    // The first picture (the red one) is already a sheet; the other two are loose photos.
    __setSheetCheckerForTests(async (bytes) => {
      const { data } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true });
      return data[0] === 0xaa && data[1] === 0x33 && data[2] === 0x22 ? { isSheet: true, panels: parseSheetCheck(SHEET_JSON)!.panels } : { isSheet: false, panels: [] };
    });
    const outcome = await run(state, { request: "everyone meets at the building" });
    const job = await finished(actor, outcome);
    expect(job.state).toBe("done");
    expect(makerCalls).toBe(1);
    expect(ingredients[0]!.sheets).toEqual([{ width: 768, height: 448, type: "image/png" }, { width: 768, height: 448, type: "image/png" }]);
    const recipe = getReferenceVideoRecipe(actor, job.id)!;
    expect(recipe.sheetFileIds).toHaveLength(2);
    expect(recipe.providedAsIs).toEqual([true, false]);
    expect(recipe.description).toContain("Second reference sheet:");
    expect(recipe.panels.filter((panel) => panel.sheet === 1).every((panel) => panel.pictures.every((id) => id !== state.images![0]!.id))).toBe(true);
  });
  test("two sheets already attached leave no room for a third: the loose photos are left out and the person is told", async () => {
    __setSheetCheckerForTests(async (bytes) => {
      const { data } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true });
      return data[0] === 0x55 ? { isSheet: false, panels: [] } : { isSheet: true, panels: parseSheetCheck(SHEET_JSON)!.panels };
    });
    const state = await chatWithPictures(actor, 3);
    // Pictures 0, 1 and 2 are all "sheets" (none is the grey one), so only the first two are used.
    const outcome = await run(state, { request: "she walks" });
    await finished(actor, outcome);
    expect(makerCalls).toBe(0);
    expect(ingredients[0]!.sheets).toHaveLength(2);
  });
  test("when the vision check fails the pictures are built into a sheet instead", async () => {
    __setSheetCheckerForTests(async () => { throw new Error("the check crashed"); });
    const job = await finished(actor, await run(await chatWithPictures(actor, 2), { request: "she walks" }));
    expect(job.state).toBe("done");
    expect(makerCalls).toBe(1);
  });
});

describe("the sheet stays with the video: Another take and an edit of the words", () => {
  test("Another take reuses the saved sheets and prompt with a new seed and never calls the sheet maker", async () => {
    const first = await finished(actor, await run(await chatWithPictures(actor, 3), { request: "the girl plays" }));
    expect(makerCalls).toBe(1);
    const again = anotherReferenceTake(actor, first);
    if (!again.ok) throw new Error(again.line);
    await until(() => ["done", "failed"].includes(getVideoJobFor(actor, again.job.id)?.state ?? ""));
    expect(makerCalls).toBe(1);
    expect(ingredients).toHaveLength(2);
    expect(ingredients[1]!.fields.prompt!).toBe(ingredients[0]!.fields.prompt!);
    expect(ingredients[1]!.fields.seed).not.toBe(ingredients[0]!.fields.seed);
    expect(getReferenceVideoRecipe(actor, again.job.id)!.sheetFileIds).toEqual(getReferenceVideoRecipe(actor, first.id)!.sheetFileIds);
    expect(getVideoJobFor(actor, again.job.id)!.state).toBe("done");
  });
  test("Another take while a video is being made says so", async () => {
    const first = await finished(actor, await run(await chatWithPictures(actor, 1), { request: "the girl plays" }));
    fake.pollsToFinish = 1000;
    const one = anotherReferenceTake(actor, first);
    expect(one.ok).toBe(true);
    const two = anotherReferenceTake(actor, first);
    expect(two).toMatchObject({ ok: false, status: 409, line: REFERENCE_BUSY_LINE });
  });
  test("new words re-render from the same sheets: reuse_video with a request, no pictures attached", async () => {
    const state = await chatWithPictures(actor, 3);
    const first = await finished(actor, await run(state, { request: "the girl plays" }));
    const followUp = await chatWithPictures(actor, 0, state.conversationId!);
    const outcome = await run(followUp, { reuse_video: "latest", request: "make her walk away" });
    const second = await finished(actor, outcome);
    expect(second.state).toBe("done");
    expect(makerCalls).toBe(1);
    expect(replyOf(outcome)).toContain("same reference sheet is used again");
    const recipe = getReferenceVideoRecipe(actor, second.id)!;
    expect(recipe.sheetFileIds).toEqual(getReferenceVideoRecipe(actor, first.id)!.sheetFileIds);
    expect(recipe.description).toBe(getReferenceVideoRecipe(actor, first.id)!.description);
    expect(recipe.request).toContain("make her walk away");
    expect(ingredients[1]!.fields.prompt!).toContain("make her walk away");
    expect(ingredients[1]!.fields.prompt!.startsWith(recipe.description)).toBe(true);
    expect(ingredients[1]!.sheets).toEqual(ingredients[0]!.sheets);
    // And by the first video's id; another person's call cannot reach it.
    const byId = await run(await chatWithPictures(actor, 0, state.conversationId!), { reuse_video: first.id });
    expect((byId.result?.data as { videoJobId?: string }).videoJobId).toBeTruthy();
    await finished(actor, byId);
    const other = await run(await chatWithPictures(person("owner", "second"), 0), { reuse_video: first.id, request: "elsewhere" });
    expect(refusedWhy(other)).toBe("no_sheet");
  });
  test("a sheet the person deleted is a plain refusal, not a crash", async () => {
    const state = await chatWithPictures(actor, 1);
    const first = await finished(actor, await run(state, { request: "the girl plays" }));
    const [sheetId] = getReferenceVideoRecipe(actor, first.id)!.sheetFileIds;
    const gone = db.select().from(attachments).where(eq(attachments.id, sheetId!)).get()!;
    purgeFileRecord(gone);
    const outcome = await run(await chatWithPictures(actor, 0, state.conversationId!), { reuse_video: "latest", request: "again" });
    expect(refusedWhy(outcome)).toBe("no_sheet");
    expect(anotherReferenceTake(actor, first)).toMatchObject({ ok: false, line: REFERENCE_NO_SHEET_LINE });
  });
});

describe("cleaning up: a sheet goes with its video only when no other video uses it", () => {
  test("a shared sheet stays in the family of neither clip until the other video is gone", async () => {
    const state = await chatWithPictures(actor, 1);
    const first = await finished(actor, await run(state, { request: "the girl plays" }));
    const again = anotherReferenceTake(actor, first);
    if (!again.ok) throw new Error(again.line);
    await until(() => getVideoJobFor(actor, again.job.id)?.state === "done");
    const second = getVideoJobFor(actor, again.job.id)!;
    const [sheetId] = getReferenceVideoRecipe(actor, first.id)!.sheetFileIds;
    const clip = (job: VideoJob) => db.select().from(attachments).where(eq(attachments.id, job.files[0]!.id)).get()!;
    const family = (job: VideoJob) => companionsOf(clip(job)).map((row) => row.id);
    // Both clips use the sheet: neither takes it along.
    expect(family(first)).not.toContain(sheetId!);
    expect(family(second)).not.toContain(sheetId!);
    // The first clip leaves (deleted): the second now owns the sheet's lifetime.
    db.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, first.files[0]!.id)).run();
    expect(family(second)).toContain(sheetId!);
  });
  test("a video's own sheet travels with its clip", async () => {
    const job = await finished(actor, await run(await chatWithPictures(actor, 1), { request: "the girl plays" }));
    const [sheetId] = getReferenceVideoRecipe(actor, job.id)!.sheetFileIds;
    const clip = db.select().from(attachments).where(eq(attachments.id, job.files[0]!.id)).get()!;
    expect(companionsOf(clip).map((row) => row.id)).toContain(sheetId!);
  });
});

describe("the offer gate", () => {
  test("offered to an adult on a written chat with pictures attached (or an earlier reference video), never otherwise", async () => {
    const { budgetWithTurnToolGates, __resetToolGateLatchForTests } = await import("@/lib/turnMachine/toolGates");
    const { resolveTurnBudgetBase } = await import("@/lib/turnMachine/budget");
    __resetToolGateLatchForTests();
    const base = { budget: resolveTurnBudgetBase(undefined, "adult"), actor, band: "adult" as const, surface: "chat" as const, surfaceClass: "written" as const, spoken: false, temporary: false, bare: false, ephemeral: false, text: "make a video", musicEditAvailable: () => false };
    const offered = async (input: Record<string, unknown>) => (await budgetWithTurnToolGates({ ...base, ...input } as never)).budget.tools_offered;
    expect(await offered({})).not.toContain(MAKE_REFERENCE_VIDEO_TOOL_ID);
    expect(await offered({ imageCount: 2 })).toContain(MAKE_REFERENCE_VIDEO_TOOL_ID);
    expect(await offered({ imageCount: 2 })).toContain("make_film");
    expect(await offered({ referenceVideoAvailable: () => true })).toContain(MAKE_REFERENCE_VIDEO_TOOL_ID);
    for (const input of [{ actor: person("child"), band: "child" as const }, { actor: person("teen"), band: "teen" as const }, { spoken: true, surfaceClass: "spoken" as const }, { bare: true }, { surface: "tv" as const }])
      expect(await offered({ imageCount: 2, ...input })).not.toContain(MAKE_REFERENCE_VIDEO_TOOL_ID);
  });
  test("policy refuses a forged call when this turn did not offer it", async () => {
    const { policyNode } = await import("@/lib/turnMachine/nodes/policy");
    const state = { actor, surface: "chat", planBasis: { surfaceClass: "written" }, plan: { surfaceClass: "written" }, context: [], crisis: false, temporary: false, utterance: "x", referenceVideoAllowed: false } as unknown as TurnState;
    const result = await policyNode(state, { calls: [{ id: "c", tool: MAKE_REFERENCE_VIDEO_TOOL_ID, args: { request: "x y z" } }] }, new AbortController().signal);
    expect(result.output.entries[0]?.decision).toMatchObject({ allow: false });
  });
});
