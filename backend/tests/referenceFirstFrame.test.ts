// REFVIDEO-FIRSTFRAME-01: the first-picture route of `make_reference_video` (pictures that hold a real person's face). The face models, the cut-out tool, the Stack's picture edit and
// the Stack's video engine are all fakes: a picture's colour stands for a face (the fake face finder reads two pixels and gives each non-white, non-"bad" colour one face whose vector is
// that colour), so the face gate, the paste fallback and the clip measurement can be driven exactly. No real generation runs here.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { storeFile } from "@/lib/attachments";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setRolesVisionForTests, readPictureRoles } from "@/lib/pictures/roles";
import { cancelVideoJob, getVideoJobFor, type VideoJob } from "@/lib/videos/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { __setSheetMakerForTests, __setSheetCheckerForTests, __setParagraphWriterForTests, anotherReferenceTake, FIRST_FRAME_STEP_NAMES, getReferenceVideoRecipe, runMakeReferenceVideoTurn, NO_DIALOGUE_SENTENCE } from "@/lib/videos/referenceVideo";
import {
  __setFirstFrameToolsForTests, buildFirstPicture, CLIP_FACE_LOW, decideReferenceRoute, FACE_GATE, FACE_MODELS_LINE, FIRST_FRAME_SENTENCE, LOOK_ALIKE_LINE, measureClipFaces, type FaceVec, type FirstFrameTools, type PicturedInput,
} from "@/lib/videos/referenceFirstFrame";
import { videoCardView } from "@/routes/videos";
import { installFakeVideoStack, testMp4, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

const SAFE = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() } as never;
let fake: FakeVideoStack;
let actor: PersonRow;
let composeCalls: Array<{ pictured: PicturedInput[]; scene: string }>;
let composeResult: (call: { pictured: PicturedInput[] }) => Promise<Uint8Array>;
let cutCalls: number;
/** The colour a person in a picture has: the picture's own colour (see `facesOf`). A picture marked here holds two people (left half, right half). */
let pairNames: Set<string>;
let clipFrameColor: string;
let ingredientsCalls: number;

const BAD = "#111111";
const PERSON_A = "#aa3322", PERSON_B = "#2233aa", PLACE = "#33aa22", OBJECT = "#aaaa22";
const solid = (color: string, width = 64, height = 64) => sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer().then((b) => new Uint8Array(b));
/** Left half one colour, right half another (a composed still with two people). */
async function halves(left: string, right: string, width = 1024, height = 576): Promise<Uint8Array> {
  const l = await sharp({ create: { width: width / 2, height, channels: 3, background: left } }).png().toBuffer();
  const r = await sharp({ create: { width: width / 2, height, channels: 3, background: right } }).png().toBuffer();
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).composite([{ input: l, left: 0, top: 0 }, { input: r, left: width / 2, top: 0 }]).png().toBuffer());
}
const channelR = (hex: string) => parseInt(hex.slice(1, 3), 16);

/** The fake face finder: one face per distinct colour among two sampled pixels (left and right of the top row), none for white or the "bad" colour. */
async function facesOf(bytes: Uint8Array): Promise<FaceVec[] | null> {
  const { data, info } = await sharp(Buffer.from(bytes)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number) => { const i = (10 * info.width + Math.min(info.width - 1, x)) * 3; return [data[i]!, data[i + 1]!, data[i + 2]!] as const; };
  const seen = new Map<number, FaceVec>();
  for (const [index, [r, g, b]] of [at(10), at(info.width - 10)].entries()) {
    if (r === 255 && g === 255 && b === 255) continue;
    if (r === channelR(BAD)) continue;
    const vec = new Float32Array(256); vec[r] = 1;
    if (!seen.has(r)) seen.set(r, { vec, area: 100, x: index === 0 ? 10 : info.width - 10 });
  }
  return [...seen.values()];
}

function useTools(overrides: Partial<FirstFrameTools> = {}): void {
  __setFirstFrameToolsForTests({
    installed: async () => true,
    faces: facesOf,
    cutOutPeople: async (picture) => {
      cutCalls += 1;
      const first = await sharp(Buffer.from(picture.bytes)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const color = `#${[0, 1, 2].map((i) => first.data[i]!.toString(16).padStart(2, "0")).join("")}`;
      if (pairNames.has(picture.name)) return { people: [{ name: `${picture.name} 1`, look: picture.look, image: Buffer.from(await solid(PERSON_A, 60, 120)), single: true }, { name: `${picture.name} 2`, look: picture.look, image: Buffer.from(await solid(PERSON_B, 60, 120)), single: true }], notes: [] };
      return { people: [{ name: picture.name, look: picture.look, image: Buffer.from(await solid(color, 60, 120)), single: true }], notes: [] };
    },
    compose: async ({ pictured, scene }) => { composeCalls.push({ pictured, scene }); return composeResult({ pictured }); },
    ...overrides,
  });
}

function person(role: string, name = role): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${name}first`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}

/** A chat turn with these pictures attached (one solid colour each). */
async function chatWith(who: PersonRow, colors: string[], conversationId?: string): Promise<TurnState> {
  const conv = resolveOrCreateConversation(who, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(who, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "make_reference_video", routing: { tier: "tool", score: 1 }, safety: SAFE, conversation_id: conv.value.id, turn_id: turnId } as never);
  const images: Array<{ id: string; name: string; width: number; height: number; media_type: string }> = [];
  for (const [i, color] of colors.entries()) {
    const saved = storeFile(who, { conversationId: conv.value.id, turnId, mediaType: "image/png", bytes: await solid(color), provenance: "upload", retention: "kept", name: `p${i}.png`, deduplicate: false });
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
const reading = (role: string, name: string, medium = "photograph") => JSON.stringify({ role, name, look: `${name}, plain clothes`, medium });
const answersFor = (...answers: string[]) => { let n = 0; __setRolesVisionForTests(async () => answers[n++ % answers.length]!); };
const READ_PERSON = reading("actor", "woman in a green coat"), READ_PLACE = reading("end_shot", "stone building"), READ_OBJECT = reading("prop", "stack of cards");
const pixel = async (bytes: Uint8Array, x: number, y: number) => { const { data, info } = await sharp(Buffer.from(bytes)).removeAlpha().raw().toBuffer({ resolveWithObject: true }); const i = (y * info.width + x) * 3; return `#${[0, 1, 2].map((k) => data[i + k]!.toString(16).padStart(2, "0")).join("")}`; };
async function storedFirstPicture(job: VideoJob): Promise<Uint8Array> {
  const id = getReferenceVideoRecipe(actor, job.id)!.sheetFileIds[0]!;
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get()!;
  const { readAttachment } = await import("@/lib/attachments");
  const read = readAttachment(actor, row.id);
  if (!read.ok) throw new Error("no first picture");
  return read.value.bytes;
}

beforeEach(() => {
  resetDb();
  fake = installFakeVideoStack();
  fake.ltx25max = "ready"; fake.ltx25maxPicture = true;
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25max: "ready", ltx25maxPicture: true }));
  composeCalls = []; cutCalls = 0; pairNames = new Set(); ingredientsCalls = 0; clipFrameColor = PERSON_A;
  composeResult = async () => solid(PERSON_A, 1024, 576);
  // Frames: the finished-clip age check asks for three; the face measurement asks for six (solid frames of the colour a test picks).
  __setKeyframesForTests(async (_mp4, _seconds, count) => Promise.all(Array.from({ length: count ?? 3 }, async () => new Uint8Array(await sharp({ create: { width: 128, height: 128, channels: 3, background: clipFrameColor } }).png().toBuffer()))));
  actor = person("owner");
  useTools();
  __setSheetCheckerForTests(async () => ({ isSheet: false, panels: [] }));
  __setSheetMakerForTests(async () => { throw new Error("the sheet maker must not run on this route"); });
  __setParagraphWriterForTests(async (request, _description, route) => `${route === "first_frame" ? "The woman in the green coat" : "Someone"} does this: ${request}`);
  answersFor(READ_PERSON, READ_PLACE, READ_OBJECT);
  const base = fake.handler;
  __setVideosFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/v1/videos/ingredients") { ingredientsCalls += 1; return new Response("{}", { status: 500 }); }
    return base(input as never, init);
  }) as unknown as typeof fetch);
});
afterEach(async () => {
  fake.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); __setRolesVisionForTests(null);
  __setSheetMakerForTests(null); __setSheetCheckerForTests(null); __setParagraphWriterForTests(null); __setFirstFrameToolsForTests(null);
  await new Promise((resolve) => setTimeout(resolve, 50));
});

describe("the route is decided in code before any work", () => {
  const pictures = async (...colors: string[]) => Promise.all(colors.map(async (c) => ({ bytes: await solid(c) })));
  test("a photographed person with a face takes the first-picture route; the readings are kept for the job", async () => {
    answersFor(READ_PERSON, READ_PLACE);
    const route = await decideReferenceRoute(await pictures(PERSON_A, PLACE), readPictureRoles, firstFrameToolsForRoute());
    expect(route.route).toBe("first_frame");
    expect(route.route === "first_frame" && route.readings.map((r) => r.role)).toEqual(["actor", "end_shot"]);
  });
  test("objects and places only (no face anywhere) keep the sheet route and never read the pictures", async () => {
    __setRolesVisionForTests(async () => { throw new Error("roles must not be asked when there is no face"); });
    const route = await decideReferenceRoute(await pictures(BAD, BAD), readPictureRoles, firstFrameToolsForRoute());
    expect(route).toEqual({ route: "sheet" });
  });
  test("a face in a cartoon or an object picture is not a real person: sheet route", async () => {
    answersFor(reading("actor", "cartoon fox", "illustration"), READ_OBJECT);
    expect(await decideReferenceRoute(await pictures(PERSON_A, OBJECT), readPictureRoles, firstFrameToolsForRoute())).toEqual({ route: "sheet" });
  });
  test("a person and no face models: one plain sentence, never a silent downgrade", async () => {
    answersFor(READ_PERSON);
    const route = await decideReferenceRoute(await pictures(PERSON_A), readPictureRoles, { ...firstFrameToolsForRoute(), installed: async () => false });
    expect(route).toEqual({ route: "refuse", line: FACE_MODELS_LINE });
    expect(FACE_MODELS_LINE).toContain("Telling people apart");
    expect(FACE_MODELS_LINE).toContain("Settings, AI and models");
    answersFor(READ_OBJECT, READ_PLACE);
    expect((await decideReferenceRoute(await pictures(OBJECT, PLACE), readPictureRoles, { ...firstFrameToolsForRoute(), installed: async () => false })).route).toBe("sheet");
  });
  test("through the tool: person pictures without face models are refused before any job or Stack call", async () => {
    __setFirstFrameToolsForTests({ installed: async () => false });
    answersFor(READ_PERSON);
    const outcome = await run(await chatWith(actor, [PERSON_A]), { request: "she walks along the street" });
    expect(refusedWhy(outcome)).toBe("face_models_missing");
    expect(replyOf(outcome)).toContain(FACE_MODELS_LINE);
    expect(fake.submitted).toHaveLength(0);
    expect(composeCalls).toHaveLength(0);
  });
  test("through the tool: object and place pictures take the sheet route (the sheet maker, then the Ingredients adapter)", async () => {
    answersFor(READ_OBJECT, READ_PLACE);
    let made = 0;
    __setSheetMakerForTests(async (pictures) => { made = pictures.length; throw new Error("stop here"); });
    const outcome = await run(await chatWith(actor, [BAD, BAD]), { request: "the cards fall in front of the building" });
    const job = await finished(actor, outcome);
    expect(made).toBe(2);
    expect(job.request.refProgress?.route).toBeUndefined();
    expect(composeCalls).toHaveLength(0);
  });
});

function firstFrameToolsForRoute(): FirstFrameTools {
  return { installed: async () => true, faces: facesOf, cutOutPeople: async () => ({ people: [], notes: [] }), compose: async () => new Uint8Array(), cosine: () => 0 };
}

describe("the happy path: a person, a place and an object", () => {
  test("step 1 composes the first picture (place as the plate, the person and the object as references), step 2 is an image-to-video clip from it", async () => {
    const state = await chatWith(actor, [PERSON_A, PLACE, OBJECT]);
    const outcome = await run(state, { request: "she walks up to the building holding the cards" });
    expect(outcome.status).toBe("succeeded");
    expect(replyOf(outcome)).toMatch(/two steps/);
    expect(replyOf(outcome)).toMatch(/do not describe/);
    const id = (outcome.result?.data as { videoJobId: string }).videoJobId;
    // The card says "first picture" for step 1 from the very start.
    const running = videoCardView(actor, getVideoJobFor(actor, id)!, true).items.at(-1)?.phases;
    if (running) expect(running.map((phase) => phase.name)).toEqual([...FIRST_FRAME_STEP_NAMES]);
    const job = await finished(actor, outcome);
    expect(job.state).toBe("done");
    expect(ingredientsCalls).toBe(0);
    expect(cutCalls).toBe(1);
    // The edit model got the place first (it is the picture that is edited), then the person, then the object; and was never told to redraw a face.
    expect(composeCalls).toHaveLength(1);
    expect(composeCalls[0]!.pictured.map((item) => item.subject.kind)).toEqual(["place", "character", "prop"]);
    expect(composeCalls[0]!.scene).toContain("walks up to the building");
    expect(composeCalls[0]!.scene).not.toMatch(/redraw|retouch|beautif|improve the face/i);
    // The recipe keeps the first picture, the words (with the fixed parts) and the seed.
    const recipe = getReferenceVideoRecipe(actor, job.id)!;
    expect(recipe.route).toBe("first_frame");
    expect(recipe.sheetFileIds).toHaveLength(1);
    expect(recipe.firstPicture).toMatchObject({ how: "composed" });
    expect(recipe.firstPicture!.people[0]!.score).toBeGreaterThanOrEqual(FACE_GATE);
    expect(recipe.firstPicture!.people[0]!.face).toHaveLength(256);
    expect(recipe.prompt).toContain("The woman in the green coat does this: she walks up to the building holding the cards.");
    expect(recipe.prompt).toContain(FIRST_FRAME_SENTENCE);
    expect(recipe.prompt.endsWith(NO_DIALOGUE_SENTENCE)).toBe(true);
    expect(recipe.prompt).not.toContain("Reference sheet");
    expect(recipe.seconds).toBeLessThanOrEqual(8);
    const row = db.select().from(attachments).where(eq(attachments.id, recipe.sheetFileIds[0]!)).get()!;
    expect(row.retention).toBe("kept");
    expect(row.provenance.startsWith("reference-sheet:")).toBe(true);
    // The Stack got one ordinary image-to-video request: Max with sound, the first picture at 1024x576 as the picture, the fixed words, adult.
    expect(fake.submitted).toHaveLength(1);
    const body = fake.submitted[0]!;
    expect(body).toMatchObject({ model: "ltx25-max", size: "1024x576", audience: "adult", image_source: "uploaded", tier: "max" });
    expect(body.prompt).toBe(recipe.prompt);
    expect(body.seed).toBe(recipe.seed);
    const sent = await sharp(Buffer.from(String(body.image), "base64")).metadata();
    expect([sent.width, sent.height]).toEqual([1024, 576]);
    // The card shows the first picture beside the finished clip, and the request carries the actual size and level.
    const card = videoCardView(actor, job, true);
    expect(card.items.at(-1)?.sheets).toEqual([`/api/files/${recipe.sheetFileIds[0]}/content`]);
    expect(card.items.at(-1)?.clip?.file_id).toBe(job.files[0]!.id);
    expect(job.request.quality).toBe("detailed");
    expect(job.request.tier).toBe("max");
  });
  test("with no Max picture start the best allowed level is used (a Quick clip from the first picture)", async () => {
    __setVideoStatusForTests(readyVideoStatusForTests());
    const job = await finished(actor, await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she waves at the camera" }));
    expect(job.state).toBe("done");
    expect(fake.submitted[0]!.model).toBeUndefined();
    expect(fake.submitted[0]!.size).toBe("832x480");
    expect(Number(fake.submitted[0]!.seconds)).toBeLessThanOrEqual(5);
    const sent = await sharp(Buffer.from(String(fake.submitted[0]!.image), "base64")).metadata();
    expect([sent.width, sent.height]).toEqual([832, 480]);
  });
  test("one picture of people and nothing else: the photo itself is the first picture, no edit model, no cut-out", async () => {
    answersFor(READ_PERSON);
    const job = await finished(actor, await run(await chatWith(actor, [PERSON_A]), { request: "she smiles and looks around" }));
    expect(job.state).toBe("done");
    expect(composeCalls).toHaveLength(0);
    expect(cutCalls).toBe(0);
    const recipe = getReferenceVideoRecipe(actor, job.id)!;
    expect(recipe.firstPicture!.how).toBe("photo");
    expect(await pixel(await storedFirstPicture(job), 512, 288)).toBe(PERSON_A);
  });
});

describe("the face gate and its fallback", () => {
  test("a composed picture whose face does not match the person's photo is replaced by a plain paste of their own pixels, and the person is told", async () => {
    composeResult = async () => solid(BAD, 1024, 576);
    const job = await finished(actor, await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she walks up to the building" }));
    expect(job.state).toBe("done");
    const recipe = getReferenceVideoRecipe(actor, job.id)!;
    expect(recipe.firstPicture!.how).toBe("pasted");
    expect(recipe.firstPicture!.notes.join(" ")).toContain("changed a face");
    expect(recipe.firstPicture!.notes.join(" ")).toContain("pasted");
    // The person's own pixels stand on the place picture: the middle of the bottom is their colour, the corner is the place's.
    const still = await storedFirstPicture(job);
    expect(await pixel(still, 512, 500)).toBe(PERSON_A);
    expect(await pixel(still, 5, 5)).toBe(PLACE);
    expect(job.request.edit?.note).toContain("pasted");
  });
  test("an edit that fails outright falls back the same way", async () => {
    composeResult = async () => { throw new Error("the picture editor is not ready"); };
    const job = await finished(actor, await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she walks up to the building" }));
    expect(job.state).toBe("done");
    const recipe = getReferenceVideoRecipe(actor, job.id)!;
    expect(recipe.firstPicture!.how).toBe("pasted");
    expect(recipe.firstPicture!.notes.join(" ")).toContain("could not place");
  });
  test("two people from one photo: both references go to the edit model, and BOTH faces must pass", async () => {
    pairNames.add("woman in a green coat");
    composeResult = async () => halves(PERSON_A, PERSON_B);
    const ok = await buildFirstPicture([{ id: "a", bytes: await solid(PERSON_A), mediaType: "image/png", name: "woman in a green coat", role: "actor", look: "two friends" }, { id: "p", bytes: await solid(PLACE), mediaType: "image/png", name: "stone building", role: "end_shot", look: "a stone building" }], { scene: "they meet", tools: firstFrameToolsWith() });
    expect(ok.how).toBe("composed");
    expect(ok.people.map((p) => p.name)).toEqual(["woman in a green coat 1", "woman in a green coat 2"]);
    expect(composeCalls[0]!.pictured.map((item) => item.subject.kind)).toEqual(["place", "character", "character"]);
    // The second person is missing from the composed picture: the gate fails and the first picture is the paste of both.
    composeResult = async () => solid(PERSON_A, 1024, 576);
    const pasted = await buildFirstPicture([{ id: "a", bytes: await solid(PERSON_A), mediaType: "image/png", name: "woman in a green coat", role: "actor", look: "two friends" }, { id: "p", bytes: await solid(PLACE), mediaType: "image/png", name: "stone building", role: "end_shot", look: "a stone building" }], { scene: "they meet", tools: firstFrameToolsWith() });
    expect(pasted.how).toBe("pasted");
    expect(await pixel(pasted.png, 256, 500)).toBe(PERSON_A);
    expect(await pixel(pasted.png, 768, 500)).toBe(PERSON_B);
  });
  test("more than two people, or objects that do not fit beside two people, are named in the notes", async () => {
    pairNames.add("woman in a green coat");
    composeResult = async () => halves(PERSON_A, PERSON_B);
    const result = await buildFirstPicture([
      { bytes: await solid(PERSON_A), mediaType: "image/png", name: "woman in a green coat", role: "actor", look: "friends" },
      { bytes: await solid(OBJECT), mediaType: "image/png", name: "stack of cards", role: "prop", look: "cards" },
      { bytes: await solid(PLACE), mediaType: "image/png", name: "stone building", role: "end_shot", look: "a building" },
    ], { scene: "they play", tools: firstFrameToolsWith() });
    expect(composeCalls[0]!.pictured).toHaveLength(3);
    expect(result.notes.join(" ")).toContain("left out of the first picture");
  });
});

function firstFrameToolsWith(): FirstFrameTools {
  return {
    installed: async () => true, faces: facesOf,
    cosine: (a, b) => { let dot = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! * a[i]!; bb += b[i]! * b[i]!; } return aa && bb ? dot / Math.sqrt(aa * bb) : 0; },
    cutOutPeople: async (picture) => {
      cutCalls += 1;
      if (pairNames.has(picture.name)) return { people: [{ name: `${picture.name} 1`, look: picture.look, image: Buffer.from(await solid(PERSON_A, 60, 120)), single: true }, { name: `${picture.name} 2`, look: picture.look, image: Buffer.from(await solid(PERSON_B, 60, 120)), single: true }], notes: [] };
      return { people: [{ name: picture.name, look: picture.look, image: Buffer.from(await solid(PERSON_A, 60, 120)), single: true }], notes: [] };
    },
    compose: async ({ pictured, scene }) => { composeCalls.push({ pictured, scene }); return composeResult({ pictured }); },
  };
}

describe("the finished clip is measured and the person is told", () => {
  test("six frames, each person's nearest face against their photo; matching faces say nothing", async () => {
    clipFrameColor = PERSON_A;
    const job = await finished(actor, await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she walks" }));
    const match = getReferenceVideoRecipe(actor, job.id)!.faceMatch!;
    expect(match.frames).toBe(6);
    expect(match.people[0]!.scores).toHaveLength(6);
    expect(match.people[0]!.median).toBeGreaterThanOrEqual(0.9);
    expect(match.low).toBe(false);
    expect(job.request.edit?.note ?? "").not.toContain(LOOK_ALIKE_LINE);
  });
  test("a median under 0.35 adds the one plain sentence to the card's notice and never blocks the clip", async () => {
    clipFrameColor = PERSON_B;
    const job = await finished(actor, await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she walks" }));
    expect(job.state).toBe("done");
    expect(job.files[0]).toBeTruthy();
    const match = getReferenceVideoRecipe(actor, job.id)!.faceMatch!;
    expect(match.low).toBe(true);
    expect(match.people[0]!.median).toBeLessThan(0.35);
    expect(job.request.edit?.note).toContain(LOOK_ALIKE_LINE);
    expect(videoCardView(actor, job, true).items.at(-1)?.note).toContain("may not look like the photo");
  });
  test("the measurement itself: two people use each one's nearest match; no frames or no models gives null", async () => {
    const frames = [await halves(PERSON_A, PERSON_B)];
    __setKeyframesForTests(async () => frames.map((frame) => new Uint8Array(frame)));
    const tools = firstFrameToolsWith();
    const two = await measureClipFaces(testMp4(), 6, [{ name: "a", face: Array.from(Float32Array.from({ length: 256 }, (_, i) => (i === channelR(PERSON_A) ? 1 : 0))) }, { name: "b", face: Array.from(Float32Array.from({ length: 256 }, (_, i) => (i === channelR(PERSON_B) ? 1 : 0))) }], tools);
    expect(two!.people.map((p) => p.median)).toEqual([1, 1]);
    expect(await measureClipFaces(testMp4(), 6, [{ name: "a", face: null }], tools)).toBeNull();
    __setKeyframesForTests(async () => null);
    expect(await measureClipFaces(testMp4(), 6, [{ name: "a", face: [1] }], tools)).toBeNull();
    expect(CLIP_FACE_LOW).toBe(0.35);
  });
});

describe("steps, Stop and the saved recipe", () => {
  test("the card names the two steps for this route, with the first picture's sub-steps in step 1", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    composeResult = async () => { await gate; return solid(PERSON_A, 1024, 576); };
    fake.queuedPolls = 4;
    const outcome = await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she walks" });
    const id = (outcome.result?.data as { videoJobId: string }).videoJobId;
    const phasesOf = () => videoCardView(actor, getVideoJobFor(actor, id)!, true).items.at(-1)?.phases;
    await until(() => (phasesOf()?.[0]?.line ?? "").startsWith("Placing everyone"));
    const first = phasesOf()!;
    expect(first.map((phase) => [phase.name, phase.state])).toEqual([["Creating the first picture", "running"], ["Creating the video", "waiting"]]);
    expect(videoCardView(actor, getVideoJobFor(actor, id)!, true).items.at(-1)?.sheets).toBeUndefined();
    release();
    await until(() => phasesOf()?.[1]?.waiting === true);
    const second = phasesOf()!;
    expect(second[0]).toMatchObject({ name: "Creating the first picture", state: "done", percent: 100 });
    expect(second[1]).toMatchObject({ name: "Creating the video", state: "running", waiting: true });
    expect(second[1]!.line).toContain("Waiting for the computer to have enough free room");
    expect(videoCardView(actor, getVideoJobFor(actor, id)!, true).items.at(-1)?.sheets).toHaveLength(1);
    expect(getVideoJobFor(actor, id)!.phase).toBe("making from the first picture");
    await finished(actor, outcome);
  });
  test("Stop in step 1: nothing is asked of the video engine", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    composeResult = async () => { await gate; return solid(PERSON_A, 1024, 576); };
    const outcome = await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she walks" });
    const id = (outcome.result?.data as { videoJobId: string }).videoJobId;
    await until(() => composeCalls.length === 1);
    await cancelVideoJob(actor, id);
    release();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(getVideoJobFor(actor, id)!.state).toBe("cancelled");
    expect(fake.submitted).toHaveLength(0);
    expect(db.select().from(attachments).where(eq(attachments.provenance, `reference-sheet:${JSON.stringify({ v: 1, provided: false, index: 0, route: "first_frame" })}`)).all()).toHaveLength(0);
  });
  test("Stop in step 2: the engine's job is cancelled", async () => {
    fake.pollsToFinish = 1000; fake.queuedPolls = 0;
    const outcome = await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she walks" });
    const id = (outcome.result?.data as { videoJobId: string }).videoJobId;
    await until(() => fake.jobs.length === 1);
    await cancelVideoJob(actor, id);
    await until(() => fake.jobs[0]!.deleted);
    expect(getVideoJobFor(actor, id)!.state).toBe("cancelled");
  });
  test("Another take: the same first picture and words, a new seed, no new cut-outs or edit", async () => {
    const first = await finished(actor, await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she walks" }));
    const again = anotherReferenceTake(actor, first);
    if (!again.ok) throw new Error(again.line);
    await until(() => getVideoJobFor(actor, again.job.id)?.state === "done");
    expect(cutCalls).toBe(1);
    expect(composeCalls).toHaveLength(1);
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]!.prompt).toBe(fake.submitted[0]!.prompt);
    expect(fake.submitted[1]!.seed).not.toBe(fake.submitted[0]!.seed);
    expect(fake.submitted[1]!.image).toBe(fake.submitted[0]!.image);
    const recipe = getReferenceVideoRecipe(actor, again.job.id)!;
    expect(recipe.sheetFileIds).toEqual(getReferenceVideoRecipe(actor, first.id)!.sheetFileIds);
    expect(getVideoJobFor(actor, again.job.id)!.request.refProgress?.route).toBe("first_frame");
  });
  test("same picture, new words: reuse_video re-renders from the first picture, with the fixed parts", async () => {
    const state = await chatWith(actor, [PERSON_A, PLACE]);
    const first = await finished(actor, await run(state, { request: "she walks" }));
    const outcome = await run(await chatWith(actor, [], state.conversationId!), { reuse_video: "latest", request: "she sits down on the steps" });
    expect(replyOf(outcome)).toContain("same first picture is used again");
    const second = await finished(actor, outcome);
    expect(second.state).toBe("done");
    expect(composeCalls).toHaveLength(1);
    const recipe = getReferenceVideoRecipe(actor, second.id)!;
    expect(recipe.route).toBe("first_frame");
    expect(recipe.sheetFileIds).toEqual(getReferenceVideoRecipe(actor, first.id)!.sheetFileIds);
    expect(recipe.prompt).toContain("she sits down on the steps");
    expect(recipe.prompt.endsWith(NO_DIALOGUE_SENTENCE)).toBe(true);
    expect(fake.submitted[1]!.prompt).toBe(recipe.prompt);
  });
  test("a first picture that cannot be made is one plain sentence and starts no clip", async () => {
    useTools({ cutOutPeople: async () => { throw new Error("remove_background exploded"); } });
    const job = await finished(actor, await run(await chatWith(actor, [PERSON_A, PLACE]), { request: "she walks" }));
    expect(job.state).toBe("failed");
    expect(job.error).toContain("couldn't make the first picture");
    expect(fake.submitted).toHaveLength(0);
  });
});
