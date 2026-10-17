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
import { CLIP_POSTER_NOTE, GENERATED_PICTURE_NOTE, loadGeneratedReference, plainVideoFailure, startVideoJob } from "./jobs";
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

export type VideoCallRefusal = { kind: "denied"; why: VideoDenial; line: string } | { kind: "prompt"; why: PromptRefusal; line: string };

/** The refusal for this call, or null: the surface and age gate first, then the two absolute lines on the prompt. */
export function videoRefusalFor(audience: VideoAudience, args: Record<string, unknown>): VideoCallRefusal | null {
  const denial = videoDenial(audience);
  if (denial) return { kind: "denied", why: denial, line: VIDEO_DENIAL_LINE[denial] };
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  const style = typeof args.style === "string" ? args.style : "";
  const refused = refuseVideoPrompt(`${prompt} ${style}`, { depictsRealPerson: args.depicts_real_person === true });
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
  state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "planBasis" | "plan" | "conversationId" | "turnId" | "temporary" | "ephemeral">;
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

  // A clip can start from a picture this home's Stack made (never an upload, never a photo): "latest" or an id.
  let image: string | undefined;
  let sourceFileId: string | null = null;
  let size = VIDEO_SIZES[typeof args.orientation === "string" ? args.orientation : "landscape"] ?? VIDEO_SIZES.landscape!;
  const from = typeof args.from_picture === "string" ? args.from_picture.trim() : "";
  if (from) {
    const id = /^(latest|last|this|that)$/i.test(from) ? latestGeneratedPictureId(actor, state.conversationId) : from;
    const ref = id ? loadGeneratedReference(actor, state.conversationId, id, temporary) : null;
    if (!ref || !ref.ok) {
      return outcomeOf({
        callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
        result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${ref && !ref.ok ? ref.line : "I can only animate a picture that was made here in this home. Ask me to make a picture first, then animate that one."}` }, data: { refused: "reference" }, actions: [] },
      });
    }
    image = ref.base64;
    sourceFileId = ref.id;
    if (ref.width && ref.height) size = ref.height > ref.width ? VIDEO_SIZES.portrait! : VIDEO_SIZES.landscape!;
  }

  // Only a LoRA this person may use right now can match; the model never sees the library.
  const available = await videoAdaptersFor(videoAdapterAudiencesFor(audience));
  const named = typeof args.style === "string" ? args.style.trim() : "";
  const adapter = named ? matchVideoAdapter(available, named) : null;
  const styleNote = named && !adapter ? " The style they named is not in the library, so the video was made without it; say so briefly." : "";
  const seconds = clampSeconds(args.seconds);

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
        audience: stackAudienceFor(audience),
        ...(image ? { image, image_source: "generated" as const } : {}),
        ...(adapter ? { loras: [{ id: adapter.id, strength: adapter.strength_default }] } : {}),
      },
    });
    return outcomeOf({
      callId, packageId: GENERATE_VIDEO_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
      result: {
        reply: { text: `A ${seconds} second video is being made from this description: ${prompt}. It takes about two minutes and appears below your reply when it is ready. You have not seen it: do not describe how it looks. Tell the person in one short sentence that it is on its way and about how long it takes.${styleNote}` },
        data: { videoJobId: job.id },
        actions: [],
      },
    });
  } catch (error) {
    if (error instanceof StackVideoError && ["unreachable", "no_stack", "not_installed", "unsupported", "no_memory", "queue_full", "not_available_on_this_computer", "model_missing", "setup_failed"].includes(error.code)) {
      return failed(callId, args, error.code, "unavailable", plainVideoFailure(error));
    }
    return failed(callId, args, error instanceof StackVideoError ? error.code : "failed", "errored", plainVideoFailure(error));
  }
}
