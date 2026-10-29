import { ArtWithheldError, checkCompanionArt, requireCompanionPictureOk } from "@/lib/companionArtCheck";
import sharp from "sharp";
import media from "@maipai/spec/vocab/companion-media.json";
import { capOfStyle, type LookStyleId } from "@/lib/companionLookStyles";
import { addVersion, chooseKeyColour, describeCharacter, keyOut, keyRgb, lookPromptFor, normalizePicture, readLook, updateSheet, versionOriginalPath, versionPath } from "@/lib/companionLook";
import { fitToFrame } from "@/lib/imaging/fit";
import { imagingTargets } from "@/lib/imaging/targets";
import { clippedEdges } from "@/lib/imaging/subject";
import { removeBackground } from "@/lib/imaging/tools";
import { compositeOnNeutral, cutOutBackground } from "@/lib/imaging/backdrop";
import { routeAudience } from "@/lib/pictures/audience";
import { prepareEditSource } from "@/lib/pictures/editSources";
import { laneOf } from "@/lib/pictures/lane";
import { pictureDenial, PICTURE_DENIAL_LINE, PROMPT_REFUSAL_LINE, refusePrompt } from "@/lib/pictures/policy";
import { resolveCompanionStill, resolveCompanionEdit, promptHash, COMPANION_MODEL_MISMATCH_LINE } from "@/lib/companionArt";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { cancelOrDelete, fetchPicture, getGenerationJob, submitEdit, submitGeneration } from "@/lib/pictures/stack";
import { promptRefusalLineFor } from "@/lib/pictures/ageCheck";
import { readFileSync } from "node:fs";
import type { PersonRow } from "@/types";
import { companionHasFinishingJob } from "@/lib/companionStates";
import { companionHasTakeRun, TAKE_RUN_BUSY_LINE } from "@/lib/companionTakes";

export const LOOK_JOB_BUSY_LINE = "A picture is already being made for this companion. Wait for it or stop it.";
export const LOOK_PICTURE_UNREAD_LINE = "Home could not read this picture to describe it. Write a look prompt that says what the character looks like, then try again.";
export const LOOK_PROMPT_REQUIRED_LINE = "Write a look prompt first: say what the character looks like.";
export const LOOK_EDIT_PROMPT_LINE = "Say what to change, then send it.";
export const LOOK_ENGINE_NOT_READY_LINE = "Picture creation isn't set up yet. An admin can add a picture model in Settings, Pictures and videos.";

function busyLineFor(companionId: string): string {
  return companionHasFinishingJob(companionId) || companionHasTakeRun(companionId) ? TAKE_RUN_BUSY_LINE : LOOK_JOB_BUSY_LINE;
}

export type LookJobState = "queued" | "running" | "done" | "failed" | "cancelled";
export interface LookJob {
  companionId: string;
  personId: string;
  state: LookJobState;
  percent: number;
  versions: string[];
  error: string | null;
  count: number;
  key: string;
  sourceVersion: string | null;
  instruction: string | null;
  model: string;
  quality: "quick" | "detailed";
  promptHash: string;
  modelReported: string | null;
  style?: string;
  /** Fit the finished picture to the portrait frame so the subject fills it, for pictures whose subject comes back smaller. */
  fitSubject?: boolean;
  finalising?: Promise<void>;
}
interface SheetJob { companionId: string; personId: string; state: LookJobState; percent: number; versions: string[]; error: string | null; stackJob: string; index: number; model: string; quality: "quick" | "detailed"; promptHash: string; modelReported: string | null; finalising?: Promise<void> }
const jobs = new Map<string, LookJob>();
const activeByCompanion = new Map<string, string>();
const startingCompanions = new Set<string>();
const SHEET_VIEWS = [
  { slot: "left" as const, label: "Turned left", prompt: "Turn the character to face three quarters to its left. Keep the exact same character: same colours, same face, same nose, same clothes, same proportions. Keep a plain solid light grey background." },
  { slot: "right" as const, label: "Turned right", prompt: "Turn the character to face three quarters to its right. Keep the exact same character: same colours, same face, same nose, same clothes, same proportions. Keep a plain solid light grey background." },
  { slot: "mouth" as const, label: "Mouth open", prompt: "Keep the exact same character and pose, but open the mouth as if speaking. Same colours, same face, same nose, same clothes. Keep a plain solid light grey background." },
];
const sheetJobs = new Map<string, SheetJob>();

/** The character sheet job still being made for this companion, so a second Approve joins it instead of starting another. */
export function runningSheetJob(companionId: string): string | null {
  const id = activeByCompanion.get(companionId), job = id ? sheetJobs.get(id) : undefined;
  return id && job && !(["done", "failed", "cancelled"] as string[]).includes(job.state) ? id : null;
}

const cutOut = (actor: PersonRow, png: Uint8Array, key: string) => cutOutBackground(png, { remove: (bytes) => removeBackground(actor, bytes), key: { rgb: keyRgb(key), strip: (bytes) => keyOut(bytes, key) } });

export function __clearCompanionLookJobsForTests(): void { jobs.clear(); sheetJobs.clear(); activeByCompanion.clear(); startingCompanions.clear(); }
/** What a picture job is doing for this companion right now, for screens that must not offer a second one. */
export function activeLookInfo(companionId: string): { kind: "sheet" | "picture"; label: string; percent: number } | null {
  const id = activeByCompanion.get(companionId), job = id ? jobs.get(id) : undefined, sheetJob = id ? sheetJobs.get(id) : undefined;
  if (sheetJob && (sheetJob.state === "queued" || sheetJob.state === "running")) return { kind: "sheet", label: "Getting your character ready", percent: sheetJob.percent };
  if (job && (job.state === "queued" || job.state === "running")) return { kind: "picture", label: "Making a picture", percent: job.percent };
  return startingCompanions.has(companionId) ? { kind: "picture", label: "Starting a picture", percent: 0 } : null;
}
export function activeLookJob(companionId: string): boolean {
  const id = activeByCompanion.get(companionId), job = id ? jobs.get(id) : null, sheetJob = id ? sheetJobs.get(id) : null;
  return startingCompanions.has(companionId) || Boolean((job && (job.state === "queued" || job.state === "running")) || (sheetJob && (sheetJob.state === "queued" || sheetJob.state === "running")));
}

export function lookGenerationGate(actor: PersonRow, prompt: string): { status: 403 | 422; error: string } | null {
  const audience = routeAudience(actor);
  const denial = pictureDenial(audience);
  if (denial) return { status: 403, error: PICTURE_DENIAL_LINE[denial] };
  const refused = refusePrompt(prompt, { lane: laneOf(audience) });
  if (refused) return { status: 422, error: promptRefusalLineFor(refused, "picture", actor, audience.band, prompt, PROMPT_REFUSAL_LINE[refused]) };
  return null;
}

export function lookStyleGate(actor: PersonRow, style: LookStyleId): { status: 422; error: string } | null {
  const band = routeAudience(actor).band, cap = capOfStyle(style);
  const allowed = band === "adult" || (band === "teen" && cap !== "adult");
  return allowed ? null : { status: 422, error: "Pick another style that is available for your age." };
}

export async function canGenerateLook(actor: PersonRow, companionId: string): Promise<{ can_generate: boolean; generate_reason?: string }> {
  const audience = routeAudience(actor);
  const denial = pictureDenial(audience);
  if (denial) return { can_generate: false, generate_reason: PICTURE_DENIAL_LINE[denial] };
  if (!(await pictureEngineReady())) return { can_generate: false, generate_reason: LOOK_ENGINE_NOT_READY_LINE };
  if (activeLookJob(companionId) || companionHasFinishingJob(companionId) || companionHasTakeRun(companionId)) return { can_generate: false, generate_reason: busyLineFor(companionId) };
  return { can_generate: true };
}

function register(jobId: string, job: LookJob): void {
  jobs.set(jobId, job);
  activeByCompanion.set(job.companionId, jobId);
}

export async function startLookGeneration(input: { actor: PersonRow; companionId: string; lookPrompt: string; prompt?: string; style?: LookStyleId; customStyle?: string; count: number }): Promise<string> {
  const denial = pictureDenial(routeAudience(input.actor));
  if (denial) throw Object.assign(new Error(PICTURE_DENIAL_LINE[denial]), { status: 403 });
  const style = input.style ?? "cartoon", styleDenied = lookStyleGate(input.actor, style);
  if (styleDenied) throw Object.assign(new Error(styleDenied.error), { status: styleDenied.status });
  if (style === "custom" && (!input.customStyle?.trim() || input.customStyle.trim().length > 120)) throw Object.assign(new Error("Enter a custom style from 1 to 120 characters."), { status: 400 });
  const promptText = input.prompt?.trim() || input.lookPrompt.trim();
  if (!promptText) throw Object.assign(new Error(LOOK_PROMPT_REQUIRED_LINE), { status: 400 });
  const prompt = lookPromptFor(promptText, readLook(input.companionId).key, style, input.customStyle);
  const denied = lookGenerationGate(input.actor, prompt);
  if (denied) throw Object.assign(new Error(denied.error), { status: denied.status });
  if (!(await pictureEngineReady())) throw Object.assign(new Error(LOOK_ENGINE_NOT_READY_LINE), { status: 503 });
  const art = await resolveCompanionStill();
  if (activeLookJob(input.companionId) || companionHasFinishingJob(input.companionId) || companionHasTakeRun(input.companionId)) throw Object.assign(new Error(busyLineFor(input.companionId)), { status: 409 });
  const key = readLook(input.companionId).key;
  startingCompanions.add(input.companionId);
  try {
    const submitted = await submitGeneration({ prompt, model: art.model, size: `${media.image.size}x${media.image.size}`, n: input.count, seed: Math.floor(Math.random() * 2_147_483_647), audience: "all-ages", timeout_ms: 1 });
    register(submitted.job, { companionId: input.companionId, personId: input.actor.id, state: "queued", percent: 0, versions: [], error: null, count: input.count, key, sourceVersion: null, instruction: null, model: art.model, quality: art.quality, promptHash: promptHash(prompt), modelReported: submitted.done?.[0]?.model ?? null, style });
    return submitted.job;
  } finally { startingCompanions.delete(input.companionId); }
}

export async function startLookEdit(input: { actor: PersonRow; companionId: string; versionId: string; instruction: string; style?: LookStyleId; customStyle?: string; forceKeyComposite?: boolean; fitSubject?: boolean }): Promise<string> {
  const denial = pictureDenial(routeAudience(input.actor));
  if (denial) throw Object.assign(new Error(PICTURE_DENIAL_LINE[denial]), { status: 403 });
  const styleDenied = lookStyleGate(input.actor, input.style ?? "cartoon");
  if (styleDenied) throw Object.assign(new Error(styleDenied.error), { status: styleDenied.status });
  if (input.style === "custom" && (!input.customStyle?.trim() || input.customStyle.trim().length > 120)) throw Object.assign(new Error("Enter a custom style from 1 to 120 characters."), { status: 400 });
  const instruction = input.instruction.trim();
  if (!instruction) throw Object.assign(new Error(LOOK_EDIT_PROMPT_LINE), { status: 400 });
  const denied = lookGenerationGate(input.actor, instruction);
  if (denied) throw Object.assign(new Error(denied.error), { status: denied.status });
  if (!(await pictureEngineReady())) throw Object.assign(new Error(LOOK_ENGINE_NOT_READY_LINE), { status: 503 });
  const art = resolveCompanionEdit();
  if (activeLookJob(input.companionId) || companionHasFinishingJob(input.companionId) || companionHasTakeRun(input.companionId)) throw Object.assign(new Error(busyLineFor(input.companionId)), { status: 409 });
  startingCompanions.add(input.companionId);
  try {
    const look = readLook(input.companionId), version = look.versions.find((item) => item.id === input.versionId), path = versionPath(input.companionId, input.versionId);
    if (!version || !path) throw Object.assign(new Error("That picture could not be found. Choose one of this companion's pictures."), { status: 404 });
    const png = new Uint8Array(readFileSync(path)), originalPath = versionOriginalPath(input.companionId, version.id);
    const sourceBytes = originalPath && !input.forceKeyComposite ? new Uint8Array(readFileSync(originalPath)) : await compositeOnNeutral(png);
    if (version.source === "upload" && routeAudience(input.actor).band === "teen") {
      const screened = await prepareEditSource({ audience: routeAudience(input.actor), bytes: sourceBytes, generated: false, text: instruction });
      if (!screened.ok) throw Object.assign(new Error(screened.line), { status: screened.status });
    }
    const form = new FormData();
    form.append("image", new File([new Uint8Array(sourceBytes)], "picture.png", { type: "image/png" }));
    form.append("operation", "edit");
    const style = input.style ?? (version.style && version.style !== "keep" ? version.style as LookStyleId : undefined);
    const stylePhrase = !style ? "" : lookPromptFor("", look.key, style, input.customStyle).replace(/^\. A single character, full body, centred in the frame, standing in a relaxed neutral pose, facing the viewer, mouth closed, arms down\./, "").replace(/ Plain solid (green|magenta) background, no shadow, no ground, no text, no other objects\.$/, "").trim();
    form.append("instruction", stylePhrase ? `${instruction}. ${stylePhrase}` : instruction);
    // Only the exact bytes the picture model made count as generated; a picture put on a backdrop or cropped is sent as a photo.
    form.append("image_source", originalPath && !input.forceKeyComposite ? "generated" : "uploaded");
    form.append("audience", "all-ages");
    form.append("timeout_ms", "1");
    form.append("model", art.model);
    form.append("seed", String(companionSeed(input.companionId)));
    const submitted = await submitEdit(form);
    register(submitted.job, { companionId: input.companionId, personId: input.actor.id, state: "queued", percent: 0, versions: [], error: null, count: 1, key: look.key, sourceVersion: version.id, instruction, model: art.model, quality: art.quality, promptHash: promptHash(instruction), modelReported: null, style, fitSubject: input.fitSubject });
    return submitted.job;
  } finally { startingCompanions.delete(input.companionId); }
}

function editForm(source: Uint8Array, instruction: string, generated: boolean): FormData {
  const form = new FormData(); form.append("image", new File([new Uint8Array(source)], "picture.png", { type: "image/png" })); form.append("operation", "edit"); form.append("instruction", instruction); form.append("image_source", generated ? "generated" : "uploaded"); form.append("audience", "all-ages"); form.append("timeout_ms", "1"); return form;
}

/** One seed per companion, so every picture drawn for it starts from the same noise and the outfit, build and face stay put from frame to frame. */
export function companionSeed(companionId: string): number {
  let hash = 2166136261;
  for (const char of companionId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

export async function startLookSheet(input: { actor: PersonRow; companionId: string; lookPrompt: string }): Promise<{ job: string; card_source: "model" | "look_prompt" }> {
  const gate = lookGenerationGate(input.actor, "Create a consistent character reference picture.");
  if (gate) throw Object.assign(new Error(gate.error), { status: gate.status });
  if (activeLookJob(input.companionId) || companionHasFinishingJob(input.companionId) || companionHasTakeRun(input.companionId)) throw Object.assign(new Error(busyLineFor(input.companionId)), { status: 409 });
  startingCompanions.add(input.companionId);
  try {
    if (!(await pictureEngineReady())) throw Object.assign(new Error(LOOK_ENGINE_NOT_READY_LINE), { status: 503 });
    const look = readLook(input.companionId), version = look.versions.find((item) => item.id === look.rest), path = look.rest ? versionPath(input.companionId, look.rest) : null;
    if (!version || !path) throw Object.assign(new Error("Choose a rest picture before making the character sheet."), { status: 400 });
    const png = new Uint8Array(readFileSync(path)), key = await chooseKeyColour(png), described = await describeCharacter(png, input.lookPrompt);
    if (!described.card.text) throw Object.assign(new Error(LOOK_PICTURE_UNREAD_LINE), { status: 400 });
    const sheet = { views: { left: null, right: null, mouth: null }, card: described.card, key, state: "making" as const, approved_by: null, approved_at: null };
    updateSheet(input.companionId, sheet);
    const originalPath = versionOriginalPath(input.companionId, version.id), sourceBytes = originalPath ? new Uint8Array(readFileSync(originalPath)) : await compositeOnNeutral(png), instruction = SHEET_VIEWS[0]!.prompt.replaceAll("<key>", key);
    const art = resolveCompanionEdit();
    const form = editForm(sourceBytes, instruction, Boolean(originalPath)); form.append("model", art.model); form.append("seed", String(companionSeed(input.companionId)));
    const submitted = await submitEdit(form);
    const job = crypto.randomUUID();
    sheetJobs.set(job, { companionId: input.companionId, personId: input.actor.id, state: "queued", percent: 0, versions: [], error: null, stackJob: submitted.job, index: 0, model: art.model, quality: art.quality, promptHash: promptHash(instruction), modelReported: null });
    activeByCompanion.set(input.companionId, job);
    return { job, card_source: described.card_source };
  } catch (error) {
    const look = readLook(input.companionId);
    if (look.sheet?.state === "making") updateSheet(input.companionId, { ...look.sheet, state: "needs_review" });
    throw error;
  } finally { startingCompanions.delete(input.companionId); }
}

export function lookJobFor(id: string, actor: PersonRow, companionId: string): LookJob | null {
  const job = jobs.get(id);
  return job?.personId === actor.id && job.companionId === companionId ? job : null;
}

function publicJob(job: LookJob) {
  const look = readLook(job.companionId);
  return { state: job.state, percent: job.percent, label: job.state === "queued" ? "Waiting to make the picture" : job.state === "running" ? "Making the picture" : job.state === "done" ? "Pictures ready" : job.state === "cancelled" ? "Picture making stopped" : "Picture making failed",
    versions: job.versions.map((id) => { const version = look.versions.find((item) => item.id === id); return { id, url: `/api/companions/${encodeURIComponent(job.companionId)}/look/${id}/image`, label: version?.label ?? "Picture" }; }), error: job.error };
}

export async function pollLookJob(id: string, actor: PersonRow, companionId: string) {
  const sheetJob = sheetJobs.get(id);
  if (sheetJob) return pollSheetJob(id, sheetJob, actor, companionId);
  const job = lookJobFor(id, actor, companionId);
  if (!job) return null;
  if (job.state === "done" || job.state === "failed" || job.state === "cancelled") return publicJob(job);
  const wasCancelled = (): boolean => job.state === "cancelled";
  try {
    const stack = await getGenerationJob(id);
    if (stack.state === "queued") { job.state = "queued"; job.percent = 0; }
    else if (stack.state === "running") {
      job.state = "running";
      const fraction = typeof stack.progress_fraction === "number" ? stack.progress_fraction * 100 : stack.progress;
      job.percent = Math.max(0, Math.min(99, Math.round(fraction)));
    }
    else if (stack.state === "failed") { job.state = "failed"; job.error = stack.error || "The picture engine could not finish. Try again."; activeByCompanion.delete(companionId); }
    else if (stack.state === "cancelled") { job.state = "cancelled"; activeByCompanion.delete(companionId); }
    else {
      if (!job.finalising) job.finalising = (async () => {
        const reported = stack.data.find((picture) => typeof picture.model === "string")?.model ?? null;
        job.modelReported = reported;
        if (reported && reported !== job.model) throw new Error(COMPANION_MODEL_MISMATCH_LINE);
        const images = await Promise.all(Array.from({ length: job.count }, (_, index) => fetchPicture(id, index)));
        const withheld: string[] = [];
        for (let index = 0; index < images.length; index++) {
          if (wasCancelled()) return;
          const checked = await checkCompanionArt(job.companionId, actor, [{ label: `Candidate ${index + 1}`, bytes: images[index]! }]);
          if (!checked.ok) { withheld.push(...checked.reasons); continue; }
          let picture = job.sourceVersion ? images[index]! : await cutOut(actor, images[index]!, job.key);
          let label = job.sourceVersion ? (job.instruction ?? "Edited picture").slice(0, 60) : `Candidate ${index + 1}`;
          if (job.sourceVersion) {
            const meta = await sharp(picture).metadata();
            if (!meta.hasAlpha) picture = await cutOut(actor, picture, job.key);
            else {
              // If the edit came back opaque, key it; transparent results retain their alpha.
              const stats = await sharp(picture).ensureAlpha().stats();
              if ((stats.channels[3]?.min ?? 255) === 255) picture = await cutOut(actor, picture, job.key);
            }
          }
          const rgba = await sharp(picture).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          let opaque = 0;
          for (let offset = 3; offset < rgba.data.length; offset += 4) if (rgba.data[offset]! > 0) opaque++;
          const fraction = opaque / (rgba.info.width * rgba.info.height);
          if (fraction < 0.05 || fraction > 0.95) label += " (check the edges)";
          const flat = await normalizePicture(picture, { removeBackground: async (bytes) => bytes });
          const normalized = job.fitSubject ? await fitToFrame(flat, imagingTargets.portrait).catch(() => flat) : flat;
          const clipped = Object.entries(await clippedEdges(normalized)).filter(([, value]) => value).map(([edge]) => edge as "left" | "right" | "top" | "bottom");
          const saved = addVersion(job.companionId, normalized, { source: job.sourceVersion ? "edit" : "generated", label, width: media.image.size, height: media.image.size, from: job.sourceVersion, style: job.style ?? (job.sourceVersion ? readLook(job.companionId).versions.find((item) => item.id === job.sourceVersion)?.style : undefined) ?? "cartoon", clipped, model: job.model, quality: job.quality, prompt_hash: job.promptHash, model_reported: reported }, images[index]!);
          job.versions.push(saved.id);
        }
        if (wasCancelled()) return;
        if (job.versions.length === 0 && withheld.length > 0) throw new ArtWithheldError([...new Set(withheld)].join(" "));
        job.state = "done"; job.percent = 100; activeByCompanion.delete(companionId);
      })();
      try { await job.finalising; } catch (error) { if (!wasCancelled()) { job.state = "failed"; job.error = error instanceof Error ? error.message : "The picture could not be saved. Try again."; activeByCompanion.delete(companionId); } }
    }
  } catch (error) {
    job.state = "failed"; job.error = error instanceof Error ? error.message : "The picture job could not be checked. Try again."; activeByCompanion.delete(companionId);
  }
  return publicJob(job);
}

async function pollSheetJob(id: string, job: SheetJob, actor: PersonRow, companionId: string) {
  if (job.personId !== actor.id || job.companionId !== companionId) return null;
  const publicState = () => { const look = readLook(companionId); return { state: job.state, percent: job.percent, label: job.state === "done" ? "Character sheet ready" : job.state === "failed" ? "Character sheet needs attention" : "Making character sheet", versions: job.versions.map((versionId) => ({ id: versionId, url: `/api/companions/${encodeURIComponent(companionId)}/look/${versionId}/image`, label: look.versions.find((v) => v.id === versionId)?.label ?? "Picture" })), error: job.error }; };
  if (["done", "failed", "cancelled"].includes(job.state)) return publicState();
  try {
    const current = await getGenerationJob(job.stackJob);
    if (current.state === "queued") job.state = "queued";
    else if (current.state === "running") { job.state = "running"; job.percent = Math.min(95, Math.round(((job.index + current.progress / 100) / 3) * 100)); }
    else if (current.state === "failed" || current.state === "cancelled") {
      const view = SHEET_VIEWS[job.index]!; job.state = "failed"; job.error = `The ${view.slot === "left" || view.slot === "right" ? "side" : "mouth-open"} view did not work. Try again.`;
      const look = readLook(companionId); if (look.sheet) updateSheet(companionId, { ...look.sheet, state: "needs_review" }); activeByCompanion.delete(companionId);
    } else if (!job.finalising) job.finalising = (async () => {
      const view = SHEET_VIEWS[job.index]!, image = await fetchPicture(job.stackJob, 0), look = readLook(companionId), key = look.sheet?.key ?? look.key, sourceVersion = look.versions.find((item) => item.id === look.rest);
      await requireCompanionPictureOk(companionId, actor, `The ${view.slot === "left" || view.slot === "right" ? "side" : "mouth-open"} view`, image);
      let keyedOut = await cutOut(actor, image, key); keyedOut = await normalizePicture(keyedOut, { removeBackground: async (bytes) => bytes });
      const reported = current.data.find((picture) => typeof picture.model === "string")?.model ?? null;
      job.modelReported = reported;
      if (reported && reported !== job.model) throw new Error(COMPANION_MODEL_MISMATCH_LINE);
      const saved = addVersion(companionId, keyedOut, { source: "edit", label: view.label, width: media.image.size, height: media.image.size, from: look.rest, style: sourceVersion?.style ?? "cartoon", model: job.model, quality: job.quality, prompt_hash: job.promptHash, model_reported: reported }, image);
      job.versions.push(saved.id);
      const updated = readLook(companionId), sheet = updated.sheet;
      if (sheet) updateSheet(companionId, { ...sheet, views: { ...sheet.views, [view.slot]: saved.id } });
      job.index++;
      if (job.index >= SHEET_VIEWS.length) { const doneLook = readLook(companionId); if (doneLook.sheet) updateSheet(companionId, { ...doneLook.sheet, state: "approved", approved_by: actor.displayName, approved_at: new Date().toISOString() }); job.state = "done"; job.percent = 100; activeByCompanion.delete(companionId); return; }
      const restPath = versionPath(companionId, look.rest!); if (!restPath) throw new Error("The rest picture could not be found. Choose it again and retry the sheet.");
      const rest = new Uint8Array(readFileSync(restPath)), originalPath = versionOriginalPath(companionId, look.rest!), sourceBytes = originalPath ? new Uint8Array(readFileSync(originalPath)) : await compositeOnNeutral(rest), instruction = SHEET_VIEWS[job.index]!.prompt.replaceAll("<key>", key);
      const nextForm = editForm(sourceBytes, instruction, Boolean(originalPath)); nextForm.append("model", resolveCompanionEdit().model); nextForm.append("seed", String(companionSeed(companionId)));
      job.promptHash = promptHash(instruction);
      job.stackJob = (await submitEdit(nextForm)).job; job.state = "queued";
    })();
    try { await job.finalising; } catch (error) { job.state = "failed"; job.error = error instanceof ArtWithheldError ? error.message : `The ${SHEET_VIEWS[job.index]?.slot === "mouth" ? "mouth-open" : "side"} view did not work. Try again.`; const look = readLook(companionId); if (look.sheet) updateSheet(companionId, { ...look.sheet, state: "needs_review" }); activeByCompanion.delete(companionId); }
    finally { job.finalising = undefined; }
  } catch { job.state = "failed"; job.error = "The character sheet could not be checked. Try again."; activeByCompanion.delete(companionId); }
  return publicState();
}

export async function cancelLookJob(id: string, actor: PersonRow, companionId: string): Promise<boolean> {
  const sheetJob = sheetJobs.get(id);
  if (sheetJob) { if (sheetJob.personId !== actor.id || sheetJob.companionId !== companionId) return false; sheetJob.state = "cancelled"; activeByCompanion.delete(companionId); await cancelOrDelete(sheetJob.stackJob); const look = readLook(companionId); if (look.sheet) updateSheet(companionId, { ...look.sheet, state: "needs_review" }); return true; }
  const job = lookJobFor(id, actor, companionId);
  if (!job) return false;
  job.state = "cancelled"; job.error = null; activeByCompanion.delete(companionId);
  await cancelOrDelete(id);
  return true;
}
