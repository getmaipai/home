// IMGGEN-HOME-01: the `generate_image` tool inside a chat turn. The model decides when a person asked for a
// picture (rule 1); this file never reads wording to decide that. It runs only after the turn's gates passed
// (policy.ts, checked again at the policy node and here: age and surface gates outrank every rule, rule 0),
// starts a Stack job, and returns at once with a short line for the model to relay. The picture itself arrives
// on the card (frontend PictureToolRender) when the job finishes, so a slow render never holds the answer.
import { BACKGROUND_REMOVAL_OP } from "@/lib/mediaOps/ids";
import { requestProof, unlockedFor } from "@/lib/adultLock";
import type { PersonRow } from "@/types";
import type { TurnState, ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import { adaptersFor, matchAdapter } from "./adapters";
import { getLoraRecord } from "@/lib/loras/store";
import { isAdultPictureStyle } from "@/lib/pictures/lock";
import { buildPromptPlan } from "@/lib/loras/promptPlan";
import { startPictureJob, plainFailure } from "./jobs";
import { promptRefusalLineFor } from "./ageCheck";
import { adapterAudiencesFor, adultStylesAllowed, householdPictureQuality, PICTURE_STARTED_CONFIRM_NOTE, pictureDenial, PICTURE_DENIAL_LINE, PROMPT_REFUSAL_LINE, refusePrompt, type PictureAudience, type PictureDenial, type PromptRefusal } from "./policy";
import { pictureEngineStatus } from "./ready";
import { allowedQuality, jobTier, tierArgument } from "@/lib/tiers";
import { chooseQuality, isPictureQuality, QUALITY_NOTE_LINE, QUICK_MODEL } from "./quality";
import { StackPicturesError } from "./stack";
import { likenessCallRefusal } from "@/lib/likeness";
import { getTemplate } from "@/lib/media/templates";
import { composePicturePrompt, PICTURE_PICK_KEYS, resolvePicks, type PictureFragmentPicks } from "@/lib/media/pictureFragments";
import { runMediaOp } from "@/lib/mediaOps/registry";
import { subjectsForNames } from "@/lib/mediaSubjects";

import { GENERATE_IMAGE_TOOL_ID, runEditPicture, latestPictureId } from "./editTool";
import { CHILD_LIMIT_LINE, CHILD_NEGATIVE_PROMPT, forceCartoon, kidsDailyPictures, laneOf, picturesMadeToday, releaseKid, reserveKid } from "./lane";
import { lockedPictureStyleOutcome } from "./lock";

const KID_MAX_COUNT = 2;
let templateMediaOpRunner = runMediaOp;
export function __setTemplateMediaOpRunnerForTests(runner: typeof runMediaOp | null): void { templateMediaOpRunner = runner ?? runMediaOp; }
let loraRecordReader = getLoraRecord;
export function __setPictureToolLoraReaderForTests(reader: typeof getLoraRecord | null): void { loraRecordReader = reader ?? getLoraRecord; }
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

export type PictureCallRefusal = { kind: "denied"; why: PictureDenial; line: string } | { kind: "prompt"; why: PromptRefusal; line: string } | { kind: "plan"; why: "style_plan"; line: string } | NonNullable<ReturnType<typeof likenessCallRefusal>>;

/** The refusal for this call, or null: the surface and age gate first, then the minor line on the prompt. */
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
  signal?: AbortSignal;
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
  const normalized = { ...args };
  let template: ReturnType<typeof getTemplate> = null;
  let promptOverride: string | null = null;
  if (typeof args.template === "string" && args.template) {
    template = getTemplate(args.template);
    if (!template || template.kind !== "picture" || (template.audience === "adult-only" && (audience.band !== "adult" || !adultStylesAllowed()))) {
      return failed(callId, args, "bad_template", "bad_arguments");
    }
    const blanks = args.blanks && typeof args.blanks === "object" && !Array.isArray(args.blanks) ? args.blanks as Record<string, unknown> : {};
    const required = [...template.prompt.matchAll(/\{\{([a-z][a-z0-9_]*)\|[^|}]+\|[^}]*\}\}/g)].map((match) => match[1]!);
    const missing = required.find((name) => typeof blanks[name] !== "string" || !(blanks[name] as string).trim());
    if (missing) return outcomeOf({ callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `Ask for ${missing.replaceAll("_", " ")} before making this picture.` }, actions: [] } });
    promptOverride = template.prompt.replace(/\{\{([a-z][a-z0-9_]*)\|[^|}]+\|[^}]*\}\}/g, (_whole, name: string) => String(blanks[name]).trim());
    normalized.prompt = promptOverride;
  }
  // CREATOR-13: the chosen look, light, angle and format are preset records; a name that is not one (or not this person's) is a bad argument.
  const picks: PictureFragmentPicks = {};
  const chosen = args.presets && typeof args.presets === "object" && !Array.isArray(args.presets) ? args.presets as Record<string, unknown> : {};
  for (const key of PICTURE_PICK_KEYS) if (typeof chosen[key] === "string" && chosen[key]) picks[key] = chosen[key] as string;
  let presetAspect: string | null = null;
  if (Object.keys(picks).length) {
    if (!resolvePicks(picks, state.actor as PersonRow)) return failed(callId, args, "bad_preset", "bad_arguments");
    const edit = (typeof args.change === "string" && args.change.trim() !== "") || (Array.isArray(args.references) && args.references.length > 0);
    const composed = composePicturePrompt(promptOverride ?? (typeof args.prompt === "string" ? args.prompt.trim() : ""), picks, { edit }, state.actor as PersonRow);
    promptOverride = composed.prompt;
    normalized.prompt = composed.prompt;
    presetAspect = composed.aspect;
  }
  delete normalized.presets;
  // The household's likeness option (lib/likeness.ts) is checked here, after the policy gate: its refusal is not a minor-line reason.
  if (Array.isArray(args.references)) {
    const refs = (args.references as unknown[]).flatMap((entry) => {
      const id = typeof entry === "string" ? entry : entry && typeof entry === "object" && "id" in entry ? String((entry as { id: unknown }).id) : "";
      return id ? [id] : [];
    }).slice(0, 2);
    if (refs.length) normalized.reference = refs[0];
  }
  delete normalized.template;
  const refusal = refusalFor(audience, normalized) ?? likenessCallRefusal(audience.actor, normalized);
  if (refusal) return refused(callId, args, refusal);
  const prompt = promptOverride ?? (typeof args.prompt === "string" ? args.prompt.trim() : "");
  const chosenSubjects = Array.isArray(args.subjects) ? args.subjects.filter((name): name is string => typeof name === "string") : [];
  const namedSubjects = subjectsForNames(state.actor as PersonRow, chosenSubjects);
  // CREATOR-05: `cast` (ids from GET /api/cast) goes through resolveCast; a refused member starts nothing and says why in one plain line.
  const { castForTool, mergeSubjects, castIsAdultOnly } = await import("@/lib/cast"); // loaded here: cast.ts reaches the synth store, which must not load before the persona catalog
  const castChosen = await castForTool(state.actor as PersonRow, args, { band: audience.band, temporary: state.temporary === true || state.ephemeral === true });
  if (!castChosen.ok) return outcomeOf({ callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No picture was made. Say this to the person in your own words and keep its meaning: ${castChosen.line}` }, data: { refused: "cast" }, actions: [] } });
  const resolvedSubjects = namedSubjects && mergeSubjects(namedSubjects, castChosen.subjects);
  if (!resolvedSubjects) return outcomeOf({ callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "No picture was made. Say this to the person in your own words: I couldn't use that saved subject. Choose a subject from your available list." }, data: { refused: "unknown_subject" }, actions: [] } });

  // IMGEDIT-01: `change` set means the person wants a picture they already have changed, not a new one.
  if (typeof normalized.change === "string" && normalized.change.trim() !== "") {
    const mapped = { ...normalized };
    if (resolvedSubjects.length) {
      mapped.prompt = [...resolvedSubjects.map(({ subject }) => subject.look), String(mapped.prompt ?? "")].filter(Boolean).join(". ");
      mapped.subjectIds = resolvedSubjects.map(({ subject }) => subject.id);
    }
    if (Array.isArray(normalized.references)) {
      const refs = (normalized.references as unknown[]).flatMap((entry) => {
        const id = typeof entry === "string" ? entry : entry && typeof entry === "object" && "id" in entry ? String((entry as { id: unknown }).id) : "";
        return id ? [id] : [];
      }).slice(0, 2);
      if (refs.length) mapped.reference = refs[0];
      if (refs.length > 1) mapped.references = refs.slice(1).map((id) => ({ kind: "picture", via: "chat", id, conversationId: state.conversationId }));
    }
    return runEditPicture({ state, args: mapped, callId, audience });
  }
  if (Array.isArray(normalized.references) && normalized.references.length) {
    const sourceId = latestPictureId(state.actor as PersonRow, state.conversationId, state.temporary === true || state.ephemeral === true);
    if (!sourceId) return failed(callId, args, "no_picture", "bad_arguments");
    const references = (normalized.references as unknown[]).flatMap((entry) => {
      const id = typeof entry === "string" ? entry : entry && typeof entry === "object" && "id" in entry ? String((entry as { id: unknown }).id) : "";
      return id ? [{ kind: "picture" as const, via: "chat" as const, id, conversationId: state.conversationId }] : [];
    }).slice(0, 2);
    return runEditPicture({ state, args: { prompt, change: sourceId, references: references.map((ref) => ref.id) }, callId, audience });
  }

  if (prompt.length < 3) return failed(callId, args, "bad_arguments", "bad_arguments");
  const engine = await pictureEngineStatus();
  if (!engine || engine.state === "unsupported" || engine.state === "off" || engine.state === "not-installed" || engine.available === false) {
    return failed(callId, args, "no_engine", "unavailable", "no picture model is installed on the Stack");
  }
  const maxN = engine.limits?.max_n ?? 4;
  const count = clampCount(args.count, maxN);
  const aspectSize: Record<string, string> = { "1:1":"square", "3:2":"landscape", "2:3":"portrait", "16:9":"wide", "9:16":"tall" };
  const chosenAspect = template?.aspect ?? presetAspect;
  const size = PICTURE_SIZES[chosenAspect ? aspectSize[chosenAspect] ?? "square" : typeof args.size === "string" ? args.size : "square"] ?? PICTURE_SIZES.square!;

  // Only an adapter this person may use right now can match; the model never sees the library.
  const available = await adaptersFor(adapterAudiencesFor(audience));
  const named = typeof args.style === "string" ? args.style.trim() : "";
  const lane = laneOf(audience);
  const kid = lane === "child";
  // A child never picks a style (the cartoon look is the style).
  const adapter = named && !kid ? matchAdapter(available, named) : null;
  const adapterRecord = adapter ? loraRecordReader(adapter.id) : null;
  // An adult-only style (the Stack's class or the record's) starts nothing without this request's live Adult unlock proof.
  // A name that matches no style is dropped as before, and gives a plain picture, so nothing adult can start from it.
  if (lane === "adult" && adapter && isAdultPictureStyle(adapter, adapterRecord) && !unlockedFor(state.actor as PersonRow, requestProof())) return lockedPictureStyleOutcome(callId, GENERATE_IMAGE_TOOL_ID);
  // The absolute line is checked again on what is actually sent, including the style phrases the plan adds.
  const foundRecord = adapter ? adapterRecord : null;
  const record = foundRecord?.media === "picture" ? foundRecord : null;
  const fallbackPrompt = adapter && !record && adapter.trigger_words.length > 0
    ? (() => { const missing = adapter.trigger_words.filter((word) => !prompt.toLowerCase().includes(word.toLowerCase())); return missing.length ? `${prompt.trim()}, ${missing.join(", ")}` : prompt; })()
    : prompt;
  const plan = record
    ? buildPromptPlan({ words: prompt, styles: [record], strength: undefined, negativePrompt: "none", media: "picture" })
    : null;
  const sentPrompt = plan?.ok ? plan.prompt : fallbackPrompt;
  const subjectPrompt = [...resolvedSubjects.map(({ subject }) => subject.look), sentPrompt].join(". ");
  const subjectRefs = resolvedSubjects.flatMap(({ subject, references }) => references.map((ref) => ({ ...ref, kind: subject.kind })))
    .sort((a, b) => ({ place: 0, character: 1, prop: 2 }[a.kind] - { place: 0, character: 1, prop: 2 }[b.kind]))
    .slice(0, Math.max(1, 1 + (engine.edit?.references ?? 0)));
  const strictAudience = subjectRefs.some((ref) => ref.audience === "adult-only") || castIsAdultOnly(castChosen) ? "adult-only" : (laneOf(audience) === "adult" && adultStylesAllowed() ? "adult-only" : "all-ages");
  const second = refusePrompt(`${subjectPrompt} ${adapter?.name ?? ""}`, { lane });
  if (second) return refused(callId, args, { kind: "prompt", why: second, line: promptRefusalLineFor(second, "picture", audience.actor, audience.band, sentPrompt, PROMPT_REFUSAL_LINE[second]) });
  if (plan && !plan.ok) return refused(callId, args, { kind: "plan", why: "style_plan", line: plan.line });
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
      subjectIds: resolvedSubjects.map(({ subject }) => subject.id),
      conversationId: state.conversationId,
      turnId: state.turnId,
      companionId: state.persona?.id ?? null,
      temporary,
      kind: "generate",
      prompt: subjectPrompt,
      tier: jobTier("image", tierAsked.tier, choice.quality),
      body: {
        prompt: kid ? forceCartoon(subjectPrompt) : subjectPrompt,
        size,
        n: kid ? Math.min(count, KID_MAX_COUNT) : count,
        ...(choice.model ? { model: choice.model } : {}),
        // Only an adult whose household allows adult-only styles is ever sent as `adult`: a teen and a child are always `all-ages`.
        audience: lane === "adult" && adultStylesAllowed() && strictAudience === "adult-only" ? "adult" : "all-ages",
        ...(plan?.ok ? { loras: plan.loras.map((lora) => ({ id: lora.id, scale: lora.strength })) } : adapter ? { loras: [{ id: adapter.id, scale: adapter.strength_default }] } : {}),
        ...(kid ? { negative_prompt: CHILD_NEGATIVE_PROMPT } : {}),
      },
      ...(subjectRefs.length ? { submit: async () => {
        const form = new FormData();
        form.append("image", new File([new Uint8Array(subjectRefs[0]!.bytes)], "subject-reference", { type: subjectRefs[0]!.mediaType }));
        form.append("operation", "edit");
        form.append("instruction", subjectPrompt);
        form.append("image_source", "uploaded");
        if (subjectRefs[1] && (engine.edit?.references ?? 0) > 0) {
          form.append("reference", new File([new Uint8Array(subjectRefs[1].bytes)], "subject-reference-2", { type: subjectRefs[1].mediaType }));
          form.append("reference_source", "uploaded");
        }
        form.append("timeout_ms", "1");
        const { submitEdit } = await import("./stack");
        return { ...(await submitEdit(form)), done: null };
      } } : {}),
      ...(template?.transparent ? { onDone: async (fileId: string) => {
        await templateMediaOpRunner(state.actor as PersonRow, BACKGROUND_REMOVAL_OP, { source: { kind: "picture", via: "chat", id: fileId, conversationId: state.conversationId ?? "" }, args: {} }, input.signal);
      } } : {}),
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
