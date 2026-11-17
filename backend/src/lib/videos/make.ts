// VIDEO-CREATE-01: "Make a video" on the Create page. One entry point for the page's action (`/api/plugins/video/actions/make`) and the
// plain route (`POST /api/videos/make`). It holds no generation logic of its own: after the same gate the other routes use, it calls
// `runGenerateVideo`, the one definition the chat tool also runs, as the person's own screen with no chat behind it.
import type { PersonRow } from "@/types";
import { runGenerateVideo, type GenerateVideoState, type RunGenerateVideoInput } from "./tool";
import { HOUSEHOLD_WAITING_LIMIT, MAX_TAKES_BY_TIER, getVideoJobFor, householdActiveVideoJobs, markAnotherTake, type VideoJob } from "./jobs";
import { videoLookFor, videoRecipeFor, videoVoicesFor } from "./recipes";
import { MAX_NEEDS_ADMIN_LINE, tierArgument } from "@/lib/tiers";
import { speakerAgeBand } from "@/lib/ageBand";
import { laneOf } from "@/lib/pictures/lane";
import { videoDenial, VIDEO_DENIAL_LINE, type VideoAudience } from "./policy";
import { loadLibraryPicture } from "./jobs";
import { LOCKED_START_LINE } from "./lock";
import { resolveStyles, strengthWord } from "./styleChoice";
import type { StyleStrength } from "@/lib/loras/promptPlan";
import { screenInputImage, viewerOf } from "@/lib/pictures/ageCheck";
import sharp from "sharp";
import { fillTemplateBlanks, getTemplate, templateBlanks, videoTemplateSettings } from "@/lib/media/templates";

/** The most takes one press of Generate makes (the Takes chip offers 1 to 4; a level may cap lower, `MAX_TAKES_BY_TIER`). */
export const MAX_TAKES = 8;
export const MINOR_MAKE_LINE = "Making videos on the Create page is for adults. Ask an adult in your home to help.";

export interface MakeVideoBody { prompt: string; orientation?: "landscape" | "portrait"; seconds?: number; tier?: "standard" | "boost" | "max"; recipe?: string; look?: string; voices?: string; cast?: string[]; line?: string; loop?: boolean; template?: string; /** The words for the template's blanks (`{{name|Label|example}}`), by blank name; a blank left out uses its example. */ blanks?: Record<string, string>; /** A Library picture the person owns (VIDEO-CREATE-02): the clip starts from it. */ start_frame?: string; /** A second Library picture the clip ends on (needs a start_frame and a maker that reports end_image). */ end_frame?: string; /** TAKES-01: how many takes of this prompt to make (1 to 8; the level caps it). */ takes?: number; /** VIDEO-LORA-09: the styles chosen (ids the picker lists, at most two), read again through the person's own access; with Less, Normal or More. */ styles?: string[]; strength?: StyleStrength; /** Keep this seed (a Remix that keeps the picture's luck); left out, the clip gets a new one. */ seed?: number; }
/** Who is asking: a chat turn passes its own audience and state so the clip lands on that chat; the Create page passes neither. */
export interface MakeVideoContext { audience?: VideoAudience; state?: GenerateVideoState; callId?: string; prepared?: RunGenerateVideoInput["prepared"]; /** The new clip is adult-only whatever its words say (continue from an adult-only clip). */ adultOnly?: boolean; /** The source clip's Adult lock (design 3.10); absent means on. */ adultLock?: "on" | "off"; parent?: VideoJob; /** TAKES-01: the first clip of the set this one is a take of. */ takeOf?: string }
export type MakeVideoResult = { ok: true; job: VideoJob; /** One plain line when the length was cut to fit the level, else null. */ notice: string | null } | { ok: false; status: 403 | 404 | 422 | 502 | 503; error: string; code: string };

/** The audience of the Create page: the signed-in person on their own written screen. */
export function makeAudienceOf(actor: PersonRow): VideoAudience {
  return { actor, band: speakerAgeBand(actor, new Date()), surface: "chat", surfaceClass: "written", spoken: false };
}

/** Read what the page sent: a form sends text for every field, so words and numbers are taken as typed. Returns a plain error line when a value is unusable. */
export function readMakeBody(raw: Record<string, unknown>): { ok: true; body: MakeVideoBody } | { ok: false; error: string } {
  // A row action leaves `{name}` in place for a field the person never filled, and the camera-move picker has a "none" option; both mean not given.
  const notGiven = (value: unknown): boolean => typeof value === "string" && (/^\{[a-z_]+\}$/.test(value.trim()) || value.trim().toLowerCase() === "none");
  raw = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, notGiven(value) ? "" : value]));
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const template = typeof raw.template === "string" ? raw.template.trim() : "";
  const line = typeof raw.line === "string" ? raw.line : "";
  const effectivePrompt = prompt.length >= 3 ? prompt : line ? "A close-up of the person talking to the camera, looking natural." : prompt;
  if ((effectivePrompt.length < 3 && !template) || effectivePrompt.length > 1200) return { ok: false, error: "Describe the video in 3 to 1200 characters, then try again." };
  const text = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
  const body: MakeVideoBody = { prompt: effectivePrompt };
  if (template) body.template = template;
  // The Create page sends each blank as its own top-level `blank_<name>` argument.
  const flatBlanks = Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.startsWith("blank_") && typeof value === "string" && String(value).trim()).map(([key, value]) => [key.slice(6), String(value).trim().slice(0, 300)]));
  if (Object.keys(flatBlanks).length) body.blanks = flatBlanks;
  if (raw.blanks !== undefined && raw.blanks !== "") {
    if (!raw.blanks || typeof raw.blanks !== "object" || Array.isArray(raw.blanks) || Object.values(raw.blanks).some((value) => typeof value !== "string")) return { ok: false, error: "Fill in the template's words, then try again." };
    body.blanks = Object.fromEntries(Object.entries(raw.blanks).map(([key, value]) => [key, notGiven(value) ? "" : String(value).trim().slice(0, 300)]));
  }
  if (raw.loop === true || raw.loop === "true") body.loop = true;
  if (line) { if (line.length > 1200) return { ok: false, error: "Type a line up to 1200 characters, then try again." }; body.line = line; }
  const castValue = raw.cast;
  const cast = Array.isArray(castValue) ? castValue.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean) : typeof castValue === "string" && castValue.trim() ? [castValue.trim()] : [];
  if (cast.length) body.cast = cast;
  const orientation = text(raw.orientation);
  if (orientation) {
    if (orientation !== "landscape" && orientation !== "portrait") return { ok: false, error: "Choose landscape or portrait for the shape, or leave it empty." };
    body.orientation = orientation;
  }
  const secondsRaw = typeof raw.seconds === "number" ? raw.seconds : typeof raw.seconds === "string" && raw.seconds.trim() !== "" ? Number(raw.seconds) : undefined;
  if (secondsRaw !== undefined) {
    if (!Number.isFinite(secondsRaw) || secondsRaw < 1 || secondsRaw > 30) return { ok: false, error: "Choose a length from 1 to 30 seconds, or leave it empty." };
    body.seconds = Math.round(secondsRaw);
  }
  const tier = text(raw.tier);
  if (tier) {
    if (tier !== "standard" && tier !== "boost" && tier !== "max") return { ok: false, error: "Choose Standard, Boost or Max for the level, or leave it empty." };
    body.tier = tier;
  }
  const recipe = typeof raw.recipe === "string" ? raw.recipe.trim() : "";
  if (recipe) {
    if (!videoRecipeFor(recipe)) return { ok: false, error: "That camera move is not in the list. Use a name from the list on this page, or leave it empty." };
    body.recipe = recipe;
  }
  const look = typeof raw.look === "string" ? raw.look.trim() : "";
  if (look) {
    if (!videoLookFor(look)) return { ok: false, error: "That look is not in the list. Use a name from the list on this page, or leave it empty." };
    body.look = look;
  }
  const voices = typeof raw.voices === "string" ? raw.voices.trim() : "";
  if (voices) {
    if (!videoVoicesFor(voices)) return { ok: false, error: "That voices choice is not in the list. Use a name from the list on this page, or leave it empty." };
    body.voices = voices;
  }
  // The Camera cards send `camera` (a recipe id); `recipe` stays accepted for the chat tool and Another take. The camera wins when both are given.
  const camera = typeof raw.camera === "string" ? raw.camera.trim() : "";
  if (camera) {
    if (!videoRecipeFor(camera)) return { ok: false, error: "That camera move is not in the list. Use a name from the list on this page, or leave it empty." };
    body.recipe = camera;
  }
  // VIDEO-LORA-09: the picker sends style ids (a list, or a comma-separated text from a plain form) and Less, Normal or More. Which ids are real and allowed is decided later, never here.
  // The picker has one Styles choice and one Characters choice (`style`, `character`); `styles` is the plain list the route and the tools use.
  const styleList = [...(Array.isArray(raw.styles) ? raw.styles : typeof raw.styles === "string" ? raw.styles.split(",") : []), raw.style, raw.character];
  const styles = [...new Set(styleList.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => v !== "" && !/^\{[a-z_]+\}$/.test(v)))];
  if (styles.length > 2) return { ok: false, error: "Two styles at a time is the most. Pick one or two, then try again." };
  if (styles.some((id) => id.length > 80)) return { ok: false, error: "That style isn't available any more. Choose another style, or make the video without one." };
  if (styles.length > 0) {
    body.styles = styles;
    const strength = strengthWord(raw.strength);
    if (strength) body.strength = strength;
  }
  // An empty Picture slot leaves `{start_frame}` in place, which `notGiven` already turned into "".
  const startFrame = typeof raw.start_frame === "string" ? raw.start_frame.trim() : "";
  if (startFrame) {
    if (startFrame.length > 200) return { ok: false, error: "Choose a picture from your Library, or leave the Picture slot empty." };
    body.start_frame = startFrame;
  }
  const endFrame = typeof raw.end_frame === "string" ? raw.end_frame.trim() : "";
  if (endFrame) {
    if (endFrame.length > 200) return { ok: false, error: "Choose a picture from your Library for the end, or leave the End slot empty." };
    if (!startFrame) return { ok: false, error: "The end picture needs a start picture too. Add the start picture, or clear the end one." };
    if (endFrame === startFrame) return { ok: false, error: "The end picture must be different from the start picture. Choose another, or clear the end one." };
    body.end_frame = endFrame;
  }
  // TAKES-01: an empty Takes chip is one take.
  const takesRaw = typeof raw.takes === "number" ? raw.takes : typeof raw.takes === "string" && raw.takes.trim() !== "" ? Number(raw.takes) : undefined;
  if (takesRaw !== undefined) {
    if (!Number.isInteger(takesRaw) || takesRaw < 1 || takesRaw > MAX_TAKES) return { ok: false, error: `Choose 1 to ${MAX_TAKES} takes, or leave it empty.` };
    if (takesRaw > 1) body.takes = takesRaw;
  }
  // ONE-COMPOSER-2026-11-13: the From a picture and Animate pages make a clip from a picture, so they ask for one; an empty slot gets one plain line, nothing starts.
  if ((raw.need_picture === true || raw.need_picture === "true") && !startFrame) return { ok: false, error: "Pick a picture first. Press the picture button in the box, choose one, then try again." };
  return { ok: true, body };
}

export async function makeVideoFor(actor: PersonRow, body: MakeVideoBody, context: MakeVideoContext = {}): Promise<MakeVideoResult> {
  const audience = context.audience ?? makeAudienceOf(actor);
  // Create is for adults on their own screen; nobody under adult is a maker here, whatever the household switch for them says.
  const denial = videoDenial(audience);
  if (denial === "minor" || (denial === null && laneOf(audience) !== "adult")) return { ok: false, status: 403, error: MINOR_MAKE_LINE, code: "minor" };
  if (denial) return { ok: false, status: 403, error: VIDEO_DENIAL_LINE[denial], code: denial };
  let templateStyles: string[] = [];
  if (body.template) {
    const template = getTemplate(body.template);
    if (!template || template.kind !== "video" || (template.audience !== "all-ages" && audience.band !== "adult")) return { ok: false, status: 422, error: "That video template is not available. Choose another template or make a video without one.", code: "template_unavailable" };
    const settings = videoTemplateSettings()[template.id];
    if (!settings) return { ok: false, status: 422, error: "That video template is not available. Choose another template or make a video without one.", code: "template_unavailable" };
    templateStyles = template.styles;
    const blanks = templateBlanks(template.prompt);
    if (blanks.some((blank) => blank.name.startsWith("photo_")) && !body.start_frame) return { ok: false, status: 422, error: "This template needs your own photo. Add one as the Start picture, then make the video.", code: "photo" };
    if (blanks.some((blank) => blank.name.startsWith("cast_")) && !(body.cast && body.cast.length > 0)) return { ok: false, status: 422, error: "This template needs a person from your cast. Pick one in Cast, then try again.", code: "cast" };
    const recipe = fillTemplateBlanks(template.prompt, body.blanks);
    body = { ...body, prompt: `${recipe}${body.prompt.trim() && body.prompt !== template.prompt ? `\n\nAdditional direction: ${body.prompt.trim()}` : ""}`, seconds: body.seconds && body.seconds !== 5 && body.seconds !== 10 ? body.seconds : settings.seconds, look: body.look && body.look !== "natural" && body.look !== "warm" ? body.look : settings.look ?? body.look, recipe: body.recipe && body.recipe !== "none" ? body.recipe : settings.camera ?? body.recipe, orientation: body.orientation && body.orientation !== "landscape" ? body.orientation : settings.orientation ?? body.orientation, tier: body.tier && body.tier !== "standard" ? body.tier : settings.tier ?? body.tier, styles: [...new Set([...(body.styles ?? []), ...templateStyles])] };
  }
  // A level this person may not use is refused with one plain line (the chat tool lowers it and says so instead).
  if (body.tier && tierArgument({ person: actor, category: "video", arg: body.tier, band: audience.band }).line === MAX_NEEDS_ADMIN_LINE) {
    return { ok: false, status: 422, error: MAX_NEEDS_ADMIN_LINE, code: "max_needs_admin" };
  }
  // VIDEO-CREATE-02 (U3): a Start frame is a picture in the person's own Library. It gets the same input-side screening as an attached photo
  // (the prompt and the viewer's band) before the Stack is asked; an unknown or someone else's id is one plain 404 line.
  let startFrame: { id: string; base64: string; width: number | null; height: number | null } | undefined;
  if (body.start_frame && !context.prepared) {
    const photo = loadLibraryPicture(actor, body.start_frame);
    if (!photo.ok) return { ok: false, status: 404, error: photo.line, code: "start_frame_gone" };
    const screened = await screenInputImage(photo.bytes, body.prompt, viewerOf(actor, audience.band));
    if (!screened.ok) return { ok: false, status: 422, error: screened.line, code: screened.code };
    let { width, height } = photo;
    if (!width || !height) {
      try { const meta = await sharp(Buffer.from(photo.bytes)).metadata(); width = meta.width ?? null; height = meta.height ?? null; } catch { /* the shape stays what the person chose */ }
    }
    startFrame = { id: photo.id, base64: photo.base64, width, height };
  }
  // The End picture gets the same screening as the Start picture; the tool loads it again by id for the Stack.
  if (body.end_frame && !context.prepared) {
    const end = loadLibraryPicture(actor, body.end_frame);
    if (!end.ok) return { ok: false, status: 404, error: end.line, code: "end_frame_gone" };
    const screenedEnd = await screenInputImage(end.bytes, body.prompt, viewerOf(actor, audience.band));
    if (!screenedEnd.ok) return { ok: false, status: 422, error: screenedEnd.line, code: screenedEnd.code };
  }
  // VIDEO-LORA-09: a style the person may not use, a locked one and a missing one each stop the clip here with one plain line, before anything is read or started.
  if (body.styles && body.styles.length > 0) {
    const styled = await resolveStyles({ audience, ids: body.styles });
    if (!styled.ok) return styled.locked ? { ok: false, status: 403, error: LOCKED_START_LINE, code: "locked" } : { ok: false, status: 422, error: styled.line, code: styled.code };
  }
  const outcome = await runGenerateVideo({
    ...(body.styles && body.styles.length > 0 ? { styleIds: body.styles } : {}),
    state: context.state ?? { actor, persona: null, conversationId: null, turnId: null, temporary: false },
    args: { prompt: body.line ? `${body.prompt} The person says: "${body.line}"` : body.prompt, ...(body.cast ? { cast: body.cast } : {}), ...(body.seed ? { seed: body.seed } : {}), ...(body.orientation ? { orientation: body.orientation } : {}), ...(body.seconds ? { seconds: body.seconds } : {}), ...(body.tier ? { tier: body.tier } : {}), ...(body.recipe ? { recipe: body.recipe } : {}), ...(body.look ? { look: body.look } : {}), ...(body.voices ? { voices: body.voices } : {}), ...(body.loop ? { loop: true } : {}), ...(body.styles?.length && body.strength ? { strength: body.strength } : {}), ...(body.styles?.length ? { styles: body.styles } : {}), ...(body.template ? { template: body.template } : {}), ...(body.end_frame ? { end_frame: body.end_frame } : {}) },
    ...(context.takeOf ? { takeOf: context.takeOf } : {}),
    callId: context.callId ?? "make", spoken: false, audience, ...(context.adultOnly ? { adultOnly: true, ...(context.adultLock ? { adultLock: context.adultLock } : {}) } : {}), ...(context.prepared ? { prepared: context.prepared } : startFrame ? { prepared: { image: startFrame.base64, imageSource: "uploaded" as const, sourceFileId: startFrame.id, width: startFrame.width, height: startFrame.height } } : {}),
  });
  const data = outcome.result?.data as { videoJobId?: string; refused?: string } | undefined;
  if (outcome.status === "succeeded" && data?.videoJobId) {
    const job = getVideoJobFor(actor, data.videoJobId);
    if (job) { if (context.parent) markAnotherTake(job, context.parent); return { ok: true, job, notice: job.request.create?.note ?? null }; }
  }
  if (outcome.status === "succeeded") {
    // A refusal keeps its own line in the reply, after the instruction to the model; the person reads the line alone.
    const line = (outcome.result?.reply?.text ?? "").replace(/^No (?:new )?video was (?:made|started)\. Say this to the person in your own words and keep its meaning:\s*/, "").trim();
    return { ok: false, status: data?.refused === "not_ready" ? 503 : 422, error: line || "That video could not be started. Change the words and try again.", code: data?.refused ?? "refused" };
  }
  if (outcome.failureKind === "bad_arguments") return { ok: false, status: 422, error: "Describe the video in 3 to 1200 characters, then try again.", code: "bad_arguments" };
  return { ok: false, status: outcome.failureKind === "unavailable" ? 503 : 502, error: outcome.detail ?? "The video could not be made. Try again in a minute.", code: outcome.errorCode ?? "failed" };
}

/**
 * VIDEO-CREATE-01 (V1b): Another take on a clip made on the Create page (no chat behind it). The same words and the same choices
 * (shape, length, level, camera move, look, voices, Start frame) go through `makeVideoFor`, so the age and surface gate, the level rules and the
 * one-clip-at-a-time rule are the ones every other make uses; the new job gets a new random seed.
 */
/** The choices of a stored clip, as the body that makes it again (shape, length, level, camera move, look, voices): one place for Another take, Remix and Make it Max. */
export function bodyOfVideoJob(source: VideoJob): MakeVideoBody {
  const [w, h] = source.request.size.split("x").map(Number);
  const tier = source.request.tier ?? (source.request.quality === "detailed" ? "boost" : "standard");
  const kept = source.request.create ?? {};
  return {
    prompt: source.prompt,
    orientation: w && h && h > w ? "portrait" : "landscape",
    seconds: source.request.seconds,
    tier,
    ...(kept.recipe ? { recipe: kept.recipe } : {}),
    ...(kept.look ? { look: kept.look } : {}),
    ...(kept.voices ? { voices: kept.voices } : {}),
    // VIDEO-LORA-09: Another take, Remix, Make it Max and continue keep the clip's styles ("Continuing in the same style"); a style that is gone stops the new clip with a plain line.
    ...(source.request.loras.length > 0 ? { styles: [...source.request.loras], ...(kept.strength ? { strength: kept.strength } : {}) } : {}),
  };
}

/** Another take on a clip: the same words and choices through `makeVideoFor`, so the gates, level rules and one-at-a-time rule are the ones every make uses; the new job gets a new random seed. */
export async function anotherTakeFor(actor: PersonRow, source: VideoJob, context: MakeVideoContext = {}): Promise<MakeVideoResult> {
  // A Create-page clip that started from a Library picture keeps it (chat clips keep theirs through `prepareVideoRerun`).
  const start = !source.conversationId && source.kind === "animate" && source.request.source_file_id ? { start_frame: source.request.source_file_id } : {};
  const made = await makeVideoFor(actor, { ...bodyOfVideoJob(source), ...start }, context);
  // CREATOR-02: the new clip's creation record names this clip's record as its parent.
  if (made.ok) markAnotherTake(made.job, source);
  return made;
}

/** TAKES-01: the Create page's Generate. One take is exactly `makeVideoFor`. More makes the first through it, then each other take with a new seed, queued through the one household
 * queue and tagged as a take of the first (`anotherOf`, so each finished clip's creation record names the first as its parent). The level caps the count and a full queue refuses the set. */
export async function makeTakesFor(actor: PersonRow, body: MakeVideoBody, context: MakeVideoContext = {}): Promise<MakeVideoResult & { ids?: string[] }> {
  const takes = body.takes ?? 1;
  const { takes: _unused, ...single } = body;
  if (takes <= 1) return makeVideoFor(actor, single, context);
  const tier = body.tier ?? "standard";
  const cap = MAX_TAKES_BY_TIER[tier];
  if (takes > cap) return { ok: false, status: 422, error: `${tier === "standard" ? "Standard" : tier === "boost" ? "Boost" : "Max"} makes up to ${cap} takes at once. Choose ${cap} or fewer, then try again.`, code: "too_many_takes" };
  if (householdActiveVideoJobs() + takes > HOUSEHOLD_WAITING_LIMIT) return { ok: false, status: 422, error: "Too many videos are waiting right now. Make fewer takes, or try again when some have finished.", code: "queue_full" };
  const first = await makeVideoFor(actor, single, context);
  if (!first.ok) return first;
  const ids = [first.job.id];
  for (let i = 1; i < takes; i += 1) {
    // A new seed for each take (left out of the body, the tool rolls one), the first clip as the parent.
    const next = await makeVideoFor(actor, single, { ...context, parent: first.job, takeOf: first.job.id });
    if (!next.ok) return { ...first, notice: `${first.notice ? `${first.notice} ` : ""}Made ${ids.length} of ${takes} takes. ${next.error}`, ids };
    ids.push(next.job.id);
  }
  return { ...first, ids };
}
