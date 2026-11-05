// VIDEO-CHAT-01 (C2, C3, C4): the `edit_video` tool, the video twin of `edit_music`. Three changes remake a clip made here: another take (same
// words and choices, new seed), remix (the same recipe plus the fields the person changed) and make it max (the same clip at Max). Each one calls
// `makeVideoFor`, the one function the Create page's buttons call, so the gates, the level rules and the one-clip-at-a-time rule are the
// same in chat and on the page. Three more edit the finished clips themselves through the Stack's `media.edit` job: trim (cut a clip), join
// (put the person's own clips in order into one film, with a straight cut or a crossfade) and mix (lay a spoken line or a song over a clip and set
// the balance). `continue` takes the last frame of a finished clip through the Stack's `frame` op and starts a new clip from it with LTX-2.5's picture
// start (VIDEO-INPUTS-01); `retake` is not here. The model decides when a person wants one of these (rule 1); nothing here reads wording. The result is
// `data: { videoJobId }` like `generate_video`, so the same card follows the job. A failed tool tells the model only the failure kind
// (rule 6); a refusal keeps its own plain line.
import { likenessRefusal } from "@/lib/likeness";
import { z } from "zod";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { MAX_NEEDS_ADMIN_LINE, jobTier, tierArgument } from "@/lib/tiers";
import { LTX25_MAX_MODEL, etaWords, ltx25MaxPictureReady, ltx25MaxReady, ltx25PictureReady, makerOfModel } from "./quality";
import sharp from "sharp";
import { screenInputImage, viewerOf } from "@/lib/pictures/ageCheck";
import { videoEngineStatus, videoMaxNotReadyReason } from "./ready";
import { MINOR_MAKE_LINE, bodyOfVideoJob, makeVideoFor, type MakeVideoBody } from "./make";
import { laneOf } from "@/lib/pictures/lane";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { attachmentFilePath } from "@/lib/attachments";
import { existsSync } from "node:fs";
import { isRemoteStackSelected } from "@/lib/stackEngine";
import { videoJobLockState, LOCKED_START_LINE } from "@/lib/videos/lock";
import { activeVideoJobsFor, getVideoJobByFileFor, sourceVideoJob, startVideoEditJob, storeContinueFrame, type EditRun, type VideoJob, type VideoRequest } from "./jobs";
import { fetchClip, getVideoJob as getStackVideoJob, submitVideo } from "./stack";
import { CAPTION_POSITIONS, CROSSFADE_IN_STACK, DEFAULT_CROSSFADE_S, DEFAULT_MUSIC_LEVEL, DEFAULT_VOICE_LEVEL, JOIN_TRANSITIONS, MAX_CROSSFADE_S, MAX_JOIN_CLIPS, MIN_CROSSFADE_S, MIN_JOIN_CLIPS, MIX_LEVEL_IDS, VIDEO_ASPECTS, TRANSITION_KINDS, captionsOps, creditsOp, crossfadeProblem, frameOps, gradeOps, joinOps, lastFrameAt, mixOps, reframeOps, speedOps, titleCardOp, trimOps, trimRange } from "./editPlan";
import { runStackEdit, stageClipForStack, type EditFile } from "./stackEdit";
import { newItemMark, type MarkSource } from "@/lib/adultLock";
import { clipFileOf, clipMarkOf, editableClip, lineMark, ownTrackFile, speakLine, voiceChoice } from "./editGate";
import { VIDEO_LOOKS, VIDEO_RECIPES, VIDEO_VOICES } from "./recipes";
import { prepareVideoRerun } from "./rerun";
import { resolveStyles } from "./styleChoice";
import { ltx25LorasSupported } from "./loraWire";
import { videoAudienceOf, videoRefusalFor, type GenerateVideoState, type RunGenerateVideoInput } from "./tool";
import { getMediaProduction, listMediaProductions, updateMediaProduction } from "@/lib/mediaProductions";
import { getMediaSubject } from "@/lib/mediaSubjects";

export const EDIT_VIDEO_TOOL_ID = "edit_video";

const ids = <T extends { id: string }>(list: readonly T[]) => list.map((item) => item.id) as [string, ...string[]];

export const editVideoArgs = z.object({
  clip: z.string().trim().min(1).max(80).optional(),
  change: z.enum(["another_take", "remix", "make_it_max", "trim", "join", "film", "mix", "reframe", "grade", "speed", "captions", "title_card", "credits", "continue", "extend", "retake"]),
  production: z.string().trim().min(1).max(160).optional(),
  prompt: z.string().trim().min(3).max(1200).optional(),
  look: z.enum(ids(VIDEO_LOOKS)).optional(),
  camera: z.enum(ids(VIDEO_RECIPES)).optional(),
  voices: z.enum(ids(VIDEO_VOICES)).optional(),
  /** VIDEO-LORA-10: style names (at most two) the new clip is made with; an empty list takes the style off. Left out, a remix, another take and a continue keep the clip's own. */
  styles: z.array(z.string().trim().min(1).max(60)).max(2).optional(),
  strength: z.enum(["less", "normal", "more"]).optional(),
  tier: z.enum(["standard", "boost", "max"]).optional(),
  seconds: z.number().int().min(1).max(10).optional(),
  keep_seed: z.boolean().optional(),
  from_s: z.number().min(0).max(600).optional(),
  to_s: z.number().gt(0).max(600).optional(),
  clips: z.array(z.string().trim().min(1).max(80)).min(MIN_JOIN_CLIPS).max(MAX_JOIN_CLIPS).optional(),
  transition: z.string().optional(),
  transition_s: z.number().min(MIN_CROSSFADE_S).max(MAX_CROSSFADE_S).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  subtitle: z.string().trim().max(160).optional(),
  credits: z.array(z.object({ role: z.string().trim().max(40).optional(), name: z.string().trim().min(1).max(60) })).min(1).max(60).optional(),
  credits_title: z.string().trim().max(120).optional(),
  sound: z.enum(["voice", "music"]).optional(),
  line: z.string().trim().min(1).max(600).optional(),
  voice: z.string().trim().min(1).max(80).optional(),
  track: z.string().trim().min(1).max(80).optional(),
  level: z.enum(MIX_LEVEL_IDS).optional(),
  start_s: z.number().min(0).max(600).optional(),
  aspect: z.enum(VIDEO_ASPECTS).optional(),
  fill: z.enum(["crop", "blur"]).optional(),
  warmth: z.number().min(-1).max(1).optional(),
  brightness: z.number().min(-1).max(1).optional(),
  contrast: z.number().min(-1).max(1).optional(),
  saturation: z.number().min(-1).max(1).optional(),
  grain: z.number().min(0).max(1).optional(),
  vignette: z.number().min(0).max(1).optional(),
  factor: z.number().min(0.25).max(4).optional(),
  captions: z.array(z.object({ from_s: z.number().min(0).max(600), to_s: z.number().gt(0).max(600), text: z.string().trim().min(1).max(160) })).max(40).optional(),
  position: z.enum(CAPTION_POSITIONS).optional(),
}).superRefine((value, ctx) => {
  if (value.change === "film") { if (!value.production) ctx.addIssue({ code: "custom", path: ["production"], message: "A production is required" }); }
  else if (!value.clip) ctx.addIssue({ code: "custom", path: ["clip"], message: "A video is required" });
});

export const NO_CLIP_LINE = "I can't find that video. Ask for a new one, or open the video you mean and try again.";
export const WHAT_TO_CHANGE_LINE = "Tell me what to change: the words, the look, the camera move, the sound, the length or the level.";
export const NO_STYLE_LINE = "I can't find a style by that name. Ask for one from the styles you can use, or make the video without a style.";
export const NO_PICTURE_LINE = "The picture that video started from is not available any more, so I can't make it again. Ask for a new video.";
export const ALREADY_MAX_LINE = "That video is already made at Max.";
export const MAX_WORDS_ONLY_LINE = "Max cannot use a style, and a video that started from a picture cannot be made again at Max on this computer yet. I can make a new one from words at Max.";
export const NO_CLIPS_LINE = "I can't find one of those videos. Tell me which videos to join, from the ones you made here.";
export const JOIN_CLIPS_LINE = `Tell me ${MIN_JOIN_CLIPS} to ${MAX_JOIN_CLIPS} of your videos to join, in the order you want them.`;
export const MIX_SOUND_LINE = "Tell me what to put over the video: a line to say in a voice, or one of your songs.";
export const NO_TRACK_LINE = "I can't find that song. Pick one of your own songs or sound files, or ask for a voice line instead.";
export const NO_VOICE_LINE = "I don't know that voice. Pick one from your home's voices, or leave the voice out to use yours.";
export const SPEECH_FAILED_LINE = "I couldn't change that video. Home can't speak right now, so the line was not added. Try again in a minute.";
export const CROSSFADE_NOT_SUPPORTED_LINE = "Crossfades are not available yet. I can join the videos with a straight cut now. Ask me to do that if you like.";
export const CONTINUE_CHAT_LINE = "A video can only be continued from a chat. Open a chat, then ask again.";
export const CONTINUE_NOT_READY_LINE = "Continuing a video from its last picture is not ready on this computer yet. An admin can check Settings, Models and storage.";
export const CONTINUE_TRASH_LINE = "That video is in Trash. Restore it from Trash, then ask me to continue it.";
export const CONTINUE_BUSY_LINE = "You already have a video being made. Wait for it to finish, or stop it first.";
export const CONTINUE_FRAME_LINE = "I couldn't continue that video. The last picture could not be read from it. Try again.";
export const START_PAST_END_LINE = "That is after the video ends. Pick a start time inside it.";
export const MAX_EDIT_NOT_READY_LINE = "This computer cannot extend or retake videos yet. An admin can check Settings, Models and storage.";
export const MAX_EDIT_RANGE_LINE = "That time is outside the range this computer can use. Pick a time in range, then try again.";

export interface RunEditVideoInput { state: GenerateVideoState; args: Record<string, unknown>; callId: string; spoken: boolean }

const packageId = EDIT_VIDEO_TOOL_ID;

function refused(callId: string, args: Record<string, unknown>, line: string, why: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${line}` }, data: { refused: why }, actions: [] } });
}

function failed(callId: string, args: Record<string, unknown>, code: string, kind: "unavailable" | "errored" | "bad_arguments"): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0 });
}

/** Make it Max, the one definition the chat tool and the Create page's Make it Max button share: the checks (already Max, the Max grant, the Max model
 * ready, words only) and the body that makes the same clip again at Max with the same seed. Fills `body` in place when it is allowed. */
export async function makeItMaxBody(actor: PersonRow, band: Parameters<typeof tierArgument>[0]["band"], source: VideoJob, body: MakeVideoBody): Promise<{ ok: true } | { ok: false; line: string; why: string }> {
  if (body.tier === "max") return { ok: false, line: ALREADY_MAX_LINE, why: "already_max" };
  // The same grant check the tool and the Create page use; without it nothing is made.
  if (tierArgument({ person: actor, category: "video", arg: "max", band }).line === MAX_NEEDS_ADMIN_LINE) return { ok: false, line: MAX_NEEDS_ADMIN_LINE, why: "max_needs_admin" };
  // Max runs only when the Stack says its model is ready; otherwise one plain status line, never a silent Boost copy and never a raw error.
  const engine = await videoEngineStatus();
  if (!ltx25MaxReady(engine)) return { ok: false, line: videoMaxNotReadyReason(engine), why: "max_not_ready" };
  if ((source.request.source_file_id && !ltx25MaxPictureReady(engine)) || (source.request.loras.length > 0 && !ltx25LorasSupported(engine, LTX25_MAX_MODEL))) return { ok: false, line: MAX_WORDS_ONLY_LINE, why: "max_words_only" };
  body.tier = "max";
  // The same clip, made better: the same picture of the idea, so the seed stays.
  if (source.request.seed) body.seed = source.request.seed;
  return { ok: true };
}

export async function runEditVideo(input: RunEditVideoInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  if ((args.change === "join" || args.change === "film") && args.transition !== undefined && typeof args.transition === "string" && !(JOIN_TRANSITIONS as readonly string[]).includes(args.transition)) return refused(callId, args, "Choose one of the available transitions between the videos.", "bad_transition");
  if (Array.isArray(args.credits) && args.credits.length > 60) return refused(callId, args, "Credits can have up to 60 names. Shorten the list and try again.", "too_many_credits");
  if (Array.isArray(args.credits) && args.credits.some((line) => !line || typeof line !== "object" || typeof (line as { name?: unknown }).name !== "string" || !(line as { name: string }).name.trim() || (line as { name: string }).name.trim().length > 60 || ((line as { role?: unknown }).role !== undefined && (typeof (line as { role?: unknown }).role !== "string" || ((line as { role: string }).role.trim().length > 40))))) return refused(callId, args, "Each credit needs a name up to 60 characters and an optional role up to 40 characters.", "bad_credit_line");
  if (typeof args.title === "string" && args.title.trim().length > 120) return refused(callId, args, "A title can have up to 120 characters. Shorten it and try again.", "title_too_long");
  if (typeof args.subtitle === "string" && args.subtitle.trim().length > 160) return refused(callId, args, "A subtitle can have up to 160 characters. Shorten it and try again.", "subtitle_too_long");
  const parsed = editVideoArgs.safeParse(args);
  if (!parsed.success) return failed(callId, args, "bad_arguments", "bad_arguments");
  const value = parsed.data;
  if ((value.change === "join" || value.change === "film") && value.transition !== undefined && !(JOIN_TRANSITIONS as readonly string[]).includes(value.transition)) return refused(callId, args, "Choose one of the available transitions between the videos.", "bad_transition");
  if (value.change === "captions" && value.captions?.some((line) => line.to_s <= line.from_s)) return refused(callId, args, "Give me caption words with a start and end time for each line.", "bad_captions");
  const actor = state.actor as PersonRow;
  const audience = videoAudienceOf(state as Parameters<typeof videoAudienceOf>[0], input.spoken);
  // The surface and age gate, then the same screening any typed prompt gets (a remix's new words are screened like a first request).
  // A typed voice line is screened like a prompt, before any speech is made.
  const typed = value.change === "remix" || value.change === "continue" || value.change === "retake" ? value.prompt ?? "" : value.change === "mix" && value.sound === "voice" ? value.line ?? "" : "";
  const refusal = videoRefusalFor(audience, { prompt: typed });
  if (refusal) return refused(callId, args, refusal.line, refusal.why);
  { const likeness = likenessRefusal(actor, typed); if (likeness) return refused(callId, args, likeness, "household_likeness_off"); }

  const temporary = state.temporary === true || state.ephemeral === true;
  if (value.change === "continue" && laneOf(audience) !== "adult") return refused(callId, args, MINOR_MAKE_LINE, "minor");
  if (["extend", "retake", "trim", "join", "film", "mix", "reframe", "grade", "speed", "captions", "title_card", "credits"].includes(value.change)) {
    // Cutting, joining and mixing are for adults on their own screen, like making one: a child's turn passes the screen above but never reaches the editor.
    if (laneOf(audience) !== "adult") return refused(callId, args, MINOR_MAKE_LINE, "minor");
    // A crossfade needs a Stack step that does not exist yet; say so before any clip is read or any job starts.
    if ((value.change === "join" || value.change === "film") && value.transition === "crossfade" && !CROSSFADE_IN_STACK) return refused(callId, args, CROSSFADE_NOT_SUPPORTED_LINE, "not_supported");
    if (value.change === "captions" && value.captions?.some((line) => line.to_s <= line.from_s)) return refused(callId, args, "Give me caption words with a start and end time for each line.", "bad_captions");
    if (value.change === "film") return filmProduction(input, value, actor, temporary);
    if (value.change === "extend" || value.change === "retake") return extendOrRetake(input, value, actor, audience, temporary);
    return editFinishedClips(input, value, actor, temporary);
  }
  const continuing = value.change === "continue";
  const source = continuing ? ownClip(actor, state, value.clip!, temporary) : sourceVideoJob(actor, state.conversationId, value.clip!, temporary);
  if (!source) return refused(callId, args, NO_CLIP_LINE, "no_clip");
  // ADULT-LOCK-02 (design 3.7): a locked source needs an unlock first; nothing starts and nothing of it is named.
  if (videoJobLockState(actor, source) !== "open") return refused(callId, args, LOCKED_START_LINE, "locked");

  const body: MakeVideoBody = bodyOfVideoJob(source);
  // VIDEO-LORA-10: names the person said (never an id) become the records they may use; a locked or unknown style stops the edit with one plain line, and a clip
  // that kept its styles keeps them ("Continuing in the same style"). Make it Max, trim, join and mix take no new style.
  const restyles = value.styles !== undefined || value.strength !== undefined;
  if (restyles && value.change !== "remix" && value.change !== "another_take" && value.change !== "continue") return refused(callId, args, WHAT_TO_CHANGE_LINE, "nothing_to_change");
  if (value.styles !== undefined) {
    if (value.styles.length === 0) { delete body.styles; delete body.strength; }
    else {
      const picked = await resolveStyles({ audience, names: value.styles, ...(typeof state.utterance === "string" ? { utterance: state.utterance } : {}) });
      if (!picked.ok) return picked.locked ? refused(callId, args, LOCKED_START_LINE, "locked") : refused(callId, args, picked.line, picked.code);
      if (picked.unmatched.length > 0 || picked.adapters.length === 0) return refused(callId, args, NO_STYLE_LINE, "no_style");
      body.styles = picked.adapters.map((a) => a.id);
    }
  }
  if (value.strength !== undefined && body.styles?.length) body.strength = value.strength;
  // A clip that started from a picture (made here or an attached photo) starts from it again, through the same loader and input screening a Make another uses.
  let prepared: RunGenerateVideoInput["prepared"];
  let adultOnly = false;
  let adultLock: "on" | "off" = "off";
  if (continuing) {
    // The new clip starts from the last frame of this one, with the person's new words (else the old ones); level, look, camera and voices stay unless changed.
    if (value.prompt !== undefined) body.prompt = value.prompt;
    if (value.look !== undefined) body.look = value.look;
    if (value.camera !== undefined) body.recipe = value.camera;
    if (value.voices !== undefined) body.voices = value.voices;
    if (value.tier !== undefined) body.tier = value.tier;
    if (value.seconds !== undefined) body.seconds = value.seconds;
    const started = await continueFrom({ state, args, callId, actor, audience, source, body, temporary });
    if ("outcome" in started) return started.outcome;
    prepared = started.prepared;
    adultOnly = started.adultOnly;
    adultLock = started.adultLock;
  } else if (source.request.source_file_id) {
    const prep = source.conversationId
      ? await prepareVideoRerun({ actor, audience, conversationId: source.conversationId, temporary: source.temporary, prompt: value.change === "remix" ? value.prompt ?? source.prompt : source.prompt, sourceFileId: source.request.source_file_id, adapters: [], styleIds: [] })
      : null;
    if (!prep) return refused(callId, args, NO_PICTURE_LINE, "reference");
    if (!prep.ok) return refused(callId, args, prep.line, prep.code);
    if (prep.image) prepared = { image: prep.image, imageSource: prep.imageSource ?? "generated", sourceFileId: source.request.source_file_id, width: prep.width, height: prep.height };
  }
  if (value.change === "remix") {
    const changed = value.styles !== undefined || value.strength !== undefined || value.prompt !== undefined || value.look !== undefined || value.camera !== undefined || value.voices !== undefined || value.tier !== undefined || value.seconds !== undefined;
    if (!changed) return refused(callId, args, WHAT_TO_CHANGE_LINE, "nothing_to_change");
    if (value.prompt !== undefined) body.prompt = value.prompt;
    if (value.look !== undefined) body.look = value.look;
    if (value.camera !== undefined) body.recipe = value.camera;
    if (value.voices !== undefined) body.voices = value.voices;
    if (value.tier !== undefined) body.tier = value.tier;
    if (value.seconds !== undefined) body.seconds = value.seconds;
    if (value.keep_seed && source.request.seed) body.seed = source.request.seed;
  } else if (value.change === "make_it_max") {
    const max = await makeItMaxBody(actor, audience.band, source, body);
    if (!max.ok) return refused(callId, args, max.line, max.why);
  }

  const made = await makeVideoFor(actor, body, { audience, state, callId, ...(prepared ? { prepared } : {}), ...(adultOnly ? { adultOnly: true, adultLock } : {}) });
  if (!made.ok) {
    if (made.status === 503) return failed(callId, args, made.code, "unavailable");
    if (made.status === 502) return failed(callId, args, made.code, "errored");
    return refused(callId, args, made.error, made.code);
  }
  const job = made.job;
  const quality = job.request.quality ?? "quick";
  const madeAtMax = makerOfModel((job.request as { stackBody?: { model?: string } }).stackBody?.model, quality) === "ltx25max";
  const level = madeAtMax ? "max" : jobTier("video", job.request.tier, quality);
  const note = made.notice ? ` ${made.notice}` : "";
  return outcomeOf({
    callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: {
      reply: { text: `A new ${job.request.seconds} second ${continuing ? "video that starts where the first one ended" : "version of the video"}${body.styles?.length ? (value.styles === undefined ? " in the same style" : " in the style they asked for") : ""} is being made at ${level === "max" ? "Max" : level === "boost" ? "Boost" : "Standard"}; the first one is kept. It takes ${etaWords(quality, job.request.seconds, makerOfModel((job.request as { stackBody?: { model?: string } }).stackBody?.model, quality))} and appears below your reply when it is ready. You have not seen it or heard it: do not describe how it looks or sounds. Tell the person in one short sentence that it is on its way and about how long it takes.${note}` },
      data: { videoJobId: job.id },
      actions: [],
    },
  });
}

// ---------------------------------------------------------------- continue (the last frame, then a new clip from it)

type ContinueStart = { prepared: NonNullable<RunGenerateVideoInput["prepared"]>; adultOnly: boolean; adultLock: "on" | "off" } | { outcome: ToolExecutionOutcome };

/**
 * The picture a continued clip starts from: the last frame of the source, taken by the Stack's `frame` op, screened like any picture an adult hands
 * the tool, and kept as this chat's own picture so Make another can start from it again. Every refusal is one plain line: a clip in Trash, a Stack
 * that cannot start LTX-2.5 from a picture, another clip already being made. Nothing is sent to the Stack's video engine here; `makeVideoFor` does that
 * with the same gates every other make runs.
 */
async function continueFrom(input: { state: GenerateVideoState; args: Record<string, unknown>; callId: string; actor: PersonRow; audience: ReturnType<typeof videoAudienceOf>; source: VideoJob; body: MakeVideoBody; temporary: boolean }): Promise<ContinueStart> {
  const { state, args, callId, actor, audience, source, body, temporary } = input;
  const no = (line: string, why: string): ContinueStart => ({ outcome: refused(callId, args, line, why) });
  if (!state.conversationId) return no(CONTINUE_CHAT_LINE, "no_chat");
  const file = source.files[0];
  if (file && !source.temporary) {
    const row = db.select().from(attachments).where(eq(attachments.id, file.id)).get();
    if (row && row.deletedAt !== null) return no(CONTINUE_TRASH_LINE, "in_trash");
  }
  // Max starts from a picture only where the Stack says it can; a Max clip lowered to Boost or Standard still needs that level's own picture start.
  const engine = await videoEngineStatus();
  const ready = body.tier === "max" ? ltx25MaxPictureReady(engine) || ltx25PictureReady(engine) : ltx25PictureReady(engine);
  if (!ready) return no(CONTINUE_NOT_READY_LINE, "picture_start_not_ready");
  if (activeVideoJobsFor(actor) > 0) return no(CONTINUE_BUSY_LINE, "already_making");
  const clip = clipFileOf(actor, source);
  if (!clip) return no(NO_CLIP_LINE, "no_clip");
  const framed = await runStackEdit({ inputs: [clip], ops: frameOps(lastFrameAt(file?.seconds ?? source.request.seconds)), name: "frame.png" });
  if (!framed.ok) return no(framed.line, framed.code);
  let jpeg: Uint8Array;
  let width: number; let height: number;
  try {
    const decoded = sharp(Buffer.from(framed.bytes));
    const meta = await decoded.metadata();
    width = meta.width ?? framed.width ?? 0; height = meta.height ?? framed.height ?? 0;
    if (!width || !height) return no(CONTINUE_FRAME_LINE, "frame_unreadable");
    jpeg = new Uint8Array(await decoded.jpeg({ quality: 92 }).toBuffer());
  } catch { return no(CONTINUE_FRAME_LINE, "frame_unreadable"); }
  // The same input-side floor a photo gets (CSAM candidates, the viewer's lane); the source clip passed the finished-clip check, this is the picture itself.
  const screened = await screenInputImage(jpeg, body.prompt, viewerOf(actor, audience.band));
  if (!screened.ok) return no(screened.line, screened.code);
  // Never lower than the source: an adult-only clip makes an adult-only continuation.
  const mark = newItemMark([await clipMarkOf(source)], false);
  const adultOnly = mark.madeAudience === "adult-only";
  const stored = storeContinueFrame(actor, { conversationId: state.conversationId, turnId: state.turnId, temporary, jpeg, width, height, adultOnly, lock: mark.lock, sourceJobId: source.id });
  if (!stored.ok) return no(stored.line, "frame_not_saved");
  return { prepared: { image: Buffer.from(jpeg).toString("base64"), imageSource: "generated", sourceFileId: stored.id, width, height }, adultOnly, adultLock: mark.lock };
}

// ---------------------------------------------------------------- trim, join and mix (the Stack's media.edit)

type EditArgs = z.infer<typeof editVideoArgs>;

/** A finished clip of this person for an edit: "latest" or a video job id. A temporary chat uses only its own temporary clips and a saved chat never a temporary one. */
function ownClip(actor: PersonRow, state: GenerateVideoState, clip: string, temporary: boolean): VideoJob | null {
  const job = sourceVideoJob(actor, state.conversationId, clip, temporary);
  if (job && temporary && job.conversationId !== state.conversationId) return null;
  return editableClip(actor, job);
}

/** LTX25-EDIT-01: extend or retake a saved, finished clip directly from its attachment path. */
async function extendOrRetake(input: RunEditVideoInput, value: EditArgs, actor: PersonRow, audience: ReturnType<typeof videoAudienceOf>, temporary: boolean): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const refuse = (line: string, why: string) => refused(callId, args, line, why);
  if (laneOf(audience) !== "adult") return refuse(MINOR_MAKE_LINE, "minor");
  if (tierArgument({ person: actor, category: "video", arg: "max", band: audience.band }).line === MAX_NEEDS_ADMIN_LINE) return refuse(MAX_NEEDS_ADMIN_LINE, "max_needs_admin");
  const source = ownClip(actor, state, value.clip!, temporary);
  if (!source || temporary) return refuse(NO_CLIP_LINE, "no_clip");
  if (source.request.tier !== "max" && (source.request as VideoRequest & { stackBody?: { model?: string } }).stackBody?.model !== LTX25_MAX_MODEL && source.files[0]?.model !== LTX25_MAX_MODEL) return refuse(MAX_EDIT_NOT_READY_LINE, "source_not_max");
  const file = source.files[0];
  const row = file ? db.select().from(attachments).where(eq(attachments.id, file.id)).get() : null;
  if (!row || row.deletedAt !== null || row.ownerPersonId !== actor.id) return refuse(NO_CLIP_LINE, "no_clip");
  const sourceVideo = attachmentFilePath(row.storagePath);
  if (!existsSync(sourceVideo)) return refuse(NO_CLIP_LINE, "no_clip");
  if (isRemoteStackSelected()) return refuse(MAX_EDIT_NOT_READY_LINE, "stack_path_unavailable");
  const engine = await videoEngineStatus();
  const max = engine?.qualities?.ltx25max;
  const mode = value.change as "extend" | "retake";
  const supported = mode === "extend" ? max?.extend === true : max?.retake === true;
  const range = mode === "extend" ? max?.extend_seconds : max?.retake_from_seconds;
  if (!supported || !range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max) return refuse(MAX_EDIT_NOT_READY_LINE, "max_edit_not_ready");
  if (activeVideoJobsFor(actor) > 0) return refuse(CONTINUE_BUSY_LINE, "already_making");
  const requested = mode === "extend" ? value.seconds : value.from_s;
  if (requested === undefined || requested < range.min || requested > range.max) return refuse(MAX_EDIT_RANGE_LINE, "out_of_range");
  const prompt = mode === "retake" ? value.prompt ?? source.prompt : source.prompt;
  const run: EditRun = async (signal) => {
    // The Stack reads only folders Home declared: it gets a private copy of the clip, removed when the job ends.
    const staged = await stageClipForStack(sourceVideo);
    if (!staged) return { ok: false, line: MAX_EDIT_NOT_READY_LINE };
    try {
      const submitted = await submitVideo({ prompt, audience: "adult", model: LTX25_MAX_MODEL, tier: "max", size: "1024x576", seconds: source.request.seconds, timeout_ms: 1, source_video: staged.path, ...(mode === "extend" ? { extend_seconds: Math.round(Math.min(range.max, Math.max(range.min, requested))) } : { retake_from_seconds: requested }) });
      if (submitted.done?.[0]?.url) {
        const video = await fetchClip(submitted.job);
        const clip = submitted.done[0];
        return { ok: true, clip: { video, seconds: clip.seconds ?? null, width: clip.width ?? null, height: clip.height ?? null, audio: clip.audio === true, ms: clip.ms ?? 0 } };
      }
      for (;;) {
        if (signal.aborted) return { ok: false, line: "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." };
        const job = await getStackVideoJob(submitted.job);
        if (job.state === "failed" || job.state === "cancelled") return { ok: false, line: "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." };
        if (job.state === "done") {
          const clip = job.data[0];
          if (!clip) return { ok: false, line: "I couldn't change that video. The edited video could not be read back. Try again." };
          return { ok: true, clip: { video: await fetchClip(submitted.job), seconds: clip.seconds ?? null, width: clip.width ?? null, height: clip.height ?? null, audio: clip.audio === true, ms: clip.ms ?? 0 } };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch { return { ok: false, line: "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." }; }
    finally { staged.cleanup(); }
  };
  const started = startVideoEditJob({ actor, conversationId: state.conversationId, turnId: state.turnId, temporary: false, source, edit: { from: source.id, change: mode as "mix" }, run, adultOnly: true, adultLock: (await clipMarkOf(source)).lock });
  if (!started.ok) return refuse(started.line, "already_making");
  return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `A new version of the video is being made at Max; the first one is kept. Tell the person it is on its way.` }, data: { videoJobId: started.job.id }, actions: [] } });
}

async function filmProduction(input: RunEditVideoInput, value: EditArgs, actor: PersonRow, temporary: boolean): Promise<ToolExecutionOutcome> {
  const { callId, args } = input;
  if (actor.role === "guest") return refused(callId, args, "Productions aren't available to guest profiles.", "guest");
  const requested = value.production!;
  const visible = listMediaProductions(actor);
  const production = getMediaProduction(actor, requested) ?? (visible.filter((item) => item.title === requested).length === 1 ? visible.find((item) => item.title === requested)! : null);
  if (!production) return refused(callId, args, "I can't find that production. Choose one you can see.", "no_production");
  const shots = production.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
  const clipShots = shots.flatMap((shot, index) => shot.clip_file_id ? [{ shot, number: index + 1, fileId: shot.clip_file_id }] : []);
  if (clipShots.length < 2) return refused(callId, args, "Make at least two shots first", "too_few_shots");
  const sources: VideoJob[] = [];
  const files: EditFile[] = [];
  for (const item of clipShots) {
    const job = editableClip(actor, getVideoJobByFileFor(actor, item.fileId));
    const file = job ? clipFileOf(actor, job) : null;
    if (!job || !file) return refused(callId, args, `Shot ${item.number} is not a finished video you can edit.`, "shot_not_editable");
    sources.push(job); files.push(file);
  }
  const credits = production.cast.flatMap((entry) => {
    const subject = getMediaSubject(actor, entry.subject_id);
    return subject ? [{ role: entry.role.slice(0, 40), name: subject.name.slice(0, 60) }] : [];
  });
  credits.push({ role: "Made with", name: "MaiPai" });
  return editFinishedClips(input, { ...value, change: "film" }, actor, temporary, { production, sources, files, credits });
}

async function editFinishedClips(input: RunEditVideoInput, value: EditArgs, actor: PersonRow, temporary: boolean, film?: { production: import("@/lib/mediaProductions").Production; sources: VideoJob[]; files: EditFile[]; credits: Array<{ role: string; name: string }> }): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  let sources: VideoJob[];
  if (film) { sources = film.sources; }
  else if (value.change === "join") {
    if (!value.clips || value.clips.length < MIN_JOIN_CLIPS) return refused(callId, args, JOIN_CLIPS_LINE, "join_clips");
    const found = value.clips.map((clip) => ownClip(actor, state, clip, temporary));
    if (found.some((job) => job === null)) return refused(callId, args, NO_CLIPS_LINE, "no_clip");
    sources = found as VideoJob[];
  } else {
    const one = ownClip(actor, state, value.clip!, temporary);
    if (!one) return refused(callId, args, NO_CLIP_LINE, "no_clip");
    sources = [one];
  }
  const first = sources[0]!;
  const files = film ? film.files : sources.map((job) => clipFileOf(actor, job));
  if (files.some((file) => file === null)) return refused(callId, args, NO_CLIP_LINE, "no_clip");
  const clipFiles = files as EditFile[];
  const seconds = first.files[0]?.seconds ?? null;

  let inputs: EditFile[];
  let ops: import("./stackEdit").EditOp[];
  let spoken: { line: string; voice: string } | null = null;
  // Never lower than the sources: any adult-only clip, an adult-only track or an adult line makes the edit adult-only.
  const marks: MarkSource[] = await Promise.all(sources.map(clipMarkOf));
  let describe: string;
  if (value.change === "trim") {
    const range = trimRange({ from_s: value.from_s, to_s: value.to_s }, seconds);
    if (!range.ok) return refused(callId, args, range.line, "bad_cut");
    inputs = clipFiles; ops = trimOps(range.from, range.to);
    describe = `cut to ${range.from} to ${range.to} seconds`;
  } else if (value.change === "join" || value.change === "film") {
    const crossfade = value.transition === "crossfade";
    const transition = (value.transition ?? (film ? "fade" : "cut")) as (typeof JOIN_TRANSITIONS)[number];
    const duration = value.transition_s ?? DEFAULT_CROSSFADE_S;
    if (crossfade) {
      const tooShort = crossfadeProblem(sources.map((job) => job.files[0]?.seconds ?? null), duration);
      if (tooShort) return refused(callId, args, tooShort, "crossfade_too_short");
    }
    const videoSeconds = sources.map((job) => job.files[0]?.seconds ?? job.request.seconds ?? null);
    const baseLength = videoSeconds.every((n) => n !== null) ? videoSeconds.reduce((sum, n) => sum + (n ?? 0), 0) - (transition === "cut" ? 0 : (sources.length - 1) * duration) : videoSeconds.reduce<number>((sum, n) => sum + (n ?? 0), 0);
    const title = film?.production.title ?? value.title;
    const subtitle = film ? film.production.summary.trim().slice(0, 160) || undefined : value.subtitle;
    const creditLines = film?.credits ?? value.credits;
    const added = (title ? 3 : 0) + (creditLines ? Math.max(3, Math.ceil((creditLines.length * 2 + (value.credits_title ? 2 : 0)) / 2)) : 0);
    if (baseLength + added > 600) return refused(callId, args, "That film would be longer than 10 minutes. Use shorter videos or fewer title and credit lines.", "film_too_long");
    inputs = clipFiles; ops = joinOps(transition, duration);
    if (title) ops.unshift(titleCardOp(title, subtitle, "start"));
    if (creditLines) ops.push(creditsOp(creditLines, value.credits_title));
    describe = `${sources.length} videos joined in order${transition !== "cut" ? `, with a ${duration} second ${transition} between them` : ""}${title ? ", with a title" : ""}${creditLines ? ", with rolling credits" : ""}`;
  } else if (value.change === "reframe") {
    if (!value.aspect) return refused(callId, args, "Tell me the shape you want: vertical, square or widescreen.", "missing_aspect");
    inputs = [clipFiles[0]!]; ops = reframeOps(value.aspect, value.fill ?? "crop"); describe = "reframed";
  } else if (value.change === "grade") {
    const grade = { brightness: value.brightness, contrast: value.contrast, saturation: value.saturation, warmth: value.warmth, grain: value.grain, vignette: value.vignette };
    const changes = Object.fromEntries(Object.entries(grade).filter(([, v]) => v !== undefined));
    if (!Object.keys(changes).length) return refused(callId, args, "Tell me what to change in the look, such as warmth, contrast or grain.", "nothing_to_grade");
    inputs = [clipFiles[0]!]; ops = gradeOps(changes); describe = "colour and texture adjusted";
  } else if (value.change === "speed") {
    if (value.factor === undefined) return refused(callId, args, "Tell me how fast to make it, from quarter speed to four times speed.", "missing_speed");
    inputs = [clipFiles[0]!]; ops = speedOps(value.factor); describe = `speed changed to ${value.factor}x`;
  } else if (value.change === "captions") {
    if (!value.captions?.length || value.captions.some((line) => line.to_s <= line.from_s)) return refused(callId, args, "Give me caption words with a start and end time for each line.", "bad_captions");
    inputs = [clipFiles[0]!]; ops = captionsOps(value.captions, value.position ?? "bottom"); describe = "captions added";
  } else if (value.change === "title_card" || value.change === "credits") {
    const clipLength = seconds ?? first.request.seconds;
    const added = value.change === "title_card" ? (value.title ? 3 : 0) : (value.credits ? Math.max(3, Math.ceil((value.credits.length * 2 + (value.credits_title ? 2 : 0)) / 2)) : 0);
    if (value.change === "title_card" && !value.title) return refused(callId, args, "Tell me the title to put on the video.", "missing_title");
    if (value.change === "credits" && !value.credits?.length) return refused(callId, args, "Tell me the names to put in the credits.", "missing_credits");
    if (clipLength + added > 600) return refused(callId, args, "That film would be longer than 10 minutes. Use a shorter video or fewer credit lines.", "film_too_long");
    inputs = [clipFiles[0]!];
    ops = value.change === "title_card" ? [titleCardOp(value.title!, value.subtitle, "start")] : [creditsOp(value.credits!, value.credits_title)];
    describe = value.change === "title_card" ? "title added" : "rolling credits added";
  } else {
    const start = value.start_s ?? 0;
    if (seconds !== null && start >= seconds) return refused(callId, args, START_PAST_END_LINE, "start_past_end");
    if (value.sound === "voice") {
      if (!value.line) return refused(callId, args, MIX_SOUND_LINE, "nothing_to_mix");
      const voice = await voiceChoice(actor, value.voice);
      if (!voice.ok) return refused(callId, args, NO_VOICE_LINE, "no_voice");
      spoken = { line: value.line, voice: voice.voice };
      const lined = await lineMark(value.line);
      if (lined) marks.push(lined);
      inputs = [clipFiles[0]!]; // the spoken line joins in the run, so the answer does not wait for the speech
      ops = mixOps(value.level ?? DEFAULT_VOICE_LEVEL, start, true);
      describe = "your line laid over it";
    } else if (value.sound === "music") {
      if (!value.track) return refused(callId, args, MIX_SOUND_LINE, "nothing_to_mix");
      const track = ownTrackFile(actor, value.track, temporary, state.conversationId);
      if (!track) return refused(callId, args, NO_TRACK_LINE, "no_track");
      if (track.mark.madeAudience === "adult-only") marks.push(track.mark);
      inputs = [clipFiles[0]!, track.file];
      ops = mixOps(value.level ?? DEFAULT_MUSIC_LEVEL, start, false);
      describe = "your song laid under it";
    } else return refused(callId, args, MIX_SOUND_LINE, "nothing_to_mix");
  }

  const edit: NonNullable<VideoRequest["edit"]> = { from: first.id, change: value.change as "trim" | "join" | "mix", ...((value.change === "join" || value.change === "film") ? { with: sources.slice(1).map((job) => job.id) } : {}) };
  const run: EditRun = async (signal) => {
    const files = [...inputs];
    if (spoken) {
      const line = await speakLine(spoken.line, spoken.voice);
      if (!line) return { ok: false, line: SPEECH_FAILED_LINE };
      files.push(line);
    }
    const made = await runStackEdit({ inputs: files, ops: ops!, name: "edited.mp4", signal });
    return made.ok ? { ok: true, clip: { video: made.bytes, seconds: made.seconds, width: made.width, height: made.height, audio: made.audio, ms: made.ms } } : { ok: false, line: made.line };
  };
  const mark = newItemMark(marks, false);
  const started = startVideoEditJob({ actor, conversationId: state.conversationId, turnId: state.turnId, temporary, source: first, edit, run, adultOnly: mark.madeAudience === "adult-only", adultLock: mark.lock, ...(film && actor.id === film.production.owner_person_id ? { onSaved: (fileId: string) => { const current = getMediaProduction(actor, film.production.id); if (current) updateMediaProduction(actor, current.id, { finished_cut_file_ids: [...current.finished_cut_file_ids, fileId] }); } } : {}) });
  if (!started.ok) return refused(callId, args, started.line, "already_making");
  return outcomeOf({
    callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: {
      reply: { text: `A new version of the video (${describe}) is being made; the first one is kept. It takes under a minute and appears below your reply when it is ready. You have not seen it or heard it: do not describe how it looks or sounds. Tell the person in one short sentence that it is on its way.` },
      data: { videoJobId: started.job.id },
      actions: [],
    },
  });
}
