// IMGGEN-HOME-01: the `generate_image` tool inside a chat turn. The model decides when a person asked for a
// picture (rule 1); this file never reads wording to decide that. It runs only after the turn's gates passed
// (policy.ts, checked again at the policy node and here: age and surface gates outrank every rule, rule 0),
// starts a Stack job, and returns at once with a short line for the model to relay. The picture itself arrives
// on the card (frontend PictureToolRender) when the job finishes, so a slow render never holds the answer.
import type { PersonRow } from "@/types";
import type { TurnState, ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import { adaptersFor, matchAdapter, withTriggerWords } from "./adapters";
import { startPictureJob, plainFailure } from "./jobs";
import { promptRefusalLineFor } from "./ageCheck";
import { adapterAudiencesFor, adultAdaptersAllowed, householdPictureQuality, PICTURE_STARTED_CONFIRM_NOTE, pictureDenial, PICTURE_DENIAL_LINE, PROMPT_REFUSAL_LINE, refusePrompt, type PictureAudience, type PictureDenial, type PromptRefusal } from "./policy";
import { pictureEngineStatus } from "./ready";
import { allowedQuality, tierArgument } from "@/lib/tiers";
import { chooseQuality, isPictureQuality, QUALITY_NOTE_LINE, QUICK_MODEL } from "./quality";
import { StackPicturesError } from "./stack";

import { GENERATE_IMAGE_TOOL_ID, runEditPicture } from "./editTool";
import { CHILD_LIMIT_LINE, CHILD_NEGATIVE_PROMPT, forceCartoon, kidsDailyPictures, laneOf, picturesMadeToday, releaseKid, reserveKid } from "./lane";

const KID_MAX_COUNT = 2;
export { GENERATE_IMAGE_TOOL_ID };

export const PICTURE_SIZES: Record<string, string> = {
  square: "1024x1024",
  portrait: "896x1152",
  landscape: "1152x896",
  wide: "1344x768",
  tall: "768x1344",
};

/** The audience a turn presents to the picture policy. */
export function audienceOf(state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan">, spoken: boolean): PictureAudience {
  const surfaceClass = state.planBasis?.surfaceClass ?? "spoken";
  return {
    actor: state.actor,
    band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId),
    surface: state.surface,
    surfaceClass,
    spoken: spoken || surfaceClass !== "written",
  };
}

export type PictureCallRefusal = { kind: "denied"; why: PictureDenial; line: string } | { kind: "prompt"; why: PromptRefusal; line: string };

/** The refusal for this call, or null: the surface and age gate first, then the two absolute lines on the prompt. */
export function refusalFor(audience: PictureAudience, args: Record<string, unknown>): PictureCallRefusal | null {
  const denial = pictureDenial(audience);
  if (denial) return { kind: "denied", why: denial, line: PICTURE_DENIAL_LINE[denial] };
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  const style = typeof args.style === "string" ? args.style : "";
  const refused = refusePrompt(`${prompt} ${style}`, { lane: laneOf(audience) });
  if (refused) return { kind: "prompt", why: refused, line: promptRefusalLineFor(refused, "picture", audience.actor, audience.band, `${prompt} ${style}`, PROMPT_REFUSAL_LINE[refused]) };
  return null;
}

function clampCount(value: unknown, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 1;
  return Math.max(1, Math.min(max, n));
}

export interface RunGenerateImageInput {
  state: Pick<TurnState, "actor" | "persona" | "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan" | "conversationId" | "turnId" | "temporary" | "ephemeral">;
  args: Record<string, unknown>;
  callId: string;
  spoken: boolean;
}

function failed(callId: string, args: Record<string, unknown>, code: string, kind: "unavailable" | "errored" | "bad_arguments", detail?: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0, ...(detail ? { detail } : {}) });
}

/** The line the model relays after a refusal (a policy refusal is not a failed tool: it keeps its own fixed reply). */
function refused(callId: string, args: Record<string, unknown>, refusal: PictureCallRefusal): ToolExecutionOutcome {
  return outcomeOf({
    callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: { reply: { text: `No picture was made. Say this to the person in your own words and keep its meaning: ${refusal.line}` }, data: { refused: refusal.why }, actions: [] },
  });
}

export async function runGenerateImage(input: RunGenerateImageInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const audience = audienceOf(state, input.spoken);
  const refusal = refusalFor(audience, args);
  if (refusal) return refused(callId, args, refusal);

  // IMGEDIT-01: `change` set means the person wants a picture they already have changed, not a new one.
  if (typeof args.change === "string" && args.change.trim() !== "") return runEditPicture({ state, args, callId, audience });

  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (prompt.length < 3) return failed(callId, args, "bad_arguments", "bad_arguments");
  const engine = await pictureEngineStatus();
  if (!engine || engine.state === "unsupported" || engine.state === "off" || engine.state === "not-installed" || engine.available === false) {
    return failed(callId, args, "no_engine", "unavailable", "no picture model is installed on the Stack");
  }
  const maxN = engine.limits?.max_n ?? 4;
  const count = clampCount(args.count, maxN);
  const size = PICTURE_SIZES[typeof args.size === "string" ? args.size : "square"] ?? PICTURE_SIZES.square!;

  // Only an adapter this person may use right now can match; the model never sees the library.
  const available = await adaptersFor(adapterAudiencesFor(audience));
  const named = typeof args.style === "string" ? args.style.trim() : "";
  const lane = laneOf(audience);
  const kid = lane === "child";
  // A child never picks a style (the cartoon look is the style).
  const adapter = named && !kid ? matchAdapter(available, named) : null;
  // The absolute line is checked again on what is actually sent: the style's trigger words are added by Home, so they
  // are part of the request too.
  const sentPrompt = withTriggerWords(prompt, adapter);
  const second = refusePrompt(`${sentPrompt} ${adapter?.name ?? ""}`, { lane });
  if (second) return refused(callId, args, { kind: "prompt", why: second, line: promptRefusalLineFor(second, "picture", audience.actor, audience.band, sentPrompt, PROMPT_REFUSAL_LINE[second]) });
  // KIDS-CREATE-01: a child gets a daily limit, the cartoon look forced, Quick only, one or two pictures, and no friction text.
  if (kid && picturesMadeToday(state.actor as PersonRow) + Math.min(count, KID_MAX_COUNT) > kidsDailyPictures()) return refused(callId, args, { kind: "prompt", why: "child_content", line: CHILD_LIMIT_LINE });
  // IMGGEN-QUALITY-01: Quick or Detailed. A style made for one maker decides; else what was asked for, else the household's setting.
  const tierAsked = tierArgument({ person: state.actor as PersonRow, category: "image", arg: args.tier, band: audience.band });
  const choice: ReturnType<typeof chooseQuality> = kid ? { quality: "quick", model: QUICK_MODEL, note: null, announce: false } : chooseQuality({ requested: isPictureQuality(args.quality) ? allowedQuality(state.actor as PersonRow, "image", args.quality, audience.band) : tierAsked.quality, household: allowedQuality(state.actor as PersonRow, "image", householdPictureQuality(), audience.band), style: adapter, engine });
  const qualityNote = tierAsked.line ? ` ${tierAsked.line}` : choice.note ? ` ${QUALITY_NOTE_LINE[choice.note]}` : choice.announce ? " This one is a Detailed picture, which takes longer than a Quick one; say so in one short sentence." : "";
  const styleNote = named && !adapter ? " The style they named is not in the library, so the picture was made without it; say so briefly." : "";
  // The allowance is taken now, in one step with the check, so two asks at once cannot both pass; it goes back only if nothing started.
  const slot = kid ? reserveKid(state.actor as PersonRow, "picture", Math.min(count, KID_MAX_COUNT), prompt) : null;
  if (kid && !slot) return refused(callId, args, { kind: "prompt", why: "child_content", line: CHILD_LIMIT_LINE });
  try {
    const temporary = state.temporary === true || state.ephemeral === true;
    const job = await startPictureJob({
      actor: state.actor as PersonRow,
      conversationId: state.conversationId,
      turnId: state.turnId,
      companionId: state.persona?.id ?? null,
      temporary,
      kind: "generate",
      prompt,
      body: {
        prompt: kid ? forceCartoon(sentPrompt) : sentPrompt,
        size,
        n: kid ? Math.min(count, KID_MAX_COUNT) : count,
        ...(choice.model ? { model: choice.model } : {}),
        // Only an adult whose household allows adult-only styles is ever sent as `adult`: a teen and a child are always `all-ages`.
        audience: lane === "adult" && adultAdaptersAllowed() ? "adult" : "all-ages",
        ...(adapter ? { loras: [{ id: adapter.id, scale: adapter.strength_default }] } : {}),
        ...(kid ? { negative_prompt: CHILD_NEGATIVE_PROMPT } : {}),
      },
    });
    const many = count > 1 ? ` ${count} pictures are` : " The picture is";
    return outcomeOf({
      callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
      result: {
        reply: { text: `${many} being made from this description: ${prompt}. It appears below your reply when it is ready. You have not seen it: do not describe how it looks. Tell the person in one short sentence that it is on its way.${lane === "adult" ? ` ${PICTURE_STARTED_CONFIRM_NOTE}` : ""}${styleNote}${qualityNote}` },
        data: { pictureJobId: job.id },
        actions: [],
      },
    });
  } catch (error) {
    releaseKid(slot);
    if (error instanceof StackPicturesError && (error.code === "unreachable" || error.code === "no_stack" || error.code === "not_installed" || error.code === "unsupported" || error.code === "no_memory" || error.code === "queue_full")) {
      return failed(callId, args, error.code, "unavailable", plainFailure(error));
    }
    return failed(callId, args, error instanceof StackPicturesError ? error.code : "failed", "errored", plainFailure(error));
  }
}
