// IMGEDIT-01: the chat tool's edit half. `generate_image` with `change` set changes a picture the person already has
// ("remove the man on the left", "make the sky clear", "make the car yellow", "add her to this picture") instead of making
// a new one. The model decides that an edit is wanted and says in its arguments what to change; this file never reads the
// person's wording to decide anything (rule 1). Home then picks the method:
//   - remove_people: Apple's on-device person finder, a reader that picks the person, LaMa fills the place. Nothing is
//     drawn, so it needs no consent question and works on any picture the person may open in the editor.
//   - everything else: the picture engine's instruction edit (FLUX.2 Klein 4B, with up to two reference pictures).
// Safety is the editor's, not a copy of it: the age and surface gate and the two absolute lines already ran; a photo
// somebody brought is changed only if it shows no one or one household adult who agreed (editSources.ts); a reference
// photo of a person is a photo of a household adult who agreed, with its own signed proof; the finished picture goes
// through the same finished-picture check as every picture (jobs.ts finish). The original is never touched: the result
// is the next version of the picture, so the editor shows the Original and Undo. Logs carry no picture and no words.
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { latestTemporaryChatImage } from "@/lib/attachments";
import { generatedPictureLikeness, isGeneratedPicture, loadSource, ImageEditError, type SourcePicture } from "@/lib/imageEdit";
import { attestedAdult, WHO_IS_IN_PHOTO_LINE } from "@/lib/likeness/resolve";
import { inspectPhoto } from "@/lib/likeness/inspector";
import { recordLikenessUse } from "@/lib/likeness/uses";
import { MANY_PEOPLE_LINE } from "@/lib/likeness/apply";
import type { JobLikeness } from "@/lib/likeness/guard";
import type { ToolExecutionOutcome, TurnState } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import type { PersonRow } from "@/types";
import { prepareEditSource, type EditImageSource } from "./editSources";
import sharp from "sharp";
import { choosePeople, erasePeople, findPeople, FreezeError, freezePeople, inverseMask, maskCoverage, peopleMask, peopleMaskWithCount, PeopleError, PEOPLE_UNSURE_LINE, runPictureTool } from "./people";
import { asksToUndress, peopleGuidanceSuffix, peoplePromptsOn, PROMPT_REFUSAL_LINE, type PictureAudience } from "./policy";
import { startPictureJob, plainFailure } from "./jobs";
import { pictureEngineStatus } from "./ready";
import { cancelOrDelete, fetchPicture, getGenerationJob, StackPicturesError, submitEdit, type StackPic } from "./stack";

export const GENERATE_IMAGE_TOOL_ID = "generate_image";
export const EDIT_KINDS = ["remove_people", "remove_background", "upscale", "change"] as const;

export { WHO_IS_IN_PHOTO_LINE };
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

export async function runEditPicture(input: RunEditInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId, audience } = input;
  const actor = state.actor as PersonRow;
  const instruction = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (instruction.length < 3) return failed(callId, args, "bad_arguments", "bad_arguments");
  const temporary = state.temporary === true || state.ephemeral === true;
  const kind = args.kind === "remove_people" || args.kind === "remove_background" || args.kind === "upscale" ? args.kind : "change";

  const base = load(input, args.change === true ? "latest" : args.change);
  if (!base) return line(callId, args, typeof args.change === "string" && /^attached/i.test(args.change) ? NOT_FOUND_LINE : NOTHING_TO_CHANGE_LINE);
  const generated = await isGeneratedPicture(actor, base);
  // A picture the person did not make here may show a real person: it is never changed into something sexual.
  if (!generated && asksToUndress(instruction)) return line(callId, args, PROMPT_REFUSAL_LINE.real_person, { refused: "real_person" });
  const rootLikeness = generated ? await generatedPictureLikeness(base) : null;
  const label = instruction.replace(/\s+/g, " ").slice(0, 60);

  if (kind === "remove_background" || kind === "upscale") {
    // The Stack's non-generative tools: the same pixels, a cut-out or a bigger copy. Nothing is drawn. A picture made to look like a household adult is decided again with them.
    if (rootLikeness) {
      const prepared = await prepareEditSource({ audience, bytes: base.bytes, generated, rootLikeness, declaredSubjectId: null, text: instruction, source: "chat" });
      if (!prepared.ok) return line(callId, args, prepared.line, { refused: prepared.code });
    }
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
      return started(callId, args, job.id, kind === "upscale" ? "The picture is being made bigger." : "The background is being removed.");
    } catch (error) {
      return startFailure(callId, args, error);
    }
  }

  if (kind === "remove_people") {
    const status = await pictureEngineStatus().catch(() => null);
    // A picture made to look like a household adult is decided again with them, even to take someone out of it.
    if (rootLikeness) {
      const prepared = await prepareEditSource({ audience, bytes: base.bytes, generated, rootLikeness, declaredSubjectId: null, text: instruction, source: "chat" });
      if (!prepared.ok) return line(callId, args, prepared.line, { refused: prepared.code });
    }
    const who = typeof args.who === "string" && args.who.trim() ? args.who.trim() : instruction;
    try {
      const job = await startPictureJob({
        actor, conversationId: state.conversationId, turnId: state.turnId, temporary, kind: "edit", prompt: instruction,
        body: { prompt: instruction, audience: "all-ages" },
        edit: { sourceId: base.id, label: `Removed: ${label}`, method: "erase_people" },
        local: async (progress, signal) => {
          progress("finding people", 10);
          const found = await findPeople(base.bytes, base.mediaType, signal);
          const chosen = await choosePeople(found.people, found.overlay, who);
          if (!chosen) throw new PeopleError("unsure", PEOPLE_UNSURE_LINE);
          progress("removing people", 40);
          // A picture made here is filled by the picture model inside the chosen people's outline (measured: cleaner than LaMa and 2.6 s); anything else, or any trouble with that, is filled by LaMa, which draws nothing.
          if (generated && !rootLikeness && status?.edit?.masked) {
            try {
              const mask = await peopleMask(base.bytes, base.mediaType, chosen, signal);
              return await maskedFill(base, mask, "Remove everything inside the masked area and fill it with the surroundings: the same ground, buildings, sky and light. Keep everything else exactly the same.", progress, signal);
            } catch (error) {
              if (signal.aborted) throw error;
            }
          }
          const erased = await erasePeople(base.bytes, base.mediaType, chosen, signal);
          const pic: StackPic = { b64_json: Buffer.from(erased.png).toString("base64"), width: erased.width, height: erased.height, model: erased.model, ms: erased.ms };
          return [pic];
        },
      });
      return started(callId, args, job.id, "The person (or people) you asked about are being taken out of the picture and the background filled in.");
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

  // The person named is the one in the reference when there is one (the person to add), else the one in the picture being changed.
  // The model's `photo_subject` is a proposal, never the attestation: it counts only when the person's own message names or claims that adult.
  const photoWithPerson = ref ?? base;
  const declared = attestedAdult(args.photo_subject, state.utterance, actor, { photoKeys: [photoWithPerson.sha256, photoWithPerson.rootId], on: !peoplePromptsOn() }).attested;
  const named = typeof args.photo_subject === "string" && args.photo_subject.trim() !== "";

  const basePrep = await prepareEditSource({ audience, bytes: base.bytes, generated, rootLikeness, declaredSubjectId: ref ? null : declared?.id ?? null, text: instruction, source: "chat" });
  // IMGEDIT-05 (owner's ruling): a change that is not about a person (sky, colour, background, an object, the light) is allowed on a photo that
  // shows people by freezing them: after the edit every pixel inside every person's outline is put back from the original and the result is
  // proved identical there. People are never altered by it. A change that targets a person goes through the likeness rules below, as before.
  if (!basePrep.ok && basePrep.code === "photo_has_person" && !ref && !declared && args.affects_people !== true) {
    try {
      const job = await startPictureJob({
        actor, conversationId: state.conversationId, turnId: state.turnId, temporary, kind: "edit", prompt: instruction,
        body: { prompt: instruction, audience: "all-ages" },
        edit: { sourceId: base.id, label, method: "instruct" },
        local: async (progress, signal) => {
          progress("finding people", 10);
          // The picture is read the way the tools read it (orientation applied) so the outlines and the pixels line up.
          const upright = new Uint8Array(await sharp(base.bytes, { failOn: "error", limitInputPixels: 64_000_000 }).rotate().png().toBuffer());
          const cannotKeep = "I can't tell where every person in this photo is, so I won't change it. Open it with Edit and paint the part you want changed.";
          const found = await peopleMaskWithCount(upright, "image/png", "all", signal).catch((error) => {
            // The person finder found none: the people cannot be kept safe, so nothing is changed.
            if (error instanceof PeopleError && error.code === "none") throw new PeopleError("failed", cannotKeep);
            throw error;
          });
          // Fail closed: the finder must account for every person the household's own model counts, and its outline must not be empty.
          const facts = await inspectPhoto(upright);
          if (!facts || found.people === 0 || found.people < facts.people || (await maskCoverage(found.png)) === 0) throw new PeopleError("failed", cannotKeep);
          const outline = found.png;
          const background = await inverseMask(outline);
          const form = new FormData();
          form.append("image", new File([upright], "picture", { type: "image/png" }));
          // Only the background can change: the engine is given the inverse of the people's outline as its mask, with no soft edge.
          form.append("mask", new File([background], "mask.png", { type: "image/png" }));
          form.append("feather", "0");
          form.append("operation", "edit_masked");
          form.append("instruction", `${instruction}. Do not change any person: keep every person, face, hand, pose and piece of clothing exactly as it is.`);
          form.append("image_source", "uploaded");
          form.append("timeout_ms", "1");
          const edited = await runStackEdit(form, progress, signal);
          progress("keeping people", 96);
          let kept: Uint8Array;
          try { kept = await freezePeople(upright, edited.raw, outline); } catch (error) {
            if (error instanceof FreezeError) throw new PeopleError("failed", "I couldn't keep the people exactly as they were, so I changed nothing. Try again.");
            throw error;
          }
          return [{ b64_json: Buffer.from(kept).toString("base64"), model: edited.meta?.model, ms: edited.meta?.ms }];
        },
      });
      return started(callId, args, job.id, "The change is being made, and the people in the picture are kept exactly as they are.");
    } catch (error) {
      return startFailure(callId, args, error);
    }
  }
  if (!basePrep.ok && basePrep.code === "photo_has_person" && named && !declared) return line(callId, args, WHO_IS_IN_PHOTO_LINE, { refused: "who_is_in_photo" });
  if (!basePrep.ok) return line(callId, args, basePrep.line, { refused: basePrep.code });
  let refPrep: Awaited<ReturnType<typeof prepareEditSource>> | null = null;
  let refGenerated = false;
  if (ref) {
    refGenerated = await isGeneratedPicture(actor, ref);
    const refLikeness = refGenerated ? await generatedPictureLikeness(ref) : null;
    refPrep = await prepareEditSource({ audience, bytes: ref.bytes, generated: refGenerated, rootLikeness: refLikeness, declaredSubjectId: declared?.id ?? null, text: instruction, source: "chat" });
    if (!refPrep.ok) return line(callId, args, refPrep.code === "photo_has_person" || (named && !declared) ? WHO_IS_IN_PHOTO_LINE : refPrep.line, { refused: refPrep.code === "photo_has_person" ? "who_is_in_photo" : refPrep.code });
  } else if (named && !declared && !rootLikeness && !generated) {
    return line(callId, args, WHO_IS_IN_PHOTO_LINE, { refused: "who_is_in_photo" });
  }
  const subjects = [basePrep.subjectId, refPrep && refPrep.ok ? refPrep.subjectId : null].filter((id): id is string => !!id);
  if (new Set(subjects).size > 1) return line(callId, args, MANY_PEOPLE_LINE);
  const likeness: JobLikeness | undefined = basePrep.likeness ?? (refPrep && refPrep.ok ? refPrep.likeness : undefined);
  const household = basePrep.imageSource === "household_photo" || (refPrep && refPrep.ok && refPrep.imageSource === "household_photo");

  const buildForm = (baseSource: EditImageSource): FormData => {
    const form = new FormData();
    form.append("image", new File([new Uint8Array(base.bytes)], "picture", { type: base.mediaType }));
    form.append("operation", "edit");
    form.append("instruction", instruction);
    form.append("image_source", baseSource);
    if (basePrep.proof) form.append("consent_proof", basePrep.proof);
    if (household) form.append("audience", "adult");
    if (ref && refPrep && refPrep.ok) {
      form.append("reference", new File([new Uint8Array(ref.bytes)], "reference", { type: ref.mediaType }));
      form.append("reference_source", refPrep.imageSource);
      if (refPrep.proof) form.append("reference_proof", refPrep.proof);
    }
    form.append("timeout_ms", "1");
    return form;
  };
  try {
    const job = await startPictureJob({
      actor, conversationId: state.conversationId, turnId: state.turnId, temporary, kind: "edit", prompt: instruction,
      body: { prompt: instruction, audience: household ? "adult" : "all-ages" },
      edit: { sourceId: base.id, label: label, method: "instruct" },
      ...(likeness ? { likeness } : {}),
      // A version the editor re-encoded is not in the Stack's ledger of its own pictures; it is then sent as what it is, an upload with no person (as Comment does).
      submit: async () => {
        try { return { ...(await submitEdit(buildForm(basePrep.imageSource))), done: null }; } catch (error) {
          if (basePrep.imageSource === "generated" && error instanceof StackPicturesError && error.code === "reference_not_generated") return { ...(await submitEdit(buildForm("uploaded"))), done: null };
          throw error;
        }
      },
    });
    for (const subjectId of new Set(subjects)) await recordLikenessUse({ subjectPersonId: subjectId, requesterPersonId: actor.id, medium: "picture", way: "photo", adultContent: false, source: "chat" });
    return started(callId, args, job.id, ref ? "The change, using the second picture, is being made." : "The change is being made.");
  } catch (error) {
    return startFailure(callId, args, error);
  }
}

/** A masked picture-engine edit run to its end inside a Home job: only the masked area can differ from the original. */
async function maskedFill(base: SourcePicture, mask: Uint8Array, instruction: string, progress: (phase: string, percent: number) => void, signal: AbortSignal): Promise<StackPic[]> {
  const form = new FormData();
  form.append("image", new File([new Uint8Array(base.bytes)], "picture", { type: base.mediaType }));
  form.append("mask", new File([new Uint8Array(mask)], "mask.png", { type: "image/png" }));
  form.append("operation", "edit_masked");
  form.append("instruction", instruction);
  form.append("image_source", "generated");
  form.append("timeout_ms", "1");
  const done = await runStackEdit(form, progress, signal);
  return [{ b64_json: Buffer.from(done.raw).toString("base64"), width: done.meta?.width, height: done.meta?.height, model: done.meta?.model, ms: done.meta?.ms }];
}

/** Submits an edit form and waits for the picture engine to finish it; returns the PNG bytes. */
async function runStackEdit(form: FormData, progress: (phase: string, percent: number) => void, signal: AbortSignal): Promise<{ raw: Uint8Array; meta: StackPic | undefined }> {
  let job: string;
  try { job = (await submitEdit(form)).job; } catch (error) {
    if (error instanceof StackPicturesError && error.code === "reference_not_generated") { form.set("image_source", "uploaded"); job = (await submitEdit(form)).job; } else throw error;
  }
  try {
    for (let i = 0; i < 600 && !signal.aborted; i += 1) {
      const status = await getGenerationJob(job);
      if (status.state === "done") {
        const raw = await fetchPicture(job, 0);
        return { raw, meta: status.data[0] };
      }
      if (status.state === "failed" || status.state === "cancelled") throw new PeopleError("failed", status.error ?? "The picture model could not fill the place.");
      progress(form.get("operation") === "edit_masked" ? "removing people" : "changing", 40 + Math.max(0, Math.min(55, status.progress * 0.55)));
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    throw new PeopleError("failed", "It took longer than expected.");
  } finally {
    void cancelOrDelete(job);
  }
}

function started(callId: string, args: Record<string, unknown>, jobId: string, what: string): ToolExecutionOutcome {
  return outcomeOf({
    callId, packageId: GENERATE_IMAGE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: {
      reply: { text: `${what} The changed picture appears below your reply when it is ready, and the original stays as it was (Edit on the picture shows both, with Undo). You have not seen the result: do not describe how it looks. Tell the person in one short sentence that it is on its way.${peopleGuidanceSuffix()}` },
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
