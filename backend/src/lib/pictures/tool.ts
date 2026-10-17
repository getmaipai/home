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
import { adapterAudiencesFor, adultAdaptersAllowed, pictureDenial, PICTURE_DENIAL_LINE, PROMPT_REFUSAL_LINE, refusePrompt, type PictureAudience, type PictureDenial, type PromptRefusal } from "./policy";
import { pictureEngineStatus } from "./ready";
import { StackPicturesError } from "./stack";
import { prepareStyleUse } from "@/lib/likeness/apply";
import { recordLikenessUse } from "@/lib/likeness/uses";

export const GENERATE_IMAGE_TOOL_ID = "generate_image";

export const PICTURE_SIZES: Record<string, string> = {
  square: "1024x1024",
  portrait: "896x1152",
  landscape: "1152x896",
  wide: "1344x768",
  tall: "768x1344",
};

/** The audience a turn presents to the picture policy. */
export function audienceOf(state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "planBasis" | "plan">, spoken: boolean): PictureAudience {
  const surfaceClass = state.planBasis?.surfaceClass ?? "spoken";
  return {
    actor: state.actor,
    band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date()),
    surface: state.surface,
    surfaceClass,
    spoken: spoken || surfaceClass !== "written",
  };
}

export type PictureCallRefusal = { kind: "denied"; why: PictureDenial; line: string } | { kind: "prompt"; why: PromptRefusal; line: string } | { kind: "likeness"; why: "likeness"; line: string };

/** The refusal for this call, or null: the surface and age gate first, then the two absolute lines on the prompt. */
export function refusalFor(audience: PictureAudience, args: Record<string, unknown>): PictureCallRefusal | null {
  const denial = pictureDenial(audience);
  if (denial) return { kind: "denied", why: denial, line: PICTURE_DENIAL_LINE[denial] };
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  const style = typeof args.style === "string" ? args.style : "";
  // A request that names a style may be a style of a household adult who agreed (LIKENESS-01): the tool decides that once it
  // has matched the style, so the model's "real person" flag alone does not end the call here when a style was named.
  const refused = refusePrompt(`${prompt} ${style}`, { depictsRealPerson: args.depicts_real_person === true && style.trim() === "" });
  if (refused) return { kind: "prompt", why: refused, line: PROMPT_REFUSAL_LINE[refused] };
  return null;
}

function clampCount(value: unknown, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 1;
  return Math.max(1, Math.min(max, n));
}

export interface RunGenerateImageInput {
  state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "planBasis" | "plan" | "conversationId" | "turnId" | "temporary" | "ephemeral">;
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
  const adapter = named ? matchAdapter(available, named) : null;
  // The absolute line is checked again on what is actually sent: the style's trigger words are added by Home, so they
  // are part of the request too.
  const sentPrompt = withTriggerWords(prompt, adapter);
  const second = refusePrompt(`${sentPrompt} ${adapter?.name ?? ""}`);
  if (second) return refused(callId, args, { kind: "prompt", why: second, line: PROMPT_REFUSAL_LINE[second] });
  const styleNote = named && !adapter ? " The style they named is not in the library, so the picture was made without it; say so briefly." : "";
  // LIKENESS-01: a style of a household adult is made only if they agreed; a real person with no such style is refused.
  const prep = await prepareStyleUse({ medium: "picture", audience, style: adapter, text: `${sentPrompt} ${adapter?.name ?? named}`, depictsRealPerson: args.depicts_real_person === true, source: "chat" });
  if (prep.kind === "refused") return refused(callId, args, prep.why === "real_person" ? { kind: "prompt", why: "real_person", line: PROMPT_REFUSAL_LINE.real_person } : { kind: "likeness", why: "likeness", line: prep.line });

  try {
    const temporary = state.temporary === true || state.ephemeral === true;
    const job = await startPictureJob({
      actor: state.actor as PersonRow,
      conversationId: state.conversationId,
      turnId: state.turnId,
      temporary,
      kind: "generate",
      prompt,
      body: {
        prompt: sentPrompt,
        size,
        n: count,
        audience: adultAdaptersAllowed() ? "adult" : "all-ages",
        ...(adapter ? { loras: [{ id: adapter.id, scale: adapter.strength_default, ...(prep.kind === "likeness" ? { likeness_proof: prep.proof } : {}) }] } : {}),
        ...(prep.kind === "likeness" && prep.negativePrompt ? { negative_prompt: prep.negativePrompt } : {}),
      },
      ...(prep.kind === "likeness" ? { likeness: prep.job } : {}),
    });
    if (prep.kind === "likeness") await recordLikenessUse({ subjectPersonId: prep.subjectId, requesterPersonId: state.actor.id, medium: "picture", way: "style", adultContent: prep.adultContent, source: "chat" });
    const many = count > 1 ? ` ${count} pictures are` : " The picture is";
    return outcomeOf({
      callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
      result: {
        reply: { text: `${many} being made from this description: ${prompt}. It appears below your reply when it is ready. You have not seen it: do not describe how it looks. Tell the person in one short sentence that it is on its way.${styleNote}` },
        data: { pictureJobId: job.id },
        actions: [],
      },
    });
  } catch (error) {
    if (error instanceof StackPicturesError && (error.code === "unreachable" || error.code === "no_stack" || error.code === "not_installed" || error.code === "unsupported" || error.code === "no_memory" || error.code === "queue_full")) {
      return failed(callId, args, error.code, "unavailable", plainFailure(error));
    }
    return failed(callId, args, error instanceof StackPicturesError ? error.code : "failed", "errored", plainFailure(error));
  }
}
