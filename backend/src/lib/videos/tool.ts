// VIDEO-GEN-05: the `generate_video` tool inside a chat turn. The model decides when a person asked for a video
// (rule 1); this file never reads wording to decide that. It runs only after the turn's gates passed (policy.ts,
// checked again at the policy node and here: age and surface gates outrank every rule, rule 0), starts a Stack
// job, and returns at once with a short line for the model to relay. The clip itself arrives on the card (chat
// VideoToolRender) when the job finishes, so a two-minute render never holds the answer.
import { and, desc, eq, like, or } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import type { PersonRow } from "@/types";
import type { TurnState, ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import { videoAdaptersFor, matchVideoAdapter, withVideoTriggerWords } from "./adapters";
import { CLIP_POSTER_NOTE, GENERATED_PICTURE_NOTE, latestTemporaryPosterId, loadGeneratedReference, loadUploadedPhoto, plainVideoFailure, startVideoJob } from "./jobs";
import { promptRefusalLineFor, screenInputImage, viewerOf } from "@/lib/pictures/ageCheck";
import { CHILD_NEGATIVE_PROMPT, CHILD_NO_PHOTOS_LINE, CHILD_VIDEO_LIMIT_LINE, forceCartoon, kidsDailyVideos, laneOf, releaseKid, reserveKid, videoModelForLane, videosMadeToday } from "@/lib/pictures/lane";

const KID_MAX_SECONDS = 3;
import { refuseVideoPrompt, stackAudienceFor, videoAdapterAudiencesFor, videoDenial, VIDEO_DENIAL_LINE, VIDEO_REFUSAL_LINE, type VideoAudience, type VideoDenial } from "./policy";
import type { PromptRefusal } from "@/lib/pictures/policy";
import { videoEngineStatus, videoStatusReady } from "./ready";
import { allowedQuality } from "@/lib/tiers";
import { householdVideoQuality } from "./policy";
import { chooseVideoQuality, detailedVideoReady, etaWords, isVideoQuality, qualityOfBase, VIDEO_QUALITY_NOTE_LINE, VIDEO_SIZES_BY_QUALITY } from "./quality";
import { StackVideoError } from "./stack";

export const GENERATE_VIDEO_TOOL_ID = "generate_video";

export const VIDEO_SIZES: Record<string, string> = { landscape: "832x480", portrait: "480x832" };

/** The audience a turn presents to the video policy. */
export function videoAudienceOf(state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan">, spoken: boolean): VideoAudience {
  const surfaceClass = state.planBasis?.surfaceClass ?? "spoken";
  return {
    actor: state.actor,
    band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId),
    surface: state.surface,
    surfaceClass,
    spoken: spoken || surfaceClass !== "written",
  };
}

export type VideoCallRefusal = { kind: "denied"; why: VideoDenial; line: string } | { kind: "prompt"; why: PromptRefusal; line: string } | { kind: "child"; why: "photos" | "daily_limit"; line: string };

/** The `from_picture` word for a photo the person attached to this message. */
export const ATTACHED_PHOTO = "attached";
const isAttached = (value: unknown): boolean => typeof value === "string" && value.trim().toLowerCase() === ATTACHED_PHOTO;

/** The refusal for this call, or null: the surface and age gate first, then the two absolute lines on the prompt. */
export function videoRefusalFor(audience: VideoAudience, args: Record<string, unknown>): VideoCallRefusal | null {
  const denial = videoDenial(audience);
  if (denial) return { kind: "denied", why: denial, line: VIDEO_DENIAL_LINE[denial] };
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  const style = typeof args.style === "string" ? args.style : "";
  const refused = refuseVideoPrompt(`${prompt} ${style}`, { lane: laneOf(audience) });
  if (refused) return { kind: "prompt", why: refused, line: promptRefusalLineFor(refused, "video", audience.actor, audience.band, `${prompt} ${style}`, VIDEO_REFUSAL_LINE[refused]) };
  return null;
}

/** The newest picture this conversation's Stack made for this person (a generated picture, else a clip's poster), or null. */
export function latestGeneratedPictureId(actor: PersonRow, conversationId: string): string | null {
  const row = db.select({ id: attachments.id }).from(attachments)
    .where(and(eq(attachments.conversationId, conversationId), eq(attachments.ownerPersonId, actor.id), or(like(attachments.provenance, `${GENERATED_PICTURE_NOTE}%`), like(attachments.provenance, `${CLIP_POSTER_NOTE}%`))))
    .orderBy(desc(attachments.createdAt), desc(attachments.hlc)).get();
  return row?.id ?? null;
}

export interface RunGenerateVideoInput {
  state: Pick<TurnState, "actor" | "persona" | "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan" | "conversationId" | "turnId" | "temporary" | "ephemeral" | "images"> & Partial<Pick<TurnState, "utterance">>;
  args: Record<string, unknown>;
  callId: string;
  spoken: boolean;
}

function failed(callId: string, args: Record<string, unknown>, code: string, kind: "unavailable" | "errored" | "bad_arguments", detail?: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0, ...(detail ? { detail } : {}) });
}

/** The line the model relays after a refusal (a policy refusal is not a failed tool: it keeps its own fixed reply). */
function refused(callId: string, args: Record<string, unknown>, refusal: VideoCallRefusal): ToolExecutionOutcome {
  return outcomeOf({
    callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${refusal.line}` }, data: { refused: refusal.why }, actions: [] },
  });
}

const PHOTO_ATTACH_LINE = "Attach one photo to your message.";

export async function runGenerateVideo(input: RunGenerateVideoInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const audience = videoAudienceOf(state, input.spoken);
  const refusal = videoRefusalFor(audience, args);
  if (refusal) return refused(callId, args, refusal);

  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (prompt.length < 3) return failed(callId, args, "bad_arguments", "bad_arguments");
  const engine = await videoEngineStatus();
  if (!videoStatusReady(engine)) return failed(callId, args, "no_engine", "unavailable", "no video model is installed on the Stack");

  const temporary = state.temporary === true || state.ephemeral === true;
  const actor = state.actor as PersonRow;
  // KIDS-CREATE-01: a child's clip is a short cartoon of a safe thing, made from words or from their own cartoon; never from a photo, never a
  // style, with a daily limit. One short friendly line when it cannot be done.
  const lane = laneOf(audience);
  const kid = lane === "child";
  if (kid && isAttached(args.from_picture)) return refused(callId, args, { kind: "child", why: "photos", line: CHILD_NO_PHOTOS_LINE });
  if (kid && videosMadeToday(actor) + 1 > kidsDailyVideos()) return refused(callId, args, { kind: "child", why: "daily_limit", line: CHILD_VIDEO_LIMIT_LINE });

  // A clip can start from a picture this home's Stack made ("latest" or an id), or from a photo the person attached to this message.
  let image: string | undefined;
  let imageSource: "generated" | "uploaded" = "generated";
  let sourceFileId: string | null = null;
  let portrait = args.orientation === "portrait";
  const from = typeof args.from_picture === "string" ? args.from_picture.trim() : "";
  const refuseWith = (line: string) => refused(callId, args, { kind: "child", why: "photos", line });
  if (isAttached(from)) {
    const attached = state.images ?? [];
    if (attached.length !== 1) return refuseWith(PHOTO_ATTACH_LINE);
    const photo = loadUploadedPhoto(actor, state.conversationId, attached[0]!.id, temporary);
    if (!photo.ok) return refuseWith(photo.line);
    // The input-side floor: CSAM candidate screening and the stricter minor lane checks.
    const screened = await screenInputImage(photo.bytes, prompt, viewerOf(actor, audience.band));
    if (!screened.ok) return refuseWith(screened.line);
    image = photo.base64; imageSource = "uploaded"; sourceFileId = photo.id;
    if (photo.width && photo.height) portrait = photo.height > photo.width;
  } else if (from) {
    const id = /^(latest|last|this|that)$/i.test(from) ? (temporary ? latestTemporaryPosterId(actor, state.conversationId) : latestGeneratedPictureId(actor, state.conversationId)) : from;
    const ref = id ? loadGeneratedReference(actor, state.conversationId, id, temporary) : null;
    if (!ref || !ref.ok) {
      return outcomeOf({
        callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
        result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${ref && !ref.ok ? ref.line : "I can animate a picture made here or a photo you attach. Ask me to make a picture first, or attach a photo."}` }, data: { refused: "reference" }, actions: [] },
      });
    }
    image = ref.base64;
    sourceFileId = ref.id;
    if (ref.width && ref.height) portrait = ref.height > ref.width;
  }

  // Only a LoRA this person may use right now can match; the model never sees the library.
  const available = await videoAdaptersFor(videoAdapterAudiencesFor(audience));
  const named = typeof args.style === "string" ? args.style.trim() : "";
  const adapter = named && !kid ? matchVideoAdapter(available, named) : null;
  const styleNote = named && !adapter ? " The style they named is not in the library, so the video was made without it; say so briefly." : "";
  // VIDEO-LTX-01: Quick or Detailed. A style made for one model decides; a length past five seconds needs Detailed; else what was asked for, else the household's setting.
  const choice = chooseVideoQuality({ requested: isVideoQuality(args.quality) ? allowedQuality(state.actor as PersonRow, "video", args.quality, audience.band) : undefined, household: allowedQuality(state.actor as PersonRow, "video", householdVideoQuality(), audience.band), style: adapter, seconds: typeof args.seconds === "number" ? args.seconds : undefined, engine, hasPicture: image !== undefined, quickOnly: lane !== "adult" || allowedQuality(actor, "video", "detailed", audience.band) === "quick" });
  // A style made for Detailed cannot be used without Detailed: say so rather than start a clip the Stack would refuse.
  if (adapter && qualityOfBase(adapter.base_model) === "detailed" && !detailedVideoReady(engine)) {
    return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "No video was made. Say this to the person in your own words and keep its meaning: That style only works with Detailed videos, which are not on this computer yet. An admin can get them in Settings, Models and storage, or I can make the video without the style." }, data: { refused: "style_needs_detailed" }, actions: [] } });
  }
  if (image !== undefined && adapter && qualityOfBase(adapter.base_model) === "detailed") {
    return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "No video was made. Say this to the person in your own words and keep its meaning: That style only works with Detailed videos, and a Detailed video cannot start from a picture yet. I can animate the picture without the style, or make a Detailed video in that style from words." }, data: { refused: "style_needs_detailed" }, actions: [] } });
  }
  const seconds = kid ? Math.min(choice.seconds, KID_MAX_SECONDS) : choice.seconds;
  const size = VIDEO_SIZES_BY_QUALITY[choice.quality][portrait ? "portrait" : "landscape"];
  const qualityNote = choice.note ? ` ${VIDEO_QUALITY_NOTE_LINE[choice.note]}` : choice.announce ? " This one is a Detailed video, with sound and speech; say so in one short sentence." : "";
  const lengthNote = choice.shortened ? ` The most this kind makes is ${seconds} seconds, so it is ${seconds}; say so briefly.` : "";
  const longSpeechNote = choice.quality === "detailed" && seconds > 5 ? " Spoken words are clearest in a clip of 5 seconds or less; if the person wanted a line spoken and it does not come out clearly, offer a 5 second one." : "";
  const soundNote = choice.quality === "quick" ? " A Quick video has no sound; if they wanted sound or spoken words, offer to make a Detailed one." : "";

  const slot = kid ? reserveKid(actor, "video", 1, prompt) : null;
  if (kid && !slot) return refused(callId, args, { kind: "child", why: "daily_limit", line: CHILD_VIDEO_LIMIT_LINE });
  try {
    const job = await startVideoJob({
      actor,
      conversationId: state.conversationId,
      turnId: state.turnId,
      companionId: state.persona?.id ?? null,
      temporary,
      kind: image ? "animate" : "generate",
      prompt,
      sourceFileId,
      body: {
        prompt: kid ? forceCartoon(prompt) : withVideoTriggerWords(prompt, adapter),
        size,
        seconds,
        ...(choice.quality === "detailed" ? { model: "detailed" as const } : {}),
        audience: stackAudienceFor(audience),
        ...(lane === "adult" ? {} : { model: videoModelForLane(lane) }),
        ...(image ? { image, image_source: imageSource } : {}),
        ...(adapter ? { loras: [{ id: adapter.id, strength: adapter.strength_default }] } : {}),
        ...(kid ? { negative_prompt: CHILD_NEGATIVE_PROMPT } : {}),
      },
    });
    return outcomeOf({
      callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
      result: {
        reply: { text: `A ${seconds} second ${choice.quality === "detailed" ? "Detailed " : ""}video is being made from this description: ${prompt}. It takes ${etaWords(choice.quality, seconds)} and appears below your reply when it is ready. You have not seen it or heard it: do not describe how it looks or sounds. Tell the person in one short sentence that it is on its way and about how long it takes.${styleNote}${qualityNote}${lengthNote}${soundNote}${longSpeechNote}` },
        data: { videoJobId: job.id },
        actions: [],
      },
    });
  } catch (error) {
    releaseKid(slot);
    if (error instanceof StackVideoError && error.code === "already_making") {
      return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No new video was started. Say this to the person in your own words and keep its meaning: ${error.message}` }, data: { refused: "already_making" }, actions: [] } });
    }
    if (error instanceof StackVideoError && ["unreachable", "no_stack", "not_installed", "unsupported", "no_memory", "queue_full", "not_available_on_this_computer", "model_missing", "setup_failed"].includes(error.code)) {
      return failed(callId, args, error.code, "unavailable", plainVideoFailure(error));
    }
    return failed(callId, args, error instanceof StackVideoError ? error.code : "failed", "errored", plainVideoFailure(error));
  }
}
