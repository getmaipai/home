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
import { preparePhotoUse, prepareStyleUse } from "@/lib/likeness/apply";
import { attestedAdult, WHO_IS_IN_PHOTO_LINE } from "@/lib/likeness/resolve";
import { singleAdultPhoto } from "@/lib/likeness/inspector";
import { recordLikenessUse } from "@/lib/likeness/uses";
import type { JobLikeness } from "@/lib/likeness/guard";
import { refuseVideoPrompt, stackAudienceFor, videoAdapterAudiencesFor, videoDenial, VIDEO_DENIAL_LINE, VIDEO_REFUSAL_LINE, type VideoAudience, type VideoDenial } from "./policy";
import type { PromptRefusal } from "@/lib/pictures/policy";
import { videoEngineStatus, videoStatusReady } from "./ready";
import { StackVideoError } from "./stack";

export const GENERATE_VIDEO_TOOL_ID = "generate_video";

export const VIDEO_SIZES: Record<string, string> = { landscape: "832x480", portrait: "480x832" };

/** The audience a turn presents to the video policy. */
export function videoAudienceOf(state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "planBasis" | "plan">, spoken: boolean): VideoAudience {
  const surfaceClass = state.planBasis?.surfaceClass ?? "spoken";
  return {
    actor: state.actor,
    band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date()),
    surface: state.surface,
    surfaceClass,
    spoken: spoken || surfaceClass !== "written",
  };
}

export type VideoCallRefusal = { kind: "denied"; why: VideoDenial; line: string } | { kind: "prompt"; why: PromptRefusal; line: string } | { kind: "likeness"; why: "likeness" | "reference"; line: string };

/** The `from_picture` word for a photo the person attached to this message (LIKENESS-01). */
export const ATTACHED_PHOTO = "attached";
const isAttached = (value: unknown): boolean => typeof value === "string" && value.trim().toLowerCase() === ATTACHED_PHOTO;

/** The refusal for this call, or null: the surface and age gate first, then the two absolute lines on the prompt. */
export function videoRefusalFor(audience: VideoAudience, args: Record<string, unknown>): VideoCallRefusal | null {
  const denial = videoDenial(audience);
  if (denial) return { kind: "denied", why: denial, line: VIDEO_DENIAL_LINE[denial] };
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  const style = typeof args.style === "string" ? args.style : "";
  // A request that names a style, or animates an attached photo, may be of a household adult who agreed (LIKENESS-01): the tool
  // decides that once it has matched the style or read the photo, so the model's "real person" flag alone does not end the call here.
  const refused = refuseVideoPrompt(`${prompt} ${style}`, { depictsRealPerson: args.depicts_real_person === true && style.trim() === "" && !isAttached(args.from_picture) });
  if (refused) return { kind: "prompt", why: refused, line: VIDEO_REFUSAL_LINE[refused] };
  return null;
}

function clampSeconds(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 5;
  return Math.max(1, Math.min(5, n));
}

/** The newest picture this conversation's Stack made for this person (a generated picture, else a clip's poster), or null. */
export function latestGeneratedPictureId(actor: PersonRow, conversationId: string): string | null {
  const row = db.select({ id: attachments.id }).from(attachments)
    .where(and(eq(attachments.conversationId, conversationId), eq(attachments.ownerPersonId, actor.id), or(like(attachments.provenance, `${GENERATED_PICTURE_NOTE}%`), like(attachments.provenance, `${CLIP_POSTER_NOTE}%`))))
    .orderBy(desc(attachments.createdAt), desc(attachments.hlc)).get();
  return row?.id ?? null;
}

export interface RunGenerateVideoInput {
  state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "planBasis" | "plan" | "conversationId" | "turnId" | "temporary" | "ephemeral" | "images"> & Partial<Pick<TurnState, "utterance">>;
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

const PHOTO_ATTACH_LINE = "Attach one photo to your message, say which adult in this household is in it, and I can animate it if they have agreed.";
const PHOTO_SUBJECT_LINE = "Tell me which adult in this household is in the photo, by name, and make sure they have agreed. I won't animate a photo of someone I can't tie to an adult here, or of a child.";

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

  // A clip can start from a picture this home's Stack made ("latest" or an id), or from a photo the person attached to this
  // message when they say which household adult is in it (LIKENESS-01). Never from an upload of anyone else.
  let image: string | undefined;
  let imageSource: "generated" | "household_photo" = "generated";
  let consentProof: string | undefined;
  let sourceFileId: string | null = null;
  let negativePrompt: string | null = null;
  let photoLikeness: Extract<Awaited<ReturnType<typeof preparePhotoUse>>, { kind: "likeness" }> | null = null;
  let size = VIDEO_SIZES[typeof args.orientation === "string" ? args.orientation : "landscape"] ?? VIDEO_SIZES.landscape!;
  const from = typeof args.from_picture === "string" ? args.from_picture.trim() : "";
  const refuseWith = (kind: "likeness" | "reference", line: string) => refused(callId, args, { kind: "likeness", why: kind, line });
  if (isAttached(from)) {
    const attached = state.images ?? [];
    if (attached.length !== 1) return refuseWith("reference", PHOTO_ATTACH_LINE);
    const photo = loadUploadedPhoto(actor, state.conversationId, attached[0]!.id, temporary);
    if (!photo.ok) return refuseWith("reference", photo.line);
    // The model's `photo_subject` is a proposal: only the person's own message (a name, or a claim that it is them) attests who is in the photo.
    const { proposed, attested: declared } = attestedAdult(args.photo_subject, state.utterance, actor);
    if (!declared) return refuseWith("likeness", proposed ? WHO_IS_IN_PHOTO_LINE : PHOTO_SUBJECT_LINE);
    // The photo must show exactly the one declared adult, nobody who could be a child: counted by the household's own model, fail closed.
    const verdict = await singleAdultPhoto(photo.bytes);
    if (!verdict.ok) return refuseWith("likeness", verdict.line);
    const prep = await preparePhotoUse({ medium: "video", audience, declaredSubjectId: declared.id, bytes: photo.bytes, text: prompt, source: "chat" });
    if (prep.kind === "refused") return refuseWith("likeness", prep.line);
    photoLikeness = prep; image = photo.base64; imageSource = "household_photo"; consentProof = prep.proof; sourceFileId = photo.id; negativePrompt = prep.negativePrompt;
    if (photo.width && photo.height) size = photo.height > photo.width ? VIDEO_SIZES.portrait! : VIDEO_SIZES.landscape!;
  } else if (from) {
    const id = /^(latest|last|this|that)$/i.test(from) ? (temporary ? latestTemporaryPosterId(actor, state.conversationId) : latestGeneratedPictureId(actor, state.conversationId)) : from;
    const ref = id ? loadGeneratedReference(actor, state.conversationId, id, temporary) : null;
    if (!ref || !ref.ok) {
      return outcomeOf({
        callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
        result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${ref && !ref.ok ? ref.line : "I can only animate a picture that was made here in this home, or a photo you attach of an adult in this household who has agreed. Ask me to make a picture first, then animate that one."}` }, data: { refused: "reference" }, actions: [] },
      });
    }
    image = ref.base64;
    sourceFileId = ref.id;
    if (ref.width && ref.height) size = ref.height > ref.width ? VIDEO_SIZES.portrait! : VIDEO_SIZES.landscape!;
    // A picture that was itself made to look like a person is animated only if that person still agrees, now.
    if (ref.likenessSubject) {
      const prep = await preparePhotoUse({ medium: "video", audience, declaredSubjectId: ref.likenessSubject, bytes: ref.bytes, text: prompt, source: "chat" });
      if (prep.kind === "refused") return refuseWith("likeness", prep.line);
      photoLikeness = prep; imageSource = "household_photo"; consentProof = prep.proof; negativePrompt = prep.negativePrompt;
    }
  }

  // Only a LoRA this person may use right now can match; the model never sees the library.
  const available = await videoAdaptersFor(videoAdapterAudiencesFor(audience));
  const named = typeof args.style === "string" ? args.style.trim() : "";
  const adapter = named ? matchVideoAdapter(available, named) : null;
  const styleNote = named && !adapter ? " The style they named is not in the library, so the video was made without it; say so briefly." : "";
  const seconds = clampSeconds(args.seconds);
  // A style of a household adult is made only if they agreed; a real person with no such style or photo is refused (LIKENESS-01).
  const stylePrep = await prepareStyleUse({ medium: "video", audience, style: adapter, text: `${prompt} ${adapter?.name ?? named}`, depictsRealPerson: args.depicts_real_person === true && !photoLikeness, source: "chat" });
  if (stylePrep.kind === "refused") return stylePrep.why === "real_person" ? refused(callId, args, { kind: "prompt", why: "real_person", line: VIDEO_REFUSAL_LINE.real_person }) : refuseWith("likeness", stylePrep.line);
  if (stylePrep.kind === "likeness" && photoLikeness && stylePrep.subjectId !== photoLikeness.subjectId) return refuseWith("likeness", "I can make something that looks like one person at a time. Use a style and a photo of the same adult, or leave one out.");
  const likeness: JobLikeness | null = stylePrep.kind === "likeness" ? { ...stylePrep.job, adult_content: stylePrep.adultContent || (photoLikeness?.adultContent ?? false) } : photoLikeness ? photoLikeness.job : null;
  if (stylePrep.kind === "likeness" && stylePrep.negativePrompt) negativePrompt = stylePrep.negativePrompt;
  const subjectForLog = stylePrep.kind === "likeness" ? stylePrep : photoLikeness;

  try {
    const job = await startVideoJob({
      actor,
      conversationId: state.conversationId,
      turnId: state.turnId,
      temporary,
      kind: image ? "animate" : "generate",
      prompt,
      sourceFileId,
      body: {
        prompt: withVideoTriggerWords(prompt, adapter),
        size,
        seconds,
        audience: likeness ? "adult" as const : stackAudienceFor(audience),
        ...(image ? { image, image_source: imageSource, ...(consentProof ? { consent_proof: consentProof } : {}) } : {}),
        ...(adapter ? { loras: [{ id: adapter.id, strength: adapter.strength_default, ...(stylePrep.kind === "likeness" ? { likeness_proof: stylePrep.proof } : {}) }] } : {}),
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      },
      ...(likeness ? { likeness } : {}),
    });
    if (subjectForLog) await recordLikenessUse({ subjectPersonId: subjectForLog.subjectId, requesterPersonId: actor.id, medium: "video", way: photoLikeness ? "photo" : "style", adultContent: likeness?.adult_content ?? false, source: "chat" });
    return outcomeOf({
      callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
      result: {
        reply: { text: `A ${seconds} second video is being made from this description: ${prompt}. It takes about two minutes and appears below your reply when it is ready. You have not seen it: do not describe how it looks. Tell the person in one short sentence that it is on its way and about how long it takes.${styleNote}` },
        data: { videoJobId: job.id },
        actions: [],
      },
    });
  } catch (error) {
    if (error instanceof StackVideoError && error.code === "already_making") {
      return outcomeOf({ callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No new video was started. Say this to the person in your own words and keep its meaning: ${error.message}` }, data: { refused: "already_making" }, actions: [] } });
    }
    if (error instanceof StackVideoError && ["unreachable", "no_stack", "not_installed", "unsupported", "no_memory", "queue_full", "not_available_on_this_computer", "model_missing", "setup_failed"].includes(error.code)) {
      return failed(callId, args, error.code, "unavailable", plainVideoFailure(error));
    }
    return failed(callId, args, error instanceof StackVideoError ? error.code : "failed", "errored", plainVideoFailure(error));
  }
}
