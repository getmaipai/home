// REFVIDEO-FIRSTFRAME-01: the second route of `make_reference_video`, for pictures that hold a REAL person's face.
//
// Measured 2026-11-12 (8 clips of two real adults): the LTX 2.5 Ingredients adapter does not keep a real face from a reference sheet (SFace cosine to the photo 0.02 to 0.22 against about
// 0.36 for the same person). Hair, glasses and clothes carry over, the face does not. A face that is in the clip's FIRST FRAME does stay (image-to-video conditions frame 0 at full
// strength), so for people the clip starts from a first picture that already holds each person's real face, placed into the scene.
//
// This file holds everything that route decides and makes that is not the job itself (referenceVideo.ts runs the job): the route choice, the first picture (cut-outs, the edit model's
// composition, the face gate, the plain paste that falls back from it) and the face measurement of the finished clip. Face code and the Stack's picture edit are loaded when they are
// used (dynamic imports), never at import: the chat picture path imports referenceVideo.ts, and the face models stay out of it (VISION-02c).
import sharp, { type OverlayOptions } from "sharp";
import type { PersonRow } from "@/types";
import type { PictureReading, PictureRole } from "@/lib/pictures/roles";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import type { Pose, SeatBox } from "@/lib/pictures/pose";

/** The two steps' names, as the card shows them on this route. */
export const FIRST_FRAME_STEP_NAMES = ["Creating the first picture", "Creating the video"] as const;
/** The plain sentence for each sub-step of step 1. */
export const FIRST_FRAME_LINES = { read: "Reading the pictures", cut: "Cutting people out", place: "Placing everyone in the scene", check: "Checking that the faces are yours", join: "Keeping the first picture" } as const;
/** What a person with people in their pictures is told when the face models are missing (what went wrong, then what to do). */
export const FACE_MODELS_LINE = "To make a video with people in it, an admin must install \"Telling people apart\" in Settings, AI and models. Ask an admin, then ask me again.";
/** Added to the finished video's notice when the faces in the clip do not match the photos. */
export const LOOK_ALIKE_LINE = "The person in the later part of the video may not look like the photo.";
/** The first picture's size (the Max clip's size; the Stack fits it to any other). */
export const FIRST_PICTURE_W = 1024, FIRST_PICTURE_H = 576;
/** A person's face in the composed first picture must match their own photo at least this well (SFace cosine; the same person scored about 0.36 across a clip, 0.5 is a near copy). */
export const FACE_GATE = 0.5;
/** The finished clip is flagged when the median face match of the sampled frames is below this. */
export const CLIP_FACE_LOW = 0.35;
export const CLIP_FACE_FRAMES = 6;
/** Always in the first-picture route's paragraph: one real, continuous shot that begins as the first picture shows. */
export const FIRST_FRAME_SENTENCE = "Photorealistic, one continuous scene that begins exactly as the first picture shows.";
/** The edit model takes at most two reference pictures, so at most two people are placed. */
export const MAX_PLACED_PEOPLE = 2;

// ---------------------------------------------------------------- tools (and their test seam)

// The sheet maker's own picture shape (films/sheetMaker.ts), kept here as a plain type: importing that file, even for a type, would put the face code on the chat picture path.
export interface SheetPicture { bytes: Uint8Array; mediaType: string; name: string; role: PictureRole; look: string }
export interface FaceVec { vec: Float32Array; area: number; x: number; box?: [number, number, number, number] }
export interface CutPerson { name: string; look: string; image: Buffer; single: boolean }
export interface PicturedInput { subject: { name: string; kind: string }; picture: { bytes: Uint8Array; mediaType: string } }
export interface FirstFrameTools {
  /** Both pinned face models are installed. */
  installed(): Promise<boolean>;
  /** The faces in a picture, biggest first, with their SFace vectors; null when the face models are not there or fail. */
  faces(bytes: Uint8Array): Promise<FaceVec[] | null>;
  /** The people of one actor picture, each cut out alone (films/sheetMaker.ts cutOutPeople: the sheet's own split and junk-only cleanup). */
  cutOutPeople(picture: SheetPicture): Promise<{ people: CutPerson[]; notes: string[] }>;
  /** The Stack's picture edit (klein, up to two reference pictures): the first entry is the picture that is edited, the others ride along as references. Returns the PNG. */
  compose(input: { pictured: PicturedInput[]; scene: string; signal: AbortSignal }): Promise<Uint8Array>;
  harmonize?(input: { png: Buffer; mask: Buffer; prompt: string; signal: AbortSignal }): Promise<Uint8Array>;
  /** SFace cosine of two vectors. */
  cosine(a: Float32Array, b: Float32Array): number;
  readPose?(image: Uint8Array): Promise<{ pose: Pose }>;
  readSeatBox?(plate: Uint8Array): Promise<SeatBox | null>;
}

const sleepOrAbort = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
  const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
  signal.addEventListener("abort", stop, { once: true });
});

function realTools(actor: PersonRow | null): FirstFrameTools {
  return {
    async installed() { try { return (await import("@/lib/visionAssets")).areVisionAssetsInstalled(); } catch { return false; } },
    async faces(bytes) {
      const faces = await import("@/lib/pictures/likeness/faces");
      const png = new Uint8Array(await sharp(Buffer.from(bytes)).png().toBuffer());
      const found = await faces.detectFaces(png);
      if (!found.ok) return null;
      const out: FaceVec[] = [];
      for (const face of [...found.value].sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3]).slice(0, 8)) {
        const embedded = await faces.embedFace(png, face);
        if (embedded.ok) out.push({ vec: embedded.value, area: face.bbox[2] * face.bbox[3], x: face.bbox[0], box: face.bbox });
      }
      return out;
    },
    async cutOutPeople(picture) { return (await import("@/lib/films/sheetMaker")).cutOutPeople(picture); },
    async compose({ pictured, scene, signal }) {
      const [{ submitComposition }, pictures, { fullViewForJob }] = await Promise.all([import("@/lib/films/engines"), import("@/lib/pictures/stack"), import("@/lib/stack/fullView")]);
      const submitted = await submitComposition(pictured, scene);
      const view = actor ? fullViewForJob("adult", actor) : undefined;
      const deadline = Date.now() + 10 * 60_000;
      try {
        for (;;) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (Date.now() > deadline) throw new Error("The picture took too long.");
          const job = await pictures.getGenerationJob(submitted.job, view);
          if (job.state === "failed" || job.state === "cancelled") throw new Error(job.error ?? "The picture could not be made.");
          if (job.state === "done") { const bytes = await pictures.fetchPicture(submitted.job, 0, view); void pictures.cancelOrDelete(submitted.job); return bytes; }
          await sleepOrAbort(500, signal);
        }
      } catch (error) { void pictures.cancelOrDelete(submitted.job); throw error; }
    },
    async harmonize({ png, mask, prompt, signal }) { return (await import("@/lib/videos/firstPictureHarmony")).realHarmonize(png, mask, prompt, signal); },
    cosine(a, b) { let dot = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! * a[i]!; bb += b[i]! * b[i]!; } return a.length === b.length && aa && bb ? dot / Math.sqrt(aa * bb) : 0; },
    async readPose(image) { return (await import("@/lib/pictures/pose")).readPose(image); },
    async readSeatBox(plate) { return (await import("@/lib/pictures/pose")).readSeatBox(plate); },
  };
}
let toolsOverride: Partial<FirstFrameTools> | null = null;
/** Test seam: replaces any of the tools (the real ones need the face models and the Stack). */
export function __setFirstFrameToolsForTests(tools: Partial<FirstFrameTools> | null): void { toolsOverride = tools; }
/** The tools of this run: the real ones, with any test replacement on top. */
export function firstFrameTools(actor: PersonRow | null = null): FirstFrameTools { return { ...realTools(actor), ...(toolsOverride ?? {}) }; }

// ---------------------------------------------------------------- the route

export type ReferenceRoute = { route: "sheet" } | { route: "first_frame"; readings: PictureReading[] } | { route: "refuse"; line: string };
type RoleReader = (images: ReadonlyArray<Uint8Array>) => Promise<{ ok: true; readings: PictureReading[] } | { ok: false; line: string }>;

/** Which route these pictures take, decided in code before any work: a real person's face (the face finder finds a face in a picture the vision model reads as a photographed person)
 *  takes the first-picture route; everything else (objects, places, cartoons) keeps the sheet route. With people in the pictures and no face models the answer is a plain refusal,
 *  never a silent downgrade. Reading the pictures needs the vision model: when it cannot read them the sheet route reports that itself. */
export async function decideReferenceRoute(pictures: ReadonlyArray<{ bytes: Uint8Array }>, readRoles: RoleReader, tools: FirstFrameTools = firstFrameTools()): Promise<ReferenceRoute> {
  const installed = await tools.installed();
  let withFace = new Set<number>();
  if (installed) {
    for (const [index, picture] of pictures.entries()) {
      const found = await tools.faces(picture.bytes).catch(() => null);
      if (found && found.length > 0) withFace.add(index);
    }
    if (withFace.size === 0) return { route: "sheet" };
  }
  const read = await readRoles(pictures.map((picture) => picture.bytes));
  if (!read.ok) return { route: "sheet" };
  const person = (reading: PictureReading) => reading.role === "actor" && reading.medium === "photograph";
  if (!installed) return read.readings.some(person) ? { route: "refuse", line: FACE_MODELS_LINE } : { route: "sheet" };
  return read.readings.some((reading, index) => withFace.has(index) && person(reading)) ? { route: "first_frame", readings: read.readings } : { route: "sheet" };
}

// ---------------------------------------------------------------- the first picture

export interface FirstFramePicture extends SheetPicture { /** The attached picture's file id (kept on the recipe). */ id?: string }
export interface FirstPersonResult { name: string; look: string; /** Their face in the first picture against their own photo (null: not measured). */ score: number | null; /** Their own photo's face (SFace vector), kept to measure the clip against; null when none was found. */ face: number[] | null }
export interface FirstPictureResult {
  png: Uint8Array;
  how: "composed" | "pasted" | "photo";
  /** Plain sentences about what could not be done exactly (a paste instead of a composition, objects left out). */
  notes: string[];
  people: FirstPersonResult[];
  /** What the first picture shows, in words: for the paragraph writer. */
  description: string;
  /** Which attached pictures each person came from (ids), parallel to `people`. */
  pictureIds: string[][];
}
export interface FirstPictureOptions { scene: string; signal?: AbortSignal; onStep?: (done: number, total: number, line: string) => void; actor?: PersonRow | null; tools?: FirstFrameTools }

const isPlace = (role: PictureRole) => role === "set" || role === "end_shot" || role === "other";
const round4 = (vec: Float32Array) => Array.from(vec, (value) => Math.round(value * 10000) / 10000);
const onWhite = (image: Buffer) => sharp(image).flatten({ background: "#ffffff" }).png().toBuffer();
async function fitCover(bytes: Uint8Array | Buffer): Promise<Buffer> { return sharp(Buffer.from(bytes), { failOn: "error" }).rotate().resize(FIRST_PICTURE_W, FIRST_PICTURE_H, { fit: "cover" }).png().toBuffer(); }
/** The photo itself at the clip's frame: it keeps its own shape on a soft copy of itself (the film engine's exact-photo handling), so nothing is cropped or redrawn. */
async function fitSoft(bytes: Uint8Array | Buffer): Promise<Buffer> {
  const base = sharp(Buffer.from(bytes), { failOn: "error" }).rotate();
  const backdrop = await base.clone().resize(FIRST_PICTURE_W, FIRST_PICTURE_H, { fit: "cover" }).blur(28).modulate({ brightness: 0.85 }).png().toBuffer();
  const front = await base.clone().resize(FIRST_PICTURE_W, FIRST_PICTURE_H, { fit: "inside" }).png().toBuffer();
  return sharp(backdrop).composite([{ input: front, gravity: "centre" }]).png().toBuffer();
}
const numbered = (name: string, index: number, count: number) => count > 1 ? `${name} ${index + 1}` : name;

/** Plain paste: each person's own cut-out (their pixels, untouched) stands on the plate, spread left to right. */
async function pasteOver(plate: Buffer, people: ReadonlyArray<Buffer>): Promise<Buffer> {
  const slotW = FIRST_PICTURE_W / people.length;
  const layers: OverlayOptions[] = [];
  for (const [index, image] of people.entries()) {
    const fitted = await sharp(image).resize({ width: Math.round(slotW * 0.9), height: Math.round(FIRST_PICTURE_H * 0.9), fit: "inside" }).png().toBuffer();
    const meta = await sharp(fitted).metadata();
    const w = meta.width ?? 1, h = meta.height ?? 1;
    layers.push({ input: fitted, left: Math.max(0, Math.round(slotW * index + (slotW - w) / 2)), top: Math.max(0, FIRST_PICTURE_H - h - Math.round(FIRST_PICTURE_H * 0.03)) });
  }
  return sharp(plate).composite(layers).png().toBuffer();
}

/** STEP 1 of the route: ONE still at the clip's size that holds every person's own face, placed in the scene.
 *  - One actor picture and nothing else: that photo itself (their pixels, nothing redrawn).
 *  - Otherwise each person is cut out alone; the place (a set or building photo) is the plate the edit model works on, people and objects ride as its reference pictures (at most two);
 *    with no place the first person's photo is the picture it edits. Every person's face in the result must match their own photo (SFace, `FACE_GATE`). If the edit fails or any face does
 *    not match, the first picture is the people's own cut-outs pasted over the plate, and the notes say so. */
export async function buildFirstPicture(pictures: ReadonlyArray<FirstFramePicture>, options: FirstPictureOptions): Promise<FirstPictureResult> {
  const tools = options.tools ?? firstFrameTools(options.actor ?? null);
  const signal = options.signal ?? new AbortController().signal;
  const actors = pictures.filter((picture) => picture.role === "actor");
  const places = pictures.filter((picture) => isPlace(picture.role));
  const objects = pictures.filter((picture) => picture.role === "product" || picture.role === "prop");
  if (!actors.length) throw new Error("The first picture needs a picture of a person.");
  const notes: string[] = [];
  const idsOf = (picture: FirstFramePicture) => picture.id ? [picture.id] : [];
  const step = options.onStep ?? (() => {});
  const total = 3 + actors.length;
  step(0, total, FIRST_FRAME_LINES.read);

  // One photo of the people and nothing to add: the photo is the first picture.
  if (actors.length === 1 && !places.length && !objects.length) {
    const only = actors[0]!;
    const faces = (await tools.faces(only.bytes).catch(() => null)) ?? [];
    const sorted = [...faces].sort((a, b) => a.x - b.x).slice(0, 3);
    const people: FirstPersonResult[] = sorted.length ? sorted.map((face, index) => ({ name: numbered(only.name, index, sorted.length), look: only.look, score: 1, face: round4(face.vec) })) : [{ name: only.name, look: only.look, score: null, face: null }];
    return { png: new Uint8Array(await fitSoft(only.bytes)), how: "photo", notes, people, description: `The first picture is the person's own photo: ${people.map((person) => `${person.name} (${person.look})`).join("; ")}.`, pictureIds: people.map(() => idsOf(only)) };
  }

  // Each person alone.
  type Placed = CutPerson & { pictureId: string[]; actorIndex: number; vec: Float32Array | null };
  const placed: Placed[] = [];
  for (const [index, picture] of actors.entries()) {
    step(1 + index, total, `${FIRST_FRAME_LINES.cut}${actors.length > 1 ? ` (${index + 1} of ${actors.length})` : ""}`);
    const cut = await tools.cutOutPeople(picture);
    notes.push(...cut.notes);
    for (const person of cut.people) {
      const flat = await onWhite(person.image);
      const face = (await tools.faces(new Uint8Array(flat)).catch(() => null))?.[0] ?? null;
      placed.push({ ...person, pictureId: idsOf(picture), actorIndex: index, vec: face?.vec ?? null });
    }
  }
  if (!placed.length) throw new Error("No person could be cut out of the pictures.");
  const people = placed.slice(0, MAX_PLACED_PEOPLE);
  if (placed.length > people.length) notes.push(`Only the first ${MAX_PLACED_PEOPLE} people are in the first picture; the picture editor can place two.`);
  if (places.length > 1) notes.push("Only the first place picture is used for the first picture.");
  const objectsLeft = objects.slice(0, Math.max(0, MAX_PLACED_PEOPLE - people.length));
  if (objects.length > objectsLeft.length) notes.push(`The ${objects.length - objectsLeft.length === 1 ? "object" : "objects"} left out of the first picture ${objects.length - objectsLeft.length === 1 ? "is" : "are"} still named in the video's words.`);

  step(1 + actors.length, total, FIRST_FRAME_LINES.place);
  const plate = places[0] ? await fitCover(places[0].bytes) : await fitSoft(actors[0]!.bytes);
  const refSubjects = async (list: ReadonlyArray<Placed>): Promise<PicturedInput[]> => Promise.all(list.map(async (person) => ({ subject: { name: person.name, kind: "character" }, picture: { bytes: new Uint8Array(await onWhite(person.image)), mediaType: "image/png" } })));
  const objectInputs: PicturedInput[] = objectsLeft.map((object) => ({ subject: { name: object.name, kind: "prop" }, picture: { bytes: object.bytes, mediaType: object.mediaType } }));
  let pictured: PicturedInput[];
  if (places[0]) pictured = [{ subject: { name: places[0].name, kind: "place" }, picture: { bytes: new Uint8Array(plate), mediaType: "image/png" } }, ...await refSubjects(people), ...objectInputs];
  else {
    // No place: the first person's own photo is the picture the edit model works on; people from other pictures and the objects are its references.
    const fromBase = people.filter((person) => person.actorIndex === 0);
    const rest = people.filter((person) => !fromBase.includes(person)).slice(0, 2);
    pictured = [{ subject: { name: actors[0]!.name, kind: "character" }, picture: { bytes: actors[0]!.bytes, mediaType: actors[0]!.mediaType } }, ...await refSubjects(rest), ...objectInputs.slice(0, Math.max(0, 2 - rest.length))];
  }

  const own = people.map((person) => ({ name: person.name, look: person.look, vec: person.vec }));
  let how: FirstPictureResult["how"] = "pasted";
  let png: Buffer | null = null;
  let scores: Array<number | null> = own.map(() => null);
  let reason: string | null = null;
  try {
    const edited = await tools.compose({ pictured, scene: options.scene, signal });
    const candidate = await fitCover(edited);
    step(2 + actors.length, total, FIRST_FRAME_LINES.check);
    const found = await tools.faces(new Uint8Array(candidate)).catch(() => null);
    if (!found) reason = "The faces in it could not be checked.";
    else {
      scores = own.map((person) => person.vec ? found.reduce((best, face) => Math.max(best, tools.cosine(person.vec!, face.vec)), -1) : null);
      const bad = scores.some((score) => score === null || score < FACE_GATE);
      if (bad) reason = "The picture editor changed a face while placing the people.";
      else { png = candidate; how = "composed"; }
    }
  } catch (error) {
    if (signal.aborted) throw error;
    reason = "The picture editor could not place the people.";
  }
  if (!png) {
    // Their own pixels, over the plate: less natural, never a changed face.
    const poseResults = await Promise.all(people.map((person) => (tools.readPose ?? (async (image: Uint8Array) => (await import("@/lib/pictures/pose")).readPose(image)))(new Uint8Array(person.image)).catch(() => ({ pose: "standing" as const }))));
    const seated = poseResults.some((result) => result.pose === "seated");
    const seat = seated ? await (tools.readSeatBox ?? (async (image: Uint8Array) => (await import("@/lib/pictures/pose")).readSeatBox(image)))(new Uint8Array(plate)).catch(() => null) : null;
    const [{ composeNaturalWithMasks }, harmony] = await Promise.all([import("@/lib/videos/firstPictureCompose"), import("@/lib/videos/firstPictureHarmony")]);
    const natural = await composeNaturalWithMasks(plate, people.map((person, index) => ({ image: person.image, pose: poseResults[index]!.pose, seat: poseResults[index]!.pose === "seated" ? seat : null })));
    png = natural.png;
    let blended = false;
    const harmonizeTool = tools.harmonize;
    if (harmonizeTool) {
      const detected = await tools.faces(new Uint8Array(natural.png)).catch(() => null);
      const faceBoxes = (detected ?? []).flatMap((face) => face.box ? [{ box: face.box }] : []);
      try {
        if (faceBoxes.length) {
          const candidate = await harmony.harmonize({ png: natural.png, people: natural.people, faceBoxes, tools: { harmonize: harmonizeTool }, signal });
          const found = await tools.faces(new Uint8Array(candidate)).catch(() => null);
          const scores = found ? own.map((person) => person.vec ? found.reduce((best, face) => Math.max(best, tools.cosine(person.vec!, face.vec)), -1) : -1) : [];
          if (scores.length === own.length && scores.every((score) => score >= FACE_GATE)) { png = candidate; blended = true; how = "composed"; }
        }
      } catch { /* keep the clean CREATOR-07 composition */ }
    }
    if (!blended) notes.push("The picture editor could not blend the people into the scene, so each person's own cut-out is placed in it.");
    if (objectInputs.length) notes.push("The objects are not in the first picture; the video's words still name them.");
    scores = own.map(() => null);
  }
  const description = `The first picture shows ${own.map((person) => `${person.name} (${person.look})`).join("; ")}${places[0] ? `, in ${places[0].look}` : ""}${objectsLeft.length ? `, with ${objectsLeft.map((object) => `${object.name} (${object.look})`).join("; ")}` : ""}.`;
  return { png: new Uint8Array(png), how, notes, people: own.map((person, index) => ({ name: person.name, look: person.look, score: scores[index] ?? null, face: person.vec ? round4(person.vec) : null })), description, pictureIds: people.map((person) => person.pictureId) };
}

// ---------------------------------------------------------------- the finished clip

export interface ClipFaceMatch { frames: number; people: Array<{ name: string; scores: number[]; median: number | null }>; threshold: number; low: boolean }
const median = (values: number[]): number | null => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2; };
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Samples six frames of the finished clip and measures how well the faces in them match each person's photo: each person's nearest face in each frame (SFace cosine). Measured only, never a
 *  reason to block the clip. Returns null when the frames or the face models are not there. */
export async function measureClipFaces(clip: Uint8Array, seconds: number | null, references: ReadonlyArray<{ name: string; face: number[] | null }>, tools: FirstFrameTools = firstFrameTools()): Promise<ClipFaceMatch | null> {
  try {
    const known = references.filter((reference): reference is { name: string; face: number[] } => reference.face !== null && reference.face.length > 0);
    if (!known.length) return null;
    const frames = await extractKeyframes(clip, seconds, CLIP_FACE_FRAMES);
    if (!frames || frames.length === 0) return null;
    const people = known.map((reference) => ({ name: reference.name, vec: Float32Array.from(reference.face), scores: [] as number[] }));
    let measured = 0;
    for (const frame of frames) {
      const found = await tools.faces(frame);
      if (found === null) return null;
      if (!found.length) continue;
      measured += 1;
      for (const person of people) person.scores.push(round3(found.reduce((best, face) => Math.max(best, tools.cosine(person.vec, face.vec)), -1)));
    }
    const result = people.map((person) => ({ name: person.name, scores: person.scores, median: person.scores.length ? round3(median(person.scores)!) : null }));
    return { frames: measured, people: result, threshold: CLIP_FACE_LOW, low: result.some((person) => person.median !== null && person.median < CLIP_FACE_LOW) };
  } catch { return null; }
}
