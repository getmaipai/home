// IMGEDIT-01: the chat tool's edit half. `generate_image` with `change` set changes a picture the person already has
// ("make the sky clear", "make the car yellow", "add her to this picture") instead of making
// a new one. The model decides that an edit is wanted and says in its arguments what to change; this file never reads the
// person's wording to decide anything (rule 1). The picture engine handles every requested change.
// Safety is the editor's, not a copy of it: the age and surface gate and child/CSAM checks already ran; a photo
// somebody brought is screened for CSAM and the age-specific media rules; the finished picture goes
// through the same finished-picture check as every picture (jobs.ts finish). The original is never touched: the result
// is the next version of the picture, so the editor shows the Original and Undo. Logs carry no picture and no words.
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { latestTemporaryChatImage } from "@/lib/attachments";
import { isGeneratedPicture, loadSource, ImageEditError, type SourcePicture } from "@/lib/imageEdit";
import type { ToolExecutionOutcome, TurnState } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import type { PersonRow } from "@/types";
import { prepareEditSource, type EditImageSource } from "./editSources";
import { runPictureTool } from "./people";
import { attachKid, CHILD_LIMIT_LINE, CHILD_NO_PHOTOS_LINE, laneOf, releaseKid, reserveKid, type Lane } from "./lane";
import { PROMPT_REFUSAL_LINE, refusePrompt, type PictureAudience } from "./policy";
import { startPictureJob, plainFailure } from "./jobs";
import { pictureEngineStatus } from "./ready";
import { StackPicturesError, submitEdit } from "./stack";
import { QUICK_MODEL } from "./quality";

export const GENERATE_IMAGE_TOOL_ID = "generate_image";

/** Every Stack edit operation, including reference edits, is handled by Klein. */
export function nameEditModel(form: FormData): void {
  form.set("model", QUICK_MODEL);
}

const NOT_FOUND_LINE = "I can't find that picture any more. Attach it again and ask once more.";
const NOTHING_TO_CHANGE_LINE = "There is no picture to change yet. Attach one, or ask me to make one first.";
const EDIT_NOT_SET_UP_LINE = "Changing a picture needs the picture model to be installed and running on this computer. An admin can check Settings, Pictures and videos.";
const REFERENCES_MISSING_LINE = "The picture engine on this computer needs its next update before it can use a second picture. I can still change the one picture on its own.";

export interface RunEditInput {
  state: Pick<TurnState, "actor" | "conversationId" | "turnId" | "temporary" | "ephemeral" | "images"> & Partial<Pick<TurnState, "utterance">>;
  args: Record<string, unknown>;
  callId: string;
  audience: PictureAudience;
}

function line(callId: string, args: Record<string, unknown>, text: string, data: Record<string, unknown> = {}): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No picture was changed. Say this to the person in your own words and keep its meaning: ${text}` }, data, actions: [] } });
}
function failed(callId: string, args: Record<string, unknown>, code: string, kind: "unavailable" | "errored" | "bad_arguments", detail?: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0, ...(detail ? { detail } : {}) });
}

/** The newest picture in the conversation this person may change (attached, made or an earlier version), or null. */
export function latestPictureId(actor: PersonRow, conversationId: string, temporary: boolean): string | null {
  if (temporary) return latestTemporaryChatImage(actor, conversationId)?.id ?? null;
  const row = db.select({ id: attachments.id }).from(attachments)
    .where(and(eq(attachments.conversationId, conversationId), eq(attachments.ownerPersonId, actor.id), like(attachments.mediaType, "image/%")))
    .orderBy(desc(attachments.createdAt), desc(attachments.hlc)).get();
  return row?.id ?? null;
}

/** `attached` (the first picture on this message), `attached_2` (the second), `latest` (the newest in this chat) or a picture id of this chat. */
function pictureIdFor(input: RunEditInput, word: unknown): string | null {
  const token = typeof word === "string" ? word.trim() : "";
  if (!token) return null;
  const attached = input.state.images ?? [];
  const lower = token.toLowerCase();
  if (lower === "attached" || lower === "attached_1") return attached[0]?.id ?? null;
  if (lower === "attached_2") return attached[1]?.id ?? null;
  if (/^(latest|last|this|that|it)$/.test(lower)) return latestPictureId(input.state.actor as PersonRow, input.state.conversationId, input.state.temporary === true || input.state.ephemeral === true);
  return token;
}

function load(input: RunEditInput, word: unknown): SourcePicture | null {
  const id = pictureIdFor(input, word);
  if (!id) return null;
  try { return loadSource(input.state.actor as PersonRow, input.state.conversationId, id, true); } catch (error) {
    if (error instanceof ImageEditError) return null;
    throw error;
  }
}

/** A child's edit of their own cartoon takes one of the day's pictures (taken in one step with the check, given back if nothing started). */
export async function runEditPicture(input: RunEditInput): Promise<ToolExecutionOutcome> {
  if (laneOf(input.audience) !== "child") return runEditPictureUnmetered(input);
  const actor = input.state.actor as PersonRow;
  const instruction = typeof input.args.prompt === "string" ? input.args.prompt : "";
  const slot = reserveKid(actor, "edit", 1, instruction);
  if (!slot) return line(input.callId, input.args, CHILD_LIMIT_LINE, { refused: "daily_limit" });
  let outcome: ToolExecutionOutcome | null = null;
  try { outcome = await runEditPictureUnmetered(input); return outcome; } finally {
    const started = (outcome?.result?.data as { pictureJobId?: string } | undefined)?.pictureJobId;
    if (started) attachKid(slot, started); else releaseKid(slot);
  }
}

async function runEditPictureUnmetered(input: RunEditInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId, audience } = input;
  const actor = state.actor as PersonRow;
  const instruction = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (instruction.length < 3) return failed(callId, args, "bad_arguments", "bad_arguments");
  const temporary = state.temporary === true || state.ephemeral === true;
  const refused = refusePrompt(instruction, { lane: laneOf(audience) });
  if (refused) return line(callId, args, PROMPT_REFUSAL_LINE[refused], { refused });
  const kind = args.kind === "remove_background" || args.kind === "upscale" ? args.kind : "change";
  const kid = laneOf(audience) === "child";
  // KIDS-CREATE-01: a child changes only the cartoons made for them: no photo or second picture.
  if (kid && typeof args.reference === "string" && args.reference.trim() !== "") return line(callId, args, CHILD_NO_PHOTOS_LINE, { refused: "child_cartoons_only" });

  const base = load(input, args.change === true ? "latest" : args.change);
  if (!base) return line(callId, args, kid && typeof args.change === "string" && /^attached/i.test(args.change) ? CHILD_NO_PHOTOS_LINE : typeof args.change === "string" && /^attached/i.test(args.change) ? NOT_FOUND_LINE : NOTHING_TO_CHANGE_LINE);
  const generated = await isGeneratedPicture(actor, base);
  if (kid && !generated) return line(callId, args, CHILD_NO_PHOTOS_LINE, { refused: "child_cartoons_only" });
  const label = instruction.replace(/\s+/g, " ").slice(0, 60);

  if (kind === "remove_background" || kind === "upscale") {
    // The Stack's non-generative tools: the same pixels, a cut-out or a bigger copy.
    try {
      const job = await startPictureJob({
        actor, conversationId: state.conversationId, turnId: state.turnId, temporary, kind: "edit", prompt: instruction,
        body: { prompt: instruction, audience: "all-ages" },
        edit: { sourceId: base.id, label: kind === "upscale" ? "Enlarged" : "Background removed", method: "tool" },
        local: async (progress, signal) => {
          progress(kind === "upscale" ? "enlarging" : "removing background", 20);
          const made = await runPictureTool(kind, base.bytes, base.mediaType, kind === "upscale" ? { scale: "2" } : {}, signal);
          return [{ b64_json: Buffer.from(made.png).toString("base64"), width: made.width, height: made.height, model: made.model, ms: made.ms }];
        },
      });
      return started(callId, args, job.id, kind === "upscale" ? "The picture is being made bigger." : "The background is being removed.", laneOf(audience));
    } catch (error) {
      return startFailure(callId, args, error);
    }
  }

  // ---- a change in words (the picture engine's instruction edit)
  const status = await pictureEngineStatus().catch(() => null);
  if (!status || status.available === false || !status.edit?.generative) return failed(callId, args, "no_engine", "unavailable", "no picture model that can change a picture is installed on the Stack");

  const ref = args.reference !== undefined && args.reference !== null && String(args.reference).trim() !== "" ? load(input, args.reference) : null;
  if (args.reference !== undefined && args.reference !== null && String(args.reference).trim() !== "" && !ref) return line(callId, args, NOT_FOUND_LINE);
  if (ref && (status.edit.references ?? 0) < 1) return line(callId, args, REFERENCES_MISSING_LINE);
  if (ref && ref.id === base.id) return line(callId, args, "The second picture has to be a different picture from the one you want changed.");

  const basePrep = await prepareEditSource({ audience, bytes: base.bytes, generated, text: instruction });
  if (!basePrep.ok) return line(callId, args, basePrep.line, { refused: basePrep.code });
  let refPrep: Awaited<ReturnType<typeof prepareEditSource>> | null = null;
  let refGenerated = false;
  if (ref) {
    refGenerated = await isGeneratedPicture(actor, ref);
    refPrep = await prepareEditSource({ audience, bytes: ref.bytes, generated: refGenerated, text: instruction });
    if (!refPrep.ok) return line(callId, args, refPrep.line, { refused: refPrep.code });
  }

  const buildForm = (baseSource: EditImageSource): FormData => {
    const form = new FormData();
    form.append("image", new File([new Uint8Array(base.bytes)], "picture", { type: base.mediaType }));
    form.append("operation", "edit");
    nameEditModel(form);
    form.append("instruction", kid ? `${instruction}. Keep it a friendly children's cartoon drawing, not a photograph.` : instruction);
    form.append("image_source", baseSource);
    if (ref && refPrep && refPrep.ok) {
      form.append("reference", new File([new Uint8Array(ref.bytes)], "reference", { type: ref.mediaType }));
      form.append("reference_source", refPrep.imageSource);
    }
    form.append("timeout_ms", "1");
    return form;
  };
  try {
    const job = await startPictureJob({
      actor, conversationId: state.conversationId, turnId: state.turnId, temporary, kind: "edit", prompt: instruction,
      body: { prompt: instruction, audience: laneOf(audience) === "adult" ? "adult" : "all-ages" },
      edit: { sourceId: base.id, label, method: "instruct" },
      // A version the editor re-encoded is not in the Stack's ledger of its own pictures; it is then sent as what it is, an upload with no person (as Comment does).
      submit: async () => {
        try { return { ...(await submitEdit(buildForm(basePrep.imageSource))), done: null }; } catch (error) {
          if (basePrep.imageSource === "generated" && error instanceof StackPicturesError && error.code === "reference_not_generated") return { ...(await submitEdit(buildForm("uploaded"))), done: null };
          throw error;
        }
      },
    });
    return started(callId, args, job.id, ref ? "The change, using the second picture, is being made." : "The change is being made.", laneOf(audience));
  } catch (error) {
    return startFailure(callId, args, error);
  }
}

function started(callId: string, args: Record<string, unknown>, jobId: string, what: string, lane: Lane): ToolExecutionOutcome {
  return outcomeOf({
    callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: {
      reply: { text: `${what} The changed picture appears below your reply when it is ready, and the original stays as it was (Edit on the picture shows both, with Undo). You have not seen the result: do not describe how it looks. Tell the person in one short sentence that it is on its way.` },
      data: { pictureJobId: jobId },
      actions: [],
    },
  });
}

function startFailure(callId: string, args: Record<string, unknown>, error: unknown): ToolExecutionOutcome {
  if (error instanceof StackPicturesError && (error.code === "unreachable" || error.code === "no_stack" || error.code === "not_installed" || error.code === "unsupported" || error.code === "no_memory" || error.code === "queue_full")) {
    return failed(callId, args, error.code, "unavailable", plainFailure(error));
  }
  if (error instanceof StackPicturesError && (error.status === 403 || error.status === 422)) return line(callId, args, error.message, { refused: error.code });
  return failed(callId, args, error instanceof StackPicturesError ? error.code : "failed", "errored", plainFailure(error instanceof StackPicturesError ? error : null));
}

export { EDIT_NOT_SET_UP_LINE };
