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
import { unlockedFor } from "@/lib/adultLock";
import { lockedStyleOutcome } from "@/lib/videos/lock";
import { buildPromptPlan } from "@/lib/loras/promptPlan";
import { STYLE_MIXED_LEVELS_LINE, STYLE_NOT_AT_LEVEL_LINE, resolveStyles, strengthWord, styleNamesOf } from "./styleChoice";
import { LORAS_UNSUPPORTED_LINE, ltx25LorasSupported } from "./loraWire";
import { CLIP_POSTER_NOTE, GENERATED_PICTURE_NOTE, latestTemporaryPosterId, loadGeneratedReference, loadUploadedPhoto, plainVideoFailure, startVideoJob } from "./jobs";
import { promptRefusalLineFor, screenInputImage, viewerOf } from "@/lib/pictures/ageCheck";
import { CHILD_NEGATIVE_PROMPT, CHILD_NO_PHOTOS_LINE, CHILD_VIDEO_LIMIT_LINE, forceCartoon, kidsDailyVideos, laneOf, releaseKid, reserveKid, videoModelForLane, videosMadeToday } from "@/lib/pictures/lane";

const KID_MAX_SECONDS = 3;
import { refuseVideoPrompt, stackAudienceFor, videoDenial, VIDEO_DENIAL_LINE, VIDEO_REFUSAL_LINE, type VideoAudience, type VideoDenial } from "./policy";
import type { PromptRefusal } from "@/lib/pictures/policy";
import { videoEngineStatus, videoStatusReady } from "./ready";
import { allowedQuality, jobTier, tierArgument } from "@/lib/tiers";
import { householdVideoQuality } from "./policy";
import { DETAILED_MAX_SECONDS, LTX25_MAX_MODEL, LTX25_MODEL, chooseVideoQuality, ltx25MaxReady, ltx25VideoReady, ltx25EndPictureReady, detailedVideoReady, etaWords, isVideoQuality, qualityOfBase, VIDEO_QUALITY_NOTE_LINE, videoSizeFor } from "./quality";
import { StackVideoError } from "./stack";
import { likenessCallRefusal } from "@/lib/likeness";
import { videoLookFor, videoRecipeFor, videoVoicesFor, withVideoLook, withVideoRecipe, withVideoVoices } from "./recipes";
import { subjectsForNames } from "@/lib/mediaSubjects";

export const GENERATE_VIDEO_TOOL_ID = "generate_video";


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

export type VideoCallRefusal = { kind: "denied"; why: VideoDenial; line: string } | { kind: "prompt"; why: PromptRefusal; line: string } | NonNullable<ReturnType<typeof likenessCallRefusal>> | { kind: "child"; why: "photos" | "daily_limit"; line: string };

/** The `from_picture` word for a photo the person attached to this message. */
export const ATTACHED_PHOTO = "attached";
const isAttached = (value: unknown): boolean => typeof value === "string" && value.trim().toLowerCase() === ATTACHED_PHOTO;

/** The refusal for this call, or null: the surface and age gate first, then the minor line on the prompt. */
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

/** What a video call needs of its caller: a chat turn passes its TurnState; the Create page's route (VIDEO-CREATE-01) passes just the person and
 * no conversation, and its own `audience`. */
export type GenerateVideoState = Pick<TurnState, "actor" | "temporary"> & {
  persona?: TurnState["persona"] | null;
  conversationId: string | null;
  turnId: string | null;
  ephemeral?: boolean;
  images?: TurnState["images"];
} & Partial<Pick<TurnState, "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan" | "utterance">>;

export interface RunGenerateVideoInput {
  state: GenerateVideoState;
  args: Record<string, unknown>;
  callId: string;
  spoken: boolean;
  /** The caller's own audience (the Create route's); a turn leaves it out and the audience is read from the turn. */
  audience?: VideoAudience;
  /** A picture already loaded and screened by the caller (an edit of a clip that started from one, via `prepareVideoRerun`). */
  prepared?: { image: string; imageSource: "generated" | "uploaded"; sourceFileId: string; width: number | null; height: number | null };
  /** VIDEO-LORA-09: the styles chosen on the Create page or kept from a stored clip, as style ids. Each is read again through the person's own access (a client id is never trusted). A chat call sends names in `args.styles` instead. */
  styleIds?: readonly string[];
  /** The new clip is adult-only whatever its words say (a continued clip's source is). */
  adultOnly?: boolean;
  /** The source clip's Adult lock (design 3.10); absent means on. */
  adultLock?: "on" | "off";
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

/** A style that cannot be applied: no video starts, and the person gets one plain line (never a clip that silently lacks the style). */
function styleRefusal(callId: string, args: Record<string, unknown>, line: string, why: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${line}` }, data: { refused: why }, actions: [] } });
}

const PHOTO_ATTACH_LINE = "Attach one photo to your message.";

export async function runGenerateVideo(input: RunGenerateVideoInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const audience = input.audience ?? videoAudienceOf(state as Parameters<typeof videoAudienceOf>[0], input.spoken);
  const refusal = videoRefusalFor(audience, args) ?? likenessCallRefusal(audience.actor, args);
  if (refusal) return refused(callId, args, refusal);

  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (prompt.length < 3) return failed(callId, args, "bad_arguments", "bad_arguments");
  const names = Array.isArray(args.subjects) ? args.subjects.filter((name): name is string => typeof name === "string") : [];
  const resolvedSubjects = subjectsForNames(state.actor as PersonRow, names);
  if (!resolvedSubjects) return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "No video was made. Say this to the person in your own words: I couldn't use that saved subject. Choose a subject from your available list." }, data: { refused: "unknown_subject" }, actions: [] } });
  const subjectPrompt = [...resolvedSubjects.map(({ subject }) => subject.look), prompt].filter(Boolean).join(". ");
  const engine = await videoEngineStatus();
  if (!videoStatusReady(engine, laneOf(audience) === "adult")) return failed(callId, args, "no_engine", "unavailable", "no video model is installed on the Stack");

  const temporary = state.temporary === true || state.ephemeral === true;
  const actor = state.actor as PersonRow;
  // KIDS-CREATE-01: a child's clip is a short cartoon of a safe thing, made from words or from their own cartoon; never from a photo, never a
  // style, with a daily limit. One short friendly line when it cannot be done.
  const lane = laneOf(audience);
  const kid = lane === "child";
  if (kid && isAttached(args.from_picture)) return refused(callId, args, { kind: "child", why: "photos", line: CHILD_NO_PHOTOS_LINE });
  if (kid && resolvedSubjects.some(({ subject }) => subject.real || subject.kind !== "character")) return refused(callId, args, { kind: "child", why: "photos", line: CHILD_NO_PHOTOS_LINE });
  if (kid && videosMadeToday(actor) + 1 > kidsDailyVideos()) return refused(callId, args, { kind: "child", why: "daily_limit", line: CHILD_VIDEO_LIMIT_LINE });

  // A clip can start from a picture this home's Stack made ("latest" or an id), or from a photo the person attached to this message.
  let image: string | undefined;
  let imageSource: "generated" | "uploaded" = "generated";
  let sourceFileId: string | null = null;
  let portrait = args.orientation === "portrait";
  const from = typeof args.from_picture === "string" ? args.from_picture.trim() : "";
  const ending = typeof args.end_frame === "string" ? args.end_frame.trim() : "";
  if (ending && kid) return refused(callId, args, { kind: "child", why: "photos", line: CHILD_NO_PHOTOS_LINE });
  const refuseWith = (line: string) => refused(callId, args, { kind: "child", why: "photos", line });
  if (input.prepared) {
    image = input.prepared.image; imageSource = input.prepared.imageSource; sourceFileId = input.prepared.sourceFileId;
    if (input.prepared.width && input.prepared.height) portrait = input.prepared.height > input.prepared.width;
  } else if (from && !state.conversationId) return refuseWith("A picture can start a video from a chat. Open a chat, then ask for it there.");
  else if (isAttached(from)) {
    const attached = state.images ?? [];
    if (attached.length !== 1) return refuseWith(PHOTO_ATTACH_LINE);
    const photo = loadUploadedPhoto(actor, state.conversationId!, attached[0]!.id, temporary);
    if (!photo.ok) return refuseWith(photo.line);
    // The input-side floor: CSAM candidate screening and the stricter minor lane checks.
    const screened = await screenInputImage(photo.bytes, prompt, viewerOf(actor, audience.band));
    if (!screened.ok) return refuseWith(screened.line);
    image = photo.base64; imageSource = "uploaded"; sourceFileId = photo.id;
    if (photo.width && photo.height) portrait = photo.height > photo.width;
  } else if (from) {
    const id = /^(latest|last|this|that)$/i.test(from) ? (temporary ? latestTemporaryPosterId(actor, state.conversationId!) : latestGeneratedPictureId(actor, state.conversationId!)) : from;
    const ref = id ? loadGeneratedReference(actor, state.conversationId!, id, temporary) : null;
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
  if (!image && resolvedSubjects.length) {
    const reference = resolvedSubjects.find(({ subject }) => subject.kind === "character") ?? resolvedSubjects.find(({ subject }) => subject.kind === "place") ?? resolvedSubjects.find(({ subject }) => subject.kind === "prop");
    const ref = reference?.references[0];
    if (ref) {
      if (kid) return refused(callId, args, { kind: "child", why: "photos", line: CHILD_NO_PHOTOS_LINE });
      const screened = await screenInputImage(ref.bytes, subjectPrompt, viewerOf(actor, audience.band));
      if (!screened.ok) return refuseWith(screened.line);
      image = Buffer.from(ref.bytes).toString("base64"); imageSource = "uploaded"; sourceFileId = ref.id;
    }
  }
  let endImage: string | undefined;
  let endFileId: string | null = null;
  let endAudience: "adult-only" | null = null;
  if (ending) {
    if (!image) return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "No video was made. Say this to the person in your own words: an ending picture needs a starting picture too." }, data: { refused: "end_frame_needs_start" }, actions: [] } });
    const id = /^(latest|last|this|that)$/i.test(ending) ? (temporary ? latestTemporaryPosterId(actor, state.conversationId!) : latestGeneratedPictureId(actor, state.conversationId!)) : ending;
    const ref = id && state.conversationId ? loadGeneratedReference(actor, state.conversationId, id, temporary) : null;
    if (!ref || !ref.ok) return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${ref && !ref.ok ? ref.line : "I can only use a picture made here in this chat for the ending picture."}` }, data: { refused: "end_reference" }, actions: [] } });
    if (ref.id === sourceFileId) return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "No video was made. Say this to the person in your own words and keep its meaning: The ending picture must be different from the starting picture." }, data: { refused: "same_end_frame" }, actions: [] } });
    endImage = ref.base64; endFileId = ref.id;
    const row = db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, ref.id)).get();
    endAudience = row?.provenance?.includes('"audience":"adult-only"') ? "adult-only" : null;
  }

  // Only a style this person may use right now can match; the model never sees the library. VIDEO-LORA-09: one resolver for names (chat) and ids (Create, a stored clip).
  const picked = kid ? { ok: true as const, adapters: [], unmatched: [] } : await resolveStyles({ audience, names: styleNamesOf(args), ids: input.styleIds, ...(typeof state.utterance === "string" ? { utterance: state.utterance } : {}) });
  // ADULT-LOCK-02: an adult-only style needs a live unlock proof on the turn request; without one nothing starts and the card is the lock tile.
  if (!picked.ok && picked.locked) return lockedStyleOutcome(callId, GENERATE_VIDEO_TOOL_ID, args);
  if (!picked.ok) return styleRefusal(callId, args, picked.line, picked.code);
  const adapters = picked.adapters;
  const adapter = adapters[0] ?? null;
  const styleNote = picked.unmatched.length > 0 ? " The style they named is not in the library, so the video was made without it; say so briefly." : "";
  // VIDEO-LTX-01: Quick or Detailed. A style made for one model decides; a length past five seconds needs Detailed; else what was asked for, else the household's setting.
  // LTX25-MAX-01: Max is offered only when the Stack reports its pack ready (not the slot list) and only to an adult; the grant is `tierArgument`'s own check.
  const maxReady = lane === "adult" && ltx25MaxReady(engine);
  const tierAsked = tierArgument({ person: state.actor as PersonRow, category: "video", arg: args.tier, band: audience.band, maxAvailable: maxReady });
  // VIDEO-LORA-09: a style made for LTX-2.5 rides the LTX-2.5 levels once the Stack reports it can (Max, or Standard and Boost); the Stack's own report decides, nothing is assumed.
  const ltx25Styles = lane === "adult" && adapters.length > 0 && adapters.every((a) => a.lora.compatible_with.includes("ltx-2.5"));
  const asksMax = tierAsked.tier === "max" && maxReady;
  const ltx25Route = ltx25Styles && (asksMax ? ltx25LorasSupported(engine, LTX25_MAX_MODEL) : ltx25LorasSupported(engine, LTX25_MODEL) && ltx25VideoReady(engine));
  const choice = chooseVideoQuality({ requested: isVideoQuality(args.quality) ? allowedQuality(state.actor as PersonRow, "video", args.quality, audience.band) : tierAsked.quality && allowedQuality(state.actor as PersonRow, "video", tierAsked.quality, audience.band), household: allowedQuality(state.actor as PersonRow, "video", householdVideoQuality(), audience.band), style: ltx25Route ? null : adapter, seconds: typeof args.seconds === "number" ? args.seconds : undefined, engine, hasPicture: image !== undefined, quickOnly: lane !== "adult" || allowedQuality(actor, "video", "detailed", audience.band) === "quick", adultLane: lane === "adult", max: tierAsked.tier === "max" && maxReady });
  if (ending) {
    const endMaker = maxReady && ltx25MaxReady(engine) && engine?.qualities?.ltx25max?.end_image === true && engine.qualities.ltx25max.image_to_video === true ? "ltx25max" : ltx25VideoReady(engine) && engine?.qualities?.ltx25?.end_image === true && engine.qualities.ltx25.image_to_video === true ? "ltx25" : null;
    if (!endMaker) return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "No video was made. Say this to the person in your own words and keep its meaning: This computer's video model cannot end on a picture yet." }, data: { refused: "end_frame_unavailable" }, actions: [] } });
    choice.maker = endMaker; choice.quality = "quick"; choice.seconds = Math.min(choice.seconds, endMaker === "ltx25max" ? 10 : 10); choice.note = null;
  }
  // A style made for Detailed cannot be used without Detailed: say so rather than start a clip the Stack would refuse.
  if (adapter && qualityOfBase(adapter.base_model) === "detailed" && !detailedVideoReady(engine)) {
    return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "No video was made. Say this to the person in your own words and keep its meaning: That style only works with Detailed videos, which are not on this computer yet. An admin can get them in Settings, Models and storage, or I can make the video without the style." }, data: { refused: "style_needs_detailed" }, actions: [] } });
  }
  if (image !== undefined && adapter && qualityOfBase(adapter.base_model) === "detailed") {
    return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "No video was made. Say this to the person in your own words and keep its meaning: That style only works with Detailed videos, and a Detailed video cannot start from a picture yet. I can animate the picture without the style, or make a Detailed video in that style from words." }, data: { refused: "style_needs_detailed" }, actions: [] } });
  }
  // VIDEO-LORA-09: every chosen style must be made for the kind of video this clip is; a style is never dropped to make a clip start. (Design 6.4.)
  const makerBase = ({ wan: "wan2.2-ti2v-5b", ltx23: "ltx-2.3", ltx25: "ltx-2.5", ltx25max: "ltx-2.5" } as const)[choice.maker];
  if (adapters.length > 0) {
    if (adapters.some((a) => !a.lora.compatible_with.includes(makerBase))) {
      const mixed = adapters.length > 1 && adapters.some((a) => a.lora.compatible_with.includes(makerBase));
      return styleRefusal(callId, args, mixed ? STYLE_MIXED_LEVELS_LINE : (ltx25Styles || choice.maker === "ltx25" || choice.maker === "ltx25max") ? LORAS_UNSUPPORTED_LINE : STYLE_NOT_AT_LEVEL_LINE, "style_not_at_level");
    }
    if ((choice.maker === "ltx25" || choice.maker === "ltx25max") && !ltx25LorasSupported(engine, choice.maker === "ltx25max" ? LTX25_MAX_MODEL : LTX25_MODEL)) return styleRefusal(callId, args, LORAS_UNSUPPORTED_LINE, "loras_unsupported");
  }
  const styleStrength = strengthWord(args.strength);
  const loraOf = (m: typeof choice.maker) => (m === "ltx25max" ? engine?.qualities?.ltx25max : m === "ltx25" ? engine?.qualities?.ltx25 : undefined)?.loras;
  const plan = buildPromptPlan({ words: subjectPrompt, styles: adapters.map((a) => a.lora), strength: styleStrength, negativePrompt: loraOf(choice.maker)?.negative_prompt });
  if (!plan.ok) return styleRefusal(callId, args, plan.line, plan.code);
  const seconds = kid ? Math.min(choice.seconds, KID_MAX_SECONDS) : choice.seconds;
  const size = videoSizeFor(choice.maker, choice.quality, portrait, engine);
  const ltx25 = choice.maker === "ltx25" || choice.maker === "ltx25max";
  const maxMade = choice.maker === "ltx25max";
  // Max asked for and ready, but this clip uses a style, or starts from a picture this Stack cannot start a Max clip from (VIDEO-INPUTS-01): say it was not made at Max.
  const maxWordsOnly = maxReady && tierAsked.tier === "max" && !maxMade && (image !== undefined || (adapters.length > 0 && !ltx25Route)) ? " Max cannot use a style, and cannot start from a picture on this computer yet, so this one was not made at Max; say so in one short sentence." : "";
  const qualityNote = tierAsked.line ? ` ${tierAsked.line}` : choice.note ? ` ${VIDEO_QUALITY_NOTE_LINE[choice.note]}` : choice.announce ? (ltx25 ? " This one has sound and speech; say so in one short sentence." : " This one is a Detailed video, with sound and speech; say so in one short sentence.") : "";
  const lengthNote = choice.shortened ? ` The most this kind makes is ${seconds} seconds, so it is ${seconds}; say so briefly.` : "";
  const longSpeechNote = choice.maker === "ltx23" && seconds > 5 ? " Spoken words are clearest in a clip of 5 seconds or less; if the person wanted a line spoken and it does not come out clearly, offer a 5 second one." : "";
  const soundNote = choice.maker === "wan" ? (lane === "adult" && ltx25VideoReady(engine) ? " This video has no sound; if they wanted sound or spoken words, offer to make one from words only, which has sound." : " A Quick video has no sound; if they wanted sound or spoken words, offer to make a Detailed one.") : "";

  // VIDEO-CREATE-01: a recipe's wording goes to the Stack after the person's words; the card keeps only what they typed. A child gets none.
  // VIDEO-CHAT-01: `camera` is the declared name; `recipe` is what older calls and the Create page send. `camera` wins.
  const recipe = kid ? null : videoRecipeFor(args.camera) ?? videoRecipeFor(args.recipe);
  // V1b: a look goes first, clean-dialogue wording last (only on a clip that has sound); neither is shown on the card. A child gets none.
  const look = kid ? null : videoLookFor(args.look);
  const voicesChosen = kid ? null : videoVoicesFor(args.voices);
  const voices = choice.maker !== "wan" ? voicesChosen : null;
  const detailedOffered = !ltx25 && allowedQuality(actor, "video", "detailed", audience.band) === "detailed" && detailedVideoReady(engine);
  const note = choice.shortened ? `${choice.quality === "quick" ? "Standard" : "This level"} makes ${seconds} seconds at most, so this video is ${seconds} seconds.${choice.quality === "quick" && detailedOffered ? ` Choose Boost for up to ${DETAILED_MAX_SECONDS}.` : ""}` : undefined;
  const create = !kid && (recipe || look || voicesChosen || note || (adapters.length > 0 && styleStrength)) ? { ...(recipe ? { recipe: recipe.id } : {}), ...(look && look.wording ? { look: look.id } : {}), ...(voicesChosen ? { voices: voicesChosen.id } : {}), ...(adapters.length > 0 && styleStrength ? { strength: styleStrength } : {}), ...(note ? { note } : {}) } : undefined;
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
      prompt: subjectPrompt,
      sourceFileId,
      endFileId,
      ...(endAudience === "adult-only" || resolvedSubjects.some(({ references }) => references.some((ref) => ref.audience === "adult-only")) ? { adultOnly: true } : {}),
      tier: maxMade ? "max" : jobTier("video", tierAsked.tier, choice.quality),
      ...(create ? { create } : {}),
      ...(input.adultOnly ? { adultOnly: true, ...(input.adultLock ? { adultLock: input.adultLock } : {}) } : {}),
      body: {
        prompt: kid ? forceCartoon(subjectPrompt) : withVideoVoices(withVideoRecipe(withVideoLook(plan.prompt, look), recipe), voices),
        // A new seed for every clip (stored on the job); Another take rolls a different one.
        seed: typeof args.seed === "number" && Number.isInteger(args.seed) && args.seed > 0 && args.seed < 2_147_483_647 ? args.seed : Math.floor(Math.random() * 2_147_483_647),
        size,
        seconds,
        ...(maxMade ? { model: LTX25_MAX_MODEL } : ltx25 ? { model: LTX25_MODEL } : choice.maker === "ltx23" ? { model: "detailed" as const } : {}),
        audience: endAudience === "adult-only" || resolvedSubjects.some(({ references }) => references.some((ref) => ref.audience === "adult-only")) ? "adult" : stackAudienceFor(audience),
        ...(lane === "adult" ? {} : { model: videoModelForLane(lane) }),
        ...(image ? { image, image_source: imageSource } : {}),
        ...(endImage ? { end_image: endImage } : {}),
        ...(adapters.length > 0 ? { loras: plan.loras } : {}),
        ...(plan.negative ? { negative_prompt: plan.negative } : {}),
        ...(kid ? { negative_prompt: CHILD_NEGATIVE_PROMPT } : {}),
      },
    });
    return outcomeOf({
      callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
      result: {
        reply: { text: `A ${seconds} second ${ltx25 ? "" : choice.quality === "detailed" ? "Detailed " : ""}video${ltx25 ? ", with sound," : ""} is being made from this description: ${prompt}. It takes ${etaWords(choice.quality, seconds, choice.maker)} and appears below your reply when it is ready. You have not seen it or heard it: do not describe how it looks or sounds. Tell the person in one short sentence that it is on its way and about how long it takes.${styleNote}${qualityNote}${maxWordsOnly}${lengthNote}${soundNote}${longSpeechNote}` },
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
