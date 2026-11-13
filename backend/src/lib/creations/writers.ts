// CREATOR-02: what each finished-job writer hands to `recordCreation`. Each builder reads only what the job already knows (its request, its prompt, the files it
// stored); nothing is asked of the Stack and nothing is guessed. The cast stays empty until CREATOR-04 (`resolveCast`) fills it from the job.
// The builders are shared by the writers and the back-fill, so a record made later from an old job row has the same shape as one made on the day.
import { creationIdOfFile, creationIdOfJob, FILE_ID, recordCreation, type Creation, type CreationInput } from "./store";
import type { PictureJob } from "@/lib/pictures/jobStore";
import type { VideoJob, VideoFile } from "@/lib/videos/jobs";
import type { PersonRow } from "@/types";

let fault: (() => void) | null = null;
/** Test-only: make every builder throw, to prove a failing record writer never breaks a job. */
export function __setWriterFaultForTests(fn: (() => void) | null): void { fault = fn; }

/** Run a record writer at a job's call site: whatever it throws, the job goes on (its callbacks, notice and shot clip still run). Logs the kind of failure only, never the words. */
export function safely(write: () => unknown): void {
  try { write(); } catch (error) { console.error(`[creations] a record was not written (${error instanceof Error ? error.name : "error"})`); }
}

type Generation = NonNullable<Creation["generation"]>;
const MAX_WORDS = 20000;
const words = (written: string | undefined, composed: string | undefined): CreationInput["words"] => {
  if (!written && !composed) return null;
  return { ...(written ? { written: written.slice(0, MAX_WORDS) } : {}), ...(composed ? { composed: composed.slice(0, MAX_WORDS) } : {}) };
};

/** The generation-provenance block from what a job knows. Revision, licence and engine are not known to the job, so they say "unknown" the way the music writers
 * do for a model they cannot name (and the commercial answer is "unknown", never "cleared"). */
export function generationBlock(input: { kind: "picture" | "video" | "film"; jobId: string; task: "generate" | "edit" | "film"; model: string | null; seed: number | null; seconds: number | null; tier: string | null | undefined; madeAt?: string }): Generation {
  const tier = input.tier === "boost" || input.tier === "max" || input.tier === "reduced" ? input.tier : "standard";
  return {
    kind: input.kind, job_id: input.jobId, task: input.task,
    model: { id: input.model ?? "unknown", revision: "unknown", licence: "unknown" }, engine: { id: "unknown", version: "unknown" },
    seed: input.seed !== null && Number.isInteger(input.seed) ? input.seed : null, duration_s: input.seconds ?? 0, bpm: null, key: null, parent_file_id: null,
    source_kind: "none", commercial_use: "unknown", commercial_basis: "The model's licence is not recorded for this item, so it is not cleared for commercial use.",
    made_at: input.madeAt ?? new Date().toISOString(), tier,
  };
}

const sizeOf = (size: string): { width?: number; height?: number } => {
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : {};
};

/** A picture a picture job stored (a new picture or a variation; an edit goes through `recordEditedPicture`). */
export function recordPictureCreation(actor: PersonRow, job: PictureJob, file: { id: string; width: number; height: number; seed: number | null; model: string | null }, creationId?: string): Creation | null {
  fault?.();
  const source = job.request.source_file_id;
  return recordCreation(actor, {
    ...(creationId ? { id: creationId } : {}),
    kind: "picture", fileIds: [file.id], jobIds: [job.id],
    recipe: { tool: "pictures", route: source ? "picture" : "text" },
    words: words(job.prompt, job.prompt),
    cast: (job.request.subject_ids ?? []).map((subject_id) => ({ subject_id, synth_id: null, role: "subject" })),
    sources: source && FILE_ID.test(source) ? [{ file_id: source, role: "reference" }] : [],
    generation: generationBlock({ kind: "picture", jobId: job.stackJob ?? job.id, task: "generate", model: file.model, seed: file.seed, seconds: null, tier: job.request.tier, madeAt: job.updatedAt }),
    settings: { width: file.width, height: file.height, ...(job.request.quality ? { quality: job.request.quality } : {}), styles: job.request.loras.map((style_id) => ({ style_id })), takes: job.request.n },
    parentId: creationIdOfFile(actor.id, source),
    adult: job.request.audience === "adult" || job.request.adultLock !== undefined,
  });
}

/** A Picture Studio save or a described edit: the next version of a picture, linked to its source. */
export function recordEditedPicture(actor: PersonRow, input: { fileId: string; sourceId: string; width: number; height: number; op: string; label: string; model?: string; ms?: number; creationId?: string; jobId?: string; words?: string }): Creation | null {
  fault?.();
  return recordCreation(actor, {
    ...(input.creationId ? { id: input.creationId } : {}),
    kind: "picture", fileIds: [input.fileId], jobIds: input.jobId ? [input.jobId] : [],
    recipe: { tool: "picture-studio", route: "edit" },
    words: input.words ? words(input.words, input.words) : null,
    sources: FILE_ID.test(input.sourceId) ? [{ file_id: input.sourceId, role: "edit_source" }] : [],
    generation: generationBlock({ kind: "picture", jobId: input.jobId ?? input.creationId ?? input.fileId, task: "edit", model: input.model ?? null, seed: null, seconds: null, tier: null }),
    settings: { width: input.width, height: input.height, route: input.op },
    parentId: creationIdOfFile(actor.id, input.sourceId),
  });
}

function sourcesOfVideo(job: VideoJob): NonNullable<CreationInput["sources"]> {
  const out: NonNullable<CreationInput["sources"]> = [];
  const add = (id: string | null | undefined, role: NonNullable<CreationInput["sources"]>[number]["role"]) => { if (id && FILE_ID.test(id)) out.push({ file_id: id, role }); };
  add(job.request.source_file_id, "start");
  add(job.request.end_file_id, "end");
  const recipe = job.request.reference;
  for (const id of recipe?.sheetFileIds ?? []) add(id, "sheet");
  for (const id of recipe?.pictureFileIds ?? []) add(id, "reference");
  if (job.request.edit) { add(job.request.edit.from, "edit_source"); for (const id of job.request.edit.with ?? []) add(id, "clip"); }
  return out;
}

/** A clip a video job stored: the clip, its poster and its 5.1 sibling are one creation. `writer` is the file writer that stored the clip. */
export function recordClipCreation(actor: PersonRow, job: VideoJob, files: VideoFile[], writer: "video-gen" | "video-edit", creationId?: string): Creation | null {
  fault?.();
  const clip = files[0];
  if (!clip) return null;
  const recipe = job.request.reference;
  const route = recipe ? (recipe.route === "first_frame" ? "first_frame" as const : "sheet" as const) : job.request.edit ? "edit" as const : job.request.source_file_id ? "picture" as const : "text" as const;
  const ids = [clip.id, ...files.slice(1).map((f) => f.id), ...files.map((f) => f.poster_id).filter(Boolean)];
  const parentFromEdit = job.request.edit ? (FILE_ID.test(job.request.edit.from) ? creationIdOfFile(actor.id, job.request.edit.from) : creationIdOfJob(actor.id, job.request.edit.from)) : null;
  const parentId = creationIdOfJob(actor.id, job.request.anotherOf) ?? parentFromEdit ?? creationIdOfFile(actor.id, job.request.source_file_id);
  const checks: Record<string, unknown> = {};
  if (recipe?.faceMatch) checks.face_match = recipe.faceMatch;
  if (recipe?.firstPicture) checks.first_picture = recipe.firstPicture;
  return recordCreation(actor, {
    ...(creationId ? { id: creationId } : {}),
    kind: "video", fileIds: ids, jobIds: [job.id],
    productionId: job.request.production_id ?? null, shotId: job.request.shot_id ?? null,
    recipe: { tool: writer === "video-edit" ? (job.request.edit ? `video-${job.request.edit.change}` : "video-edit") : job.request.create ? "video-create" : "video", route },
    // The reference recipe's own words (the person's request rewritten around the panels, and the whole prompt the Stack received).
    words: words(recipe ? recipe.request : job.prompt, recipe ? recipe.prompt : job.prompt),
    sources: sourcesOfVideo(job),
    generation: generationBlock({ kind: "video", jobId: job.stackJob ?? job.id, task: job.request.edit ? "edit" : "generate", model: clip.model, seed: clip.seed ?? job.request.seed, seconds: clip.seconds, tier: job.request.tier, madeAt: job.updatedAt }),
    settings: { width: clip.width, height: clip.height, ...(clip.seconds !== null ? { seconds: clip.seconds } : {}), ...(clip.quality ? { quality: clip.quality } : {}), styles: job.request.loras.map((style_id) => ({ style_id })), ...(recipe ? { route: recipe.route ?? "sheet" } : {}) },
    checks: Object.keys(checks).length ? checks : null,
    parentId,
    adult: job.request.adultOnly === true,
  });
}

/** A finished film (its cut): the plan, the cast, the clips it was cut from. If the cut is already a creation (the edit job that assembled it wrote one), that record becomes the film. */
export function recordFilmCreation(actor: PersonRow, input: { cutFileId: string; productionId: string; runId: string; plan: { shots: Array<Record<string, unknown>>; title?: string }; castSubjects: Array<{ subject_id: string; role: string }>; clipFileIds: string[]; faceless: boolean }): Creation | null {
  fault?.();
  return recordCreation(actor, {
    kind: "film", fileIds: [input.cutFileId], jobIds: [`film-run:${input.runId}`],
    productionId: input.productionId,
    recipe: { tool: input.faceless ? "make_film_faceless" : "make_film", route: "film" },
    plan: input.plan.shots.length <= 12 ? { shots: input.plan.shots } : { film_run_id: input.runId },
    cast: input.castSubjects.map((member) => ({ subject_id: member.subject_id, synth_id: null, role: member.role })),
    sources: input.clipFileIds.filter((id) => FILE_ID.test(id)).map((file_id) => ({ file_id, role: "clip" as const })),
    settings: { takes: 1 },
  });
}

/** A long take: the joined clip of a production's parts. */
export function recordLongTakeCreation(actor: PersonRow, input: { fileId: string; productionId: string; partFileIds: string[]; seconds: number | null; prompt: string }): Creation | null {
  fault?.();
  return recordCreation(actor, {
    kind: "video", fileIds: [input.fileId], productionId: input.productionId,
    recipe: { tool: "long-take", route: "other" },
    words: words(input.prompt, input.prompt),
    sources: input.partFileIds.filter((id) => FILE_ID.test(id)).map((file_id) => ({ file_id, role: "clip" as const })),
    settings: { ...(input.seconds !== null ? { seconds: input.seconds } : {}) },
  });
}
