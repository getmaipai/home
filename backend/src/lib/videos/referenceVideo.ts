// REFVIDEO-01: `make_reference_video`. A person attaches pictures (people, objects, places) and asks for a short video that uses them. Home builds ONE reference sheet
// from the pictures (a picture that already is a clean sheet is used as it is), shows it on the video's card before the clip exists, then asks the Stack for an
// 8 second clip with the LTX 2.5 Ingredients adapter (`POST /v1/videos/ingredients`, Max only). The clip is an ordinary made clip: one job, polled, stoppable, checked
// when finished, read back like a restyle. The sheet files, the words and the seed are saved on the job's request (`ReferenceRecipe`), so Another take and an edit of
// the words re-render from the SAME sheets without new cut-outs or drawn views. The model never reads wording (rule 1): the tool is offered by structure (pictures
// attached, adult, own written screen, video on) and the model chooses it.
import { z } from "zod";
import sharp from "sharp";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { loadSource } from "@/lib/imageEdit";
import { completeBackground } from "@/lib/llm";
import { readPictureRoles, type PictureReading, type PictureRole } from "@/lib/pictures/roles";
import { screenInputImage, viewerOf } from "@/lib/pictures/ageCheck";
import { laneOf } from "@/lib/pictures/lane";
import { readAttachment, storeFile } from "@/lib/attachments";
import { tierArgument, MAX_NEEDS_ADMIN_LINE } from "@/lib/tiers";
import { INGREDIENTS_FAILURE_COPY } from "@/lib/failureCopy";
import { refuseVideoPrompt, VIDEO_REFUSAL_LINE } from "./policy";
import { ltx25MaxReady } from "./quality";
import { videoEngineStatus, videoMaxNotReadyReason } from "./ready";
import { videoAudienceOf, type GenerateVideoState } from "./tool";
import { VIDEO_FAILED_PREFIX, activeVideoJobsFor, doneVideoJobsFor, getVideoJobFor, startVideoEditJob, type EditRun, type ReferenceProgress, type ReferenceRecipe, type VideoJob } from "./jobs";
import { jobQueueCopy } from "@/lib/jobQueueCopy";
import { videoWaitLine } from "./waitLine";
import { fullViewForJob } from "@/lib/stack/fullView";
import { cancelOrDeleteVideo, fetchClip, getVideoJob as getStackVideoJob, StackVideoError, submitVideoIngredients } from "./stack";
import { checkPictureIsSheet, describeProvidedSheet, fitToSheetSize, type SheetCheck } from "./referenceSheetCheck";
import { REFERENCE_PHASE } from "./phaseLabel";
import { REFERENCE_SHEET_NOTE } from "./referenceSheets";

import { MAKE_REFERENCE_VIDEO_TOOL_ID } from "./referenceToolId";
export { MAKE_REFERENCE_VIDEO_TOOL_ID };
export const REFERENCE_VIDEO_SECONDS = 8;
export const MAX_REFERENCE_PICTURES = 6;
/** The Stack takes at most this many characters of prompt. */
export const REFERENCE_PROMPT_MAX = 2000;
const GENERATED = "Generated video: ";
/** Always in the generated paragraph: the video model speaks whenever the prompt allows it (a first live clip had a man shouting gibberish), so the prompt rules speech out. */
export const NO_DIALOGUE_SENTENCE = "No one speaks and there is no dialogue; the sound is natural ambient sound and light music only.";
/** Quoted speech the writer or the person's words carry is removed: a quoted line would be spoken (or shouted) in the clip. */
export function stripQuotedSpeech(text: string): string {
  return text.replace(/"[^"]*"|\u201c[^\u201d]*\u201d|\u00ab[^\u00bb]*\u00bb/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/\s+/g, " ").trim();
}
/** Always in the generated paragraph: the model must make one real shot, never show the sheet itself. */
export const FULL_FRAME_SENTENCE = "A single full-frame, photorealistic shot of one continuous scene, never showing the reference sheet or a split screen.";

export const makeReferenceVideoArgs = z.object({
  request: z.string().trim().min(3).max(2000).optional(),
  seconds: z.number().int().min(4).max(8).optional(),
  reuse_video: z.string().trim().min(1).max(120).optional(),
});

// The one plain line for each refusal (what went wrong, then what to do).
export const REFERENCE_NO_PICTURES_LINE = "I need pictures for that. Attach the people, objects or places you want in the video to your message, then ask again.";
export const REFERENCE_MINOR_LINE = "Videos from pictures are for adults on their own screen. Ask an adult in your home to help.";
export const REFERENCE_SCREEN_LINE = "Videos from pictures can be made in your own written chat. Open a chat, attach the pictures there and ask again.";
export const REFERENCE_BUSY_LINE = "You already have a video being made. Wait for it to finish, or stop it first.";
export const REFERENCE_ADAPTER_LINE = INGREDIENTS_FAILURE_COPY.ic_lora_missing;
export const REFERENCE_NO_SHEET_LINE = "I can't find the reference sheet of that video any more. Attach the pictures again and ask for a new video.";
export const REFERENCE_SHEET_FAILED_LINE = "I couldn't build a reference sheet from those pictures. Try again, or attach clearer pictures with one person, object or place in each.";
export const REFERENCE_SHEET_SAVE_LINE = "I couldn't save the reference sheet. Check that there is free space for files, then try again.";
export const REFERENCE_WORDS_LINE = "Tell me what should happen in the video, then I can make it from your pictures.";

// ---------------------------------------------------------------- test seams

// The sheet maker (cut-outs, faces, drawn views) is loaded when a sheet is built, never at import: the chat turn path imports this file, and the face models stay out of it (VISION-02c).
// The two shapes below are the sheet maker's own (films/sheetMaker.ts), kept here as plain types for the same reason.
export interface SheetPicture { bytes: Uint8Array; mediaType: string; name: string; role: PictureRole; look: string }
export interface MadeSheet { png: Uint8Array; description: string; panels: Array<{ name: string; view: string; slot: string }>; /** Plain sentences about what the sheet could not do (a picture left uncut, face models missing). */ notes?: string[] }
type SheetStep = { phase: "cut" | "draw"; done: number; total: number };
type SheetMaker = (pictures: ReadonlyArray<SheetPicture>, onStep?: (step: SheetStep) => void) => Promise<MadeSheet>;
const realSheetMaker: SheetMaker = async (pictures, onStep) => (await import("@/lib/films/sheetMaker")).makeSheetFromPictures(pictures, undefined, { drawViews: true, ...(onStep ? { onStep } : {}) });
let sheetMaker: SheetMaker = realSheetMaker;
/** Test seam: replaces the sheet maker (the real one needs the Stack's cut-out and face models). */
export function __setSheetMakerForTests(fn: SheetMaker | null): void { sheetMaker = fn ?? realSheetMaker; }
type SheetChecker = (bytes: Uint8Array) => Promise<SheetCheck>;
let sheetChecker: SheetChecker = checkPictureIsSheet;
export function __setSheetCheckerForTests(fn: SheetChecker | null): void { sheetChecker = fn ?? checkPictureIsSheet; }
type ParagraphWriter = (request: string, description: string) => Promise<string | null>;
let paragraphWriter: ParagraphWriter = writeParagraph;
export function __setParagraphWriterForTests(fn: ParagraphWriter | null): void { paragraphWriter = fn ?? writeParagraph; }

// ---------------------------------------------------------------- the prompt

const WRITER_SYSTEM = [
  "You write the video part of a prompt for a video model that is shown one reference sheet of several panels (people, objects, places).",
  "You are given the sheet's panel list and the person's request. Rewrite the request as ONE paragraph, at most 600 characters, that says who or what does what and where.",
  "Refer to each subject by its panel, for example \"the woman from the <panel name> panel\", with the panel name exactly as the sheet list writes it, so the model knows which picture is meant. Use only panels that are listed.",
  "Keep the person's meaning and details; add no new people, events or places. Describe positive facts only. Never write names of real people. Never write anything a person says: no quoted lines, no dialogue, no speech. Never read out or repeat writing, logos or numbers that appear on the pictures.",
  "Reply with the paragraph only, with no heading and no quotes.",
].join("\n");

async function writeParagraph(request: string, description: string): Promise<string | null> {
  const result = await completeBackground([
    { role: "system", content: WRITER_SYSTEM },
    { role: "user", content: `<sheet>\n${description}\n</sheet>\n\n<request>\n${request}\n</request>` },
  ], { temperature: 0.2, max_tokens: 260 });
  return result.ok ? result.text : null;
}

const oneParagraph = (text: string) => text.replace(/\s+/g, " ").trim();

/** The "Generated video" paragraph: the model's rewrite around the sheet panels, or the person's own words when it cannot be written; always ending with the full-frame sentence. */
export async function generatedParagraph(request: string, description: string): Promise<string> {
  let written: string | null = null;
  try { written = await paragraphWriter(request, description); } catch { written = null; }
  let paragraph = stripQuotedSpeech(oneParagraph(written ?? ""));
  if (!paragraph || paragraph.length > 900) paragraph = stripQuotedSpeech(oneParagraph(request)).slice(0, 900);
  paragraph = paragraph.replace(/[.\s]*$/, "") + ".";
  if (!paragraph.includes(FULL_FRAME_SENTENCE)) paragraph = `${paragraph} ${FULL_FRAME_SENTENCE}`;
  return paragraph.includes(NO_DIALOGUE_SENTENCE) ? paragraph : `${paragraph} ${NO_DIALOGUE_SENTENCE}`;
}

/** The whole prompt: the sheet text, a blank line, "Generated video: " and the paragraph, cut to the Stack's limit. The paragraph is kept whole (it is what the person asked for);
 * a sheet text that is too long loses its tail at a panel boundary. */
export function composePrompt(description: string, paragraph: string): string {
  const tail = `\n\n${GENERATED}${paragraph}`;
  if (description.length + tail.length <= REFERENCE_PROMPT_MAX) return `${description}${tail}`;
  const room = Math.max(0, REFERENCE_PROMPT_MAX - tail.length);
  const cut = description.slice(0, room);
  const boundary = Math.max(cut.lastIndexOf("). "), cut.lastIndexOf(". "));
  const kept = boundary > 40 ? cut.slice(0, boundary + 1) : cut.trimEnd();
  return `${kept}${tail}`.slice(0, REFERENCE_PROMPT_MAX);
}

// ---------------------------------------------------------------- sheets

type SheetProgress = (done: number, total: number, line: string) => void;
/** The plain sentence for each sub-step of step 1. */
const SHEET_LINES = { read: "Reading the pictures", cut: "Cutting people and objects out", draw: "Drawing the missing views", join: "Putting the sheet together" } as const;
/** The two steps' names, as the card shows them. */
export const REFERENCE_STEP_NAMES = ["Creating the reference sheet", "Creating the video"] as const;
/** What step 2 says while the Stack holds the clip without a worker running (the Stack's phase "waiting for memory"): plain words, no resource figures. */
export const REFERENCE_WAIT_LINE = "Waiting for the computer to have enough free room. It starts by itself, or tap Cancel.";
interface LoadedPicture { id: string; bytes: Uint8Array; mediaType: string }
interface BuiltSheet { png: Uint8Array; description: string; providedAsIs: boolean; panels: Array<{ name: string; view: string; slot: string; pictureIds: string[] }> }

/** The sheets for these pictures: pictures that already are sheets go through as they are (at most two sheets in all), the rest become one more sheet. Returns a plain line on failure. */
async function buildSheets(pictures: LoadedPicture[], progress: SheetProgress): Promise<{ ok: true; sheets: BuiltSheet[]; notes: string[] } | { ok: false; line: string }> {
  progress(0, 2 + 2 * pictures.length, SHEET_LINES.read);
  const checks: SheetCheck[] = [];
  for (const picture of pictures) checks.push(await sheetChecker(picture.bytes).catch(() => ({ isSheet: false, panels: [] })));
  const provided = pictures.flatMap((picture, index) => checks[index]!.isSheet ? [{ picture, check: checks[index]! }] : []).slice(0, 2);
  const providedIds = new Set(provided.map((item) => item.picture.id));
  const loose = pictures.filter((picture) => !providedIds.has(picture.id));
  // Sub-steps: reading, then a cut-out and a drawn view for each loose picture, then putting the sheet together.
  const total = loose.length && provided.length < 2 ? 2 + 2 * loose.length : 2;
  progress(0, total, SHEET_LINES.read);
  const notes: string[] = [];
  const sheets: BuiltSheet[] = [];
  for (const { picture, check } of provided) {
    try {
      sheets.push({ png: await fitToSheetSize(picture.bytes), description: describeProvidedSheet(check.panels), providedAsIs: true, panels: check.panels.map((panel) => ({ name: `${panel.kind} ${panel.position}`, view: panel.view, slot: panel.position, pictureIds: [picture.id] })) });
    } catch { return { ok: false, line: REFERENCE_SHEET_FAILED_LINE }; }
  }
  if (provided.length) notes.push(provided.length > 1 ? "Two of the pictures were already reference sheets, so they were used as provided." : "One picture was already a reference sheet, so it was used as provided.");
  if (loose.length && sheets.length < 2) {
    const read = await readPictureRoles(loose.map((picture) => picture.bytes));
    if (!read.ok) return { ok: false, line: read.line };
    progress(1, total, SHEET_LINES.cut);
    const sheetPictures: SheetPicture[] = loose.map((picture, index) => { const reading: PictureReading = read.readings[index]!; return { bytes: picture.bytes, mediaType: picture.mediaType, name: reading.name, role: reading.role, look: reading.look }; });
    let made: MadeSheet;
    const count = loose.length;
    try {
      made = await sheetMaker(sheetPictures, (step) => {
        if (step.phase === "cut") progress(1 + step.done, total, step.done >= count ? SHEET_LINES.draw : `${SHEET_LINES.cut} (${step.done + 1} of ${count})`);
        else progress(1 + count + Math.floor(count * step.done / Math.max(1, step.total)), total, `${SHEET_LINES.draw} (${Math.min(step.total, step.done + 1)} of ${step.total})`);
      });
    } catch { return { ok: false, line: REFERENCE_SHEET_FAILED_LINE }; }
    const source = (name: string) => { const lower = name.toLocaleLowerCase(); const hit = loose.filter((_, index) => { const own = sheetPictures[index]!.name.toLocaleLowerCase(); return lower === own || lower.startsWith(`${own} `); }).map((picture) => picture.id); return hit.length ? hit : loose.map((picture) => picture.id); };
    sheets.push({ png: made.png, description: made.description, providedAsIs: false, panels: made.panels.map((panel) => ({ name: panel.name, view: panel.view, slot: panel.slot, pictureIds: source(panel.name) })) });
    notes.push(...(made.notes ?? []));
  } else if (loose.length) notes.push("There was room for two sheets only, so the other pictures were left out.");
  if (!sheets.length) return { ok: false, line: REFERENCE_SHEET_FAILED_LINE };
  progress(total - 1, total, SHEET_LINES.join);
  return { ok: true, sheets, notes };
}

/** The text of several sheets as one: the first keeps "Reference sheet:", the second starts "Second reference sheet:". */
function joinDescriptions(sheets: ReadonlyArray<{ description: string }>): string {
  return sheets.map((sheet, index) => index === 0 ? sheet.description : sheet.description.replace(/^Reference sheet:/, "Second reference sheet:")).join(" ");
}

// ---------------------------------------------------------------- the job

interface Context { conversationId: string; turnId: string | null }

function loadSheetFiles(actor: PersonRow, ids: readonly string[]): Uint8Array[] | null {
  const files: Uint8Array[] = [];
  for (const id of ids) {
    const read = readAttachment(actor, id);
    if (!read.ok || !read.value.record.media_type.startsWith("image/")) return null;
    files.push(read.value.bytes);
  }
  return files;
}

/** The Stack work of one video from sheets. It never throws: a failure is one plain line. */
function runIngredients(sheets: Uint8Array[], recipe: ReferenceRecipe, actor: PersonRow): EditRun {
  // The job is sent as adult (this tool is adult-only), and the Stack answers an adult job's status and clip only with the full-view grant: without it the finished job read back as empty.
  const view = fullViewForJob("adult", actor);
  const failed = (why: string) => `${VIDEO_FAILED_PREFIX} ${why}`;
  const lineOf = (error: unknown) => error instanceof StackVideoError ? failed(error.message) : failed("It did not finish. Try again.");
  return async (signal, onProgress, hooks) => {
    let stackJob: string | null = null;
    // Step 2 of the card: the Stack's own state, in plain words.
    const clipStep = (percent: number, waiting: boolean, line: string) => hooks?.steps((progress) => { progress.step = 2; progress.sheet.done = progress.sheet.total; progress.clip = { percent, waiting, line }; });
    try {
      clipStep(0, false, "Sending the sheet to the video model");
      const form = new FormData();
      for (const [index, bytes] of sheets.entries()) form.append("sheet", new Blob([bytes as unknown as ArrayBuffer], { type: "image/png" }), `sheet-${index + 1}.png`);
      form.set("prompt", recipe.prompt);
      form.set("seconds", String(recipe.seconds));
      if (recipe.seed !== null) form.set("seed", String(recipe.seed));
      form.set("audience", "adult");
      form.set("timeout_ms", "1");
      const submitted = await submitVideoIngredients(form);
      stackJob = submitted.job;
      const read = async (clip: { seconds?: number | null; width?: number | null; height?: number | null; audio?: boolean; ms?: number }) => ({ ok: true as const, clip: { video: await fetchClip(submitted.job, view), seconds: clip.seconds ?? null, width: clip.width ?? null, height: clip.height ?? null, audio: clip.audio === true, ms: clip.ms ?? 0 } });
      if (submitted.done?.[0]?.url) return await read(submitted.done[0]);
      for (;;) {
        if (signal.aborted) { void cancelOrDeleteVideo(submitted.job); return { ok: false, line: failed("It did not finish. Try again.") }; }
        const job = await getStackVideoJob(submitted.job, view);
        if (job.state === "failed" || job.state === "cancelled") {
          const known = job.code && Object.prototype.hasOwnProperty.call(INGREDIENTS_FAILURE_COPY, job.code) ? INGREDIENTS_FAILURE_COPY[job.code as keyof typeof INGREDIENTS_FAILURE_COPY] : null;
          return { ok: false, line: failed(known ?? "It did not finish. Try again.") };
        }
        if (job.state === "done") {
          const clip = job.data[0];
          if (!clip) return { ok: false, line: failed("The video could not be read back. Try again.") };
          return await read(clip);
        }
        if (job.state === "queued") clipStep(0, true, stackWaitLine(job.phase, job.position));
        else clipStep(Math.max(0, Math.min(100, job.progress)), false, runningLine(job.phase, job.progress));
        onProgress?.(job.progress);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) { if (stackJob && signal.aborted) void cancelOrDeleteVideo(stackJob); return { ok: false, line: lineOf(error) }; }
  };
}

/** Step 2 while the Stack holds the clip: the Stack's phase (or its place in line) in the card's words. */
function stackWaitLine(phase: string | null, position: number | null): string {
  const hold = videoWaitLine(phase, "adult");
  if (hold) return hold;
  if (phase === "waiting for memory") return REFERENCE_WAIT_LINE;
  return jobQueueCopy("queued", "queue", position, null, "adult");
}
function runningLine(phase: string | null, progress: number): string {
  if (progress <= 0) return "Getting the video model ready";
  if (phase === "decoding") return "Finishing the frames";
  if (phase === "encoding") return "Putting the video together";
  return "Drawing the frames";
}

const startProgress = (step: 1 | 2): ReferenceProgress => ({ step, sheet: { done: step === 2 ? 1 : 0, total: 1, line: SHEET_LINES.read }, clip: { percent: 0, waiting: false, line: "Waiting for the sheet" } });

/** The synthetic source an edit job copies from: the words, size and seed only. */
function sourceFor(actor: PersonRow, context: Context, id: string, prompt: string, seconds: number, seed: number | null): VideoJob {
  const now = new Date().toISOString();
  return { id, personId: actor.id, conversationId: context.conversationId, turnId: context.turnId, companionId: null, kind: "edit", state: "done", stackJob: null, percent: 100, phase: null, position: null, prompt,
    request: { size: "768x448", seconds, seed, loras: [], source_file_id: null, audience: "adult" }, error: null, files: [], temporary: false, createdAt: now, updatedAt: now };
}

/** REFVIDEO-STEPS-01: the whole job from the pictures. The tool call returns at once; this is step 1 (read, cut out, draw views, put the sheet together, keep it) and then step 2 (the clip),
 * so the card shows each step with its own progress. A refusal or failure after the call returned ends the job with one plain line. */
function runFresh(actor: PersonRow, context: Context, loaded: LoadedPicture[], request: string, seconds: number, audienceBand: Parameters<typeof viewerOf>[1]): EditRun {
  return async (signal, onProgress, hooks) => {
    const failed = (line: string) => ({ ok: false as const, line });
    const sheetStep = (done: number, total: number, line: string) => hooks?.steps((progress) => { progress.step = 1; progress.sheet = { done, total, line }; });
    try {
      const built = await buildSheets(loaded, sheetStep);
      if (!built.ok) return failed(built.line);
      if (signal.aborted) return failed(`${VIDEO_FAILED_PREFIX} It did not finish. Try again.`);
      const description = joinDescriptions(built.sheets);
      const paragraph = await generatedParagraph(request, description);
      const prompt = composePrompt(description, paragraph);
      const promptRefusal = refuseVideoPrompt(prompt, { lane: "adult" });
      if (promptRefusal) return failed(VIDEO_REFUSAL_LINE[promptRefusal]);
      // The same input-side floor a photo gets, on what actually goes to the video model.
      for (const sheet of built.sheets) {
        const jpeg = new Uint8Array(await sharp(Buffer.from(sheet.png)).jpeg({ quality: 90 }).toBuffer());
        const screened = await screenInputImage(jpeg, request, viewerOf(actor, audienceBand));
        if (!screened.ok) return failed(screened.line);
      }
      if (signal.aborted) return failed(`${VIDEO_FAILED_PREFIX} It did not finish. Try again.`);
      // Kept files of the person, so the sheet stays with the video (and is shown on its card). Nothing is stored for a refused request above.
      const sheetFileIds: string[] = [];
      for (const [index, sheet] of built.sheets.entries()) {
        const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: sheet.png, provenance: `${REFERENCE_SHEET_NOTE}${JSON.stringify({ v: 1, provided: sheet.providedAsIs, index })}`, deduplicate: false, retention: "kept", name: built.sheets.length > 1 ? `Reference sheet ${index + 1}.png` : "Reference sheet.png" });
        if (!stored.ok) return failed(REFERENCE_SHEET_SAVE_LINE);
        sheetFileIds.push(stored.value.id);
      }
      const recipe: ReferenceRecipe = {
        v: 1, sheetFileIds, description, request: paragraph, prompt, seed: newSeed(), seconds, pictureFileIds: loaded.map((picture) => picture.id), providedAsIs: built.sheets.map((sheet) => sheet.providedAsIs),
        panels: built.sheets.flatMap((sheet, index) => sheet.panels.map((panel) => ({ name: panel.name, view: panel.view, slot: panel.slot, sheet: index, pictures: panel.pictureIds }))),
      };
      hooks?.recipe(recipe);
      const bytes = loadSheetFiles(actor, sheetFileIds);
      if (!bytes) return failed(REFERENCE_NO_SHEET_LINE);
      return await runIngredients(bytes, recipe, actor)(signal, onProgress, hooks);
    } catch { return failed(REFERENCE_SHEET_FAILED_LINE); }
  };
}

/** Starts the one clip job for a recipe. The synthetic source carries only what an edit job copies (the words, size, seed); the recipe rides on the job's request. */
function startFromRecipe(actor: PersonRow, context: Context, recipe: ReferenceRecipe, from: string): { ok: true; job: VideoJob } | { ok: false; line: string } {
  const bytes = loadSheetFiles(actor, recipe.sheetFileIds);
  if (!bytes) return { ok: false, line: REFERENCE_NO_SHEET_LINE };
  const source = sourceFor(actor, context, from, recipe.prompt, recipe.seconds, recipe.seed);
  const started = startVideoEditJob({ actor, conversationId: context.conversationId, turnId: context.turnId, temporary: false, source, edit: { from, change: "ingredients" }, run: runIngredients(bytes, recipe, actor), phase: REFERENCE_PHASE, adultOnly: false, request: { reference: recipe, quality: "detailed", tier: "max", refProgress: startProgress(2) } });
  return started.ok ? { ok: true, job: started.job } : { ok: false, line: started.line };
}

// ---------------------------------------------------------------- the recipe

/** The saved recipe of a video made from reference sheets (its sheets, words, seed and panels), or null for any other video or one that is not the person's. A copy: editing it changes nothing. */
export function getReferenceVideoRecipe(actor: PersonRow, jobId: string): ReferenceRecipe | null {
  const recipe = getVideoJobFor(actor, jobId)?.request.reference;
  return recipe ? (JSON.parse(JSON.stringify(recipe)) as ReferenceRecipe) : null;
}

/** The person's newest finished video made from sheets in this chat, for "same sheet, but ...". */
function newestReferenceVideo(actor: PersonRow, conversationId: string): VideoJob | null {
  return doneVideoJobsFor(actor, conversationId, false).find((job) => job.request.reference) ?? null;
}
/** Whether this chat holds a finished video made from sheets (the tool is then offered without new pictures). */
export function conversationHasReferenceVideo(actor: PersonRow, conversationId: string | null | undefined): boolean {
  return Boolean(conversationId && newestReferenceVideo(actor, conversationId));
}

const newSeed = () => Math.floor(Math.random() * 2_147_483_647);

/** Another take on a video made from sheets: the saved sheets and prompt, a new seed, no new cut-outs. */
export function anotherReferenceTake(actor: PersonRow, source: VideoJob): { ok: true; job: VideoJob } | { ok: false; line: string; status: 404 | 409 | 422 } {
  const recipe = getReferenceVideoRecipe(actor, source.id);
  if (!recipe || !source.conversationId) return { ok: false, line: REFERENCE_NO_SHEET_LINE, status: 404 };
  if (activeVideoJobsFor(actor) > 0) return { ok: false, line: REFERENCE_BUSY_LINE, status: 409 };
  const started = startFromRecipe(actor, { conversationId: source.conversationId, turnId: source.turnId }, { ...recipe, seed: newSeed() }, source.id);
  return started.ok ? started : { ok: false, line: started.line, status: started.line === REFERENCE_NO_SHEET_LINE ? 404 : 409 };
}

// ---------------------------------------------------------------- the tool

type ReferenceState = Pick<GenerateVideoState, "actor" | "temporary" | "conversationId" | "turnId" | "images"> & Partial<Pick<GenerateVideoState, "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan">>;
export interface RunReferenceVideoInput { state: ReferenceState; args: Record<string, unknown>; callId: string; spoken: boolean }

function refused(callId: string, args: Record<string, unknown>, line: string, why: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: MAKE_REFERENCE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${line}` }, data: { refused: why }, actions: [] } });
}

export async function runMakeReferenceVideoTurn(input: RunReferenceVideoInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const refuse = (line: string, why: string) => refused(callId, args, line, why);
  const parsed = makeReferenceVideoArgs.safeParse(args);
  if (!parsed.success) return outcomeOf({ callId, packageId: MAKE_REFERENCE_VIDEO_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: "bad_arguments", failureKind: "bad_arguments", durationMs: 0 });
  const { actor } = state;
  const reuse = parsed.data.reuse_video;
  const images = state.images ?? [];
  const request = parsed.data.request;
  if (!reuse && images.length === 0) return refuse(REFERENCE_NO_PICTURES_LINE, "no_pictures");
  if (!reuse && !request) return refuse(REFERENCE_WORDS_LINE, "no_words");
  // Who may make it: an adult on their own written chat screen (the same floor as a film).
  const audience = videoAudienceOf(state as Parameters<typeof videoAudienceOf>[0], input.spoken);
  if (laneOf(audience) !== "adult" || actor.role === "guest") return refuse(REFERENCE_MINOR_LINE, "minor");
  if (audience.spoken || audience.surface !== "chat" || state.temporary || !state.conversationId) return refuse(REFERENCE_SCREEN_LINE, "screen");
  const wordsRefusal = request ? refuseVideoPrompt(request, { lane: "adult" }) : null;
  if (wordsRefusal) return refuse(VIDEO_REFUSAL_LINE[wordsRefusal], wordsRefusal);
  // Max: every refusal here is one plain line before a picture is cut out or a sheet drawn.
  if (tierArgument({ person: actor, category: "video", arg: "max", band: audience.band }).line === MAX_NEEDS_ADMIN_LINE) return refuse(MAX_NEEDS_ADMIN_LINE, "max_needs_admin");
  const engine = await videoEngineStatus();
  if (!ltx25MaxReady(engine)) return refuse(videoMaxNotReadyReason(engine), "max_not_ready");
  if (engine?.qualities?.ltx25max?.ingredients === false) return refuse(REFERENCE_ADAPTER_LINE, "adapter_missing");
  if (activeVideoJobsFor(actor) > 0) return refuse(REFERENCE_BUSY_LINE, "already_making");
  const context: Context = { conversationId: state.conversationId, turnId: state.turnId };
  const seconds = parsed.data.seconds ?? REFERENCE_VIDEO_SECONDS;

  // Same sheet, new words (or a new take): no cut-outs, no drawn views.
  if (reuse) {
    const source = /^(latest|last|this|that)$/i.test(reuse) ? newestReferenceVideo(actor, state.conversationId) : getVideoJobFor(actor, reuse);
    const recipe = source ? getReferenceVideoRecipe(actor, source.id) : null;
    if (!source || !recipe || (source.conversationId !== state.conversationId)) return refuse(REFERENCE_NO_SHEET_LINE, "no_sheet");
    const paragraph = request ? await generatedParagraph(request, recipe.description) : recipe.request;
    const prompt = composePrompt(recipe.description, paragraph);
    const promptRefusal = refuseVideoPrompt(prompt, { lane: "adult" });
    if (promptRefusal) return refuse(VIDEO_REFUSAL_LINE[promptRefusal], promptRefusal);
    const started = startFromRecipe(actor, context, { ...recipe, request: paragraph, prompt, seconds, seed: newSeed() }, source.id);
    if (!started.ok) return refuse(started.line, started.line === REFERENCE_NO_SHEET_LINE ? "no_sheet" : "already_making");
    return outcomeOf({ callId, packageId: MAKE_REFERENCE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: replyText(recipe.sheetFileIds.length, ["The same reference sheet is used again; the sheet is shown with the video."]) }, data: { videoJobId: started.job.id, sheetFileIds: recipe.sheetFileIds }, actions: [] } });
  }

  // Fresh pictures: the same ownership checks a film gives its pictures.
  const loaded: LoadedPicture[] = [];
  try {
    for (const image of images.slice(0, MAX_REFERENCE_PICTURES)) { const picture = loadSource(actor, state.conversationId, image.id, false); loaded.push({ id: image.id, bytes: picture.bytes, mediaType: picture.mediaType }); }
  } catch (error) { return refuse(error instanceof Error && error.message ? error.message : "I couldn't open your pictures. Attach them again.", "pictures"); }
  // The sheet is built by the job itself (its step 1), so the call returns now and the card shows each step.
  const source = sourceFor(actor, context, "reference:new", request!, seconds, null);
  const started = startVideoEditJob({ actor, conversationId: state.conversationId, turnId: state.turnId, temporary: false, source, edit: { from: "reference:new", change: "ingredients" }, run: runFresh(actor, context, loaded, request!, seconds, audience.band), phase: REFERENCE_PHASE, adultOnly: false, request: { quality: "detailed", tier: "max", refProgress: startProgress(1) } });
  if (!started.ok) return refuse(started.line, "already_making");
  return outcomeOf({ callId, packageId: MAKE_REFERENCE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: replyText(null, []) }, data: { videoJobId: started.job.id }, actions: [] } });
}

function replyText(sheets: number | null, notes: readonly string[]): string {
  const lead = sheets === null
    ? "The video is being made in two steps that the video card below your reply shows with their own progress: first a reference sheet from the pictures, then the video. It takes about three minutes and appears there when it is ready."
    : `${sheets > 1 ? "The reference sheets are" : "The reference sheet is"} shown on the video card below your reply, and the video is being made from ${sheets > 1 ? "them" : "it"}. It takes about three minutes and appears there when it is ready.`;
  return [lead, "You have not seen the video: do not describe how it looks. Tell the person in one or two short sentences that the video is on its way.", ...notes].join(" ");
}
