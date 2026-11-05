// VIDEO-CREATE-01: "Make a video" on the Create page. One entry point for the page's action (`/api/plugins/videos/actions/make`) and the
// plain route (`POST /api/videos/make`). It holds no generation logic of its own: after the same gate the other routes use, it calls
// `runGenerateVideo`, the one definition the chat tool also runs, as the person's own screen with no chat behind it.
import type { PersonRow } from "@/types";
import { runGenerateVideo, type GenerateVideoState, type RunGenerateVideoInput } from "./tool";
import { getVideoJobFor, type VideoJob } from "./jobs";
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

export const MINOR_MAKE_LINE = "Making videos on the Create page is for adults. Ask an adult in your home to help.";

export interface MakeVideoBody { prompt: string; orientation?: "landscape" | "portrait"; seconds?: number; tier?: "standard" | "boost" | "max"; recipe?: string; look?: string; voices?: string; /** A Library picture the person owns (VIDEO-CREATE-02): the clip starts from it. */ start_frame?: string; /** VIDEO-LORA-09: the styles chosen (ids the picker lists, at most two), read again through the person's own access; with Less, Normal or More. */ styles?: string[]; strength?: StyleStrength; /** Keep this seed (a Remix that keeps the picture's luck); left out, the clip gets a new one. */ seed?: number; }
/** Who is asking: a chat turn passes its own audience and state so the clip lands on that chat; the Create page passes neither. */
export interface MakeVideoContext { audience?: VideoAudience; state?: GenerateVideoState; callId?: string; prepared?: RunGenerateVideoInput["prepared"]; /** The new clip is adult-only whatever its words say (continue from an adult-only clip). */ adultOnly?: boolean; /** The source clip's Adult lock (design 3.10); absent means on. */ adultLock?: "on" | "off" }
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
  if (prompt.length < 3 || prompt.length > 1200) return { ok: false, error: "Describe the video in 3 to 1200 characters, then try again." };
  const text = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
  const body: MakeVideoBody = { prompt };
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
  return { ok: true, body };
}

export async function makeVideoFor(actor: PersonRow, body: MakeVideoBody, context: MakeVideoContext = {}): Promise<MakeVideoResult> {
  const audience = context.audience ?? makeAudienceOf(actor);
  // Create is for adults on their own screen; nobody under adult is a maker here, whatever the household switch for them says.
  const denial = videoDenial(audience);
  if (denial === "minor" || (denial === null && laneOf(audience) !== "adult")) return { ok: false, status: 403, error: MINOR_MAKE_LINE, code: "minor" };
  if (denial) return { ok: false, status: 403, error: VIDEO_DENIAL_LINE[denial], code: denial };
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
  // VIDEO-LORA-09: a style the person may not use, a locked one and a missing one each stop the clip here with one plain line, before anything is read or started.
  if (body.styles && body.styles.length > 0) {
    const styled = await resolveStyles({ audience, ids: body.styles });
    if (!styled.ok) return styled.locked ? { ok: false, status: 403, error: LOCKED_START_LINE, code: "locked" } : { ok: false, status: 422, error: styled.line, code: styled.code };
  }
  const outcome = await runGenerateVideo({
    ...(body.styles && body.styles.length > 0 ? { styleIds: body.styles } : {}),
    state: context.state ?? { actor, persona: null, conversationId: null, turnId: null, temporary: false },
    args: { prompt: body.prompt, ...(body.seed ? { seed: body.seed } : {}),  ...(body.orientation ? { orientation: body.orientation } : {}), ...(body.seconds ? { seconds: body.seconds } : {}), ...(body.tier ? { tier: body.tier } : {}), ...(body.recipe ? { recipe: body.recipe } : {}), ...(body.look ? { look: body.look } : {}), ...(body.voices ? { voices: body.voices } : {}), ...(body.styles?.length && body.strength ? { strength: body.strength } : {}) },
    callId: context.callId ?? "make", spoken: false, audience, ...(context.adultOnly ? { adultOnly: true, ...(context.adultLock ? { adultLock: context.adultLock } : {}) } : {}), ...(context.prepared ? { prepared: context.prepared } : startFrame ? { prepared: { image: startFrame.base64, imageSource: "uploaded" as const, sourceFileId: startFrame.id, width: startFrame.width, height: startFrame.height } } : {}),
  });
  const data = outcome.result?.data as { videoJobId?: string; refused?: string } | undefined;
  if (outcome.status === "succeeded" && data?.videoJobId) {
    const job = getVideoJobFor(actor, data.videoJobId);
    if (job) return { ok: true, job, notice: job.request.create?.note ?? null };
  }
  if (outcome.status === "succeeded") {
    // A refusal keeps its own line in the reply, after the instruction to the model; the person reads the line alone.
    const line = (outcome.result?.reply?.text ?? "").replace(/^No (?:new )?video was (?:made|started)\. Say this to the person in your own words and keep its meaning:\s*/, "").trim();
    return { ok: false, status: 422, error: line || "That video could not be started. Change the words and try again.", code: data?.refused ?? "refused" };
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
  return makeVideoFor(actor, { ...bodyOfVideoJob(source), ...start }, context);
}
