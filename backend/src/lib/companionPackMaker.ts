// MAKER-D (docs/design/companion-maker-2026-11-10.md): the companion pack maker's job. One `companion_pack_job` per companion, kept as a
// HomeJob (the activity row, no migration) plus a JSON state file in the companion's folder (`pack-job/state.json`, work files in
// `pack-job/work/`). The stages run one at a time and resume after a restart; the Stack does the heavy work through `PackOpsClient`
// (typed against MAKER-H's documented kind names) and the existing takes do the clips.
//
// SAFETY (RULES 0 and 10): the starting picture goes through `prepareEditSource` (stage `source`); every generated output goes through
// `checkCompanionArt` (the stricter of the companion's audience and the person asking, plus the adult CSAM check, failing closed) in
// `guard()` before the next stage reads it. A check that cannot run, or a refusal, closes the job: the work folder and this job's
// takes are removed and nothing is installed. Who may start follows the picture and video denials (`startPackJob`).
import sharp from "sharp";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { PersonRow } from "@/types";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { FinishedAsset, FinishedCheckResult } from "@/lib/pictures/finishedCheck";
import type { CheckedKind } from "@/lib/pictures/ageCheck";
import { getHouseholdCompanion, householdCompanionFolder, listHouseholdCompanionIds } from "@/lib/householdCompanions";
import { checkCompanionArt, dirAssets, takeAssets, type CompanionAudience } from "@/lib/companionArtCheck";
import { keyOut, readLook, versionOriginalPath, versionPath } from "@/lib/companionLook";
import { readStates, saveStates, writeKeyframe, removeKeyframe, keyframePath, finishJobIds, takePath, ensureCompanionMediaRoot } from "@/lib/companionStates";
import { cancelTakeRun, startStateTakes, takeRunFor, takeRunSettled } from "@/lib/companionTakes";
import { createHash } from "node:crypto";
import { packFolderProblems } from "@/lib/companionPack";
import { createJob, updateJob } from "@/lib/jobs";
import { getStackClient } from "@/lib/stackEngine";
import { prepareEditSource } from "@/lib/pictures/editSources";
import { fetchPicture } from "@/lib/pictures/stack";
import { routeAudience } from "@/lib/pictures/audience";
import { pictureDenial, PICTURE_DENIAL_LINE } from "@/lib/pictures/policy";
import { videoDenial, VIDEO_DENIAL_LINE } from "@/lib/videos/policy";
import { pictureEngineReady, pictureEngineStatus, pictureNotReadyReason } from "@/lib/pictures/ready";
import { videoEngineReady, videoEngineStatus, videoNotReadyReason } from "@/lib/videos/ready";
import { resolveCompanionEdit, promptHash } from "@/lib/companionArt";
import { TALK_SHAPES, TALK_KEEP } from "@/lib/companionTalkMaker";
import { PACK_FRAME_PX, cropToPack, packFrameOfSource, packLandmarks, packPoint, sizeOf, type Dims, type PackFrame } from "@/lib/companionPackFrame";

// ---------------------------------------------------------------- lines (what went wrong, then what to do)

export const PACK_NO_STILL_LINE = "Choose and approve a starting picture first, then make the pack.";
export const PACK_STILL_NOT_APPROVED_LINE = "That picture is not the approved starting picture. Approve it as the starting picture, then make the pack.";
export const PACK_BUSY_LINE = "A pack is already being made for this companion. Wait for it or stop it.";
export const PACK_NOT_SUPPORTED_LINE = "Only photo and stylised characters can get a pack for now. Characters with no mouth come in a later update.";
export const PACK_NO_BOX_LINE = "A stylised character needs the mouth box: four numbers, left, top, width and height of the mouth in the starting picture, in pixels. Add the box and start again.";
export const PACK_BAD_BOX_LINE = "The mouth box does not fit the starting picture. It must lie inside the picture, be at least 8 pixels wide and tall, and the face height must be positive and no taller than the picture. Fix the numbers and start again.";
export const PACK_BAD_EYES_LINE = "The eye points are not usable. Give at least three [x, y] points for each eye, inside the starting picture, or leave them out.";
export const PACK_BOX_PHOTO_LINE = "A mouth box and eye points are for stylised characters only. Remove them, or start with shapes set to stylised.";
export const PACK_NO_EYES_LINE = "The face tools cannot find the eyes of a stylised character. Give the eye points (eyes.left and eyes.right, each at least three [x, y] points in the starting picture) and start again.";
export const MIN_BOX_PX = 8;
/** The calm mouth letters B to H for a stylised character: one plain edit instruction each, from the old talk maker's wording (TALK_SHAPES, TALK_KEEP). The widest calm opening is small (2 to 16 percent of the face), so no letter asks for a big open mouth. */
export const STYLISED_LETTERS = ["B", "C", "D", "E", "F", "G", "H"] as const;
export const STYLISED_LETTER_SHAPE: Record<(typeof STYLISED_LETTERS)[number], string> = {
  B: TALK_SHAPES.B, C: TALK_SHAPES.C, D: TALK_SHAPES.D, E: TALK_SHAPES.E, F: TALK_SHAPES.F,
  G: "lips parted in a small relaxed smile with the upper teeth showing a little, as saying EE",
  H: "lips pressed together and slightly pushed out, as saying M or B",
};
export const stylisedLetterInstruction = (letter: (typeof STYLISED_LETTERS)[number]): string => `Change only the mouth: ${STYLISED_LETTER_SHAPE[letter]}. ${TALK_KEEP} Keep the flat chroma key background exactly as it is.`;
export const PACK_NO_VIDEO_LINE = "Making a pack needs the video model. An admin can check Settings, Pictures and videos.";
/** The Talking pictures engine can serve a job when the Stack supports it and every weights file is present; its own environment is built by the first job (state `needs-setup` is normal until then). */
export function faceToolsReady(status: { state: string; models?: Record<string, boolean>; modelsVerified?: boolean } | null | undefined): boolean {
  if (!status || status.state === "unsupported") return false;
  const models = Object.values(status.models ?? {});
  return status.modelsVerified === true || (models.length > 0 && models.every(Boolean));
}
export const PACK_NO_TALK_FRAMES_LINE = "Making a talking pack needs the face tools, which are not ready on this computer yet. An admin can check Settings, Pictures and videos.";
export const PACK_CHECK_CLOSED_LINE = "The safety check could not look at a picture, so the pack was stopped and nothing was kept. Try again when the picture check is ready.";
export const PACK_APPROVAL_NOT_WAITING_LINE = "The pack is not waiting for that approval right now.";
export const PACK_NOTE_HEAD_EYES = "head and eyes layers: skipped, not supported yet";
export const PACK_NOTE_SHOUT = "shout mouth set: not made yet (TODO: the shout letter frames need a higher-openness talk-frames set the Stack route does not define); the calm set is used";
export const PACK_CANCELLED_LINE = "The pack was stopped. If you start it again, the clips and the steps after them are made again.";

// ---------------------------------------------------------------- the Stack side (MAKER-H kinds)

export type PackOpKind = "media.companion_track" | "media.companion_shapes" | "media.companion_emotion" | "media.companion_pack";
export interface PackOpResult { ok: boolean; reasons: string[]; report: Record<string, unknown> }
export interface PackOpHooks { onJob(id: string): void; signal?: AbortSignal }
export type FaceLandmarks = Record<string, unknown>;
/** The lip openness (0 closed to 1 wide) asked of the engine for each letter; talk-frames takes at most 12 per call. */
export const LETTER_LIP: Record<string, number> = { A: 0, B: 0.1, C: 0.25, D: 0.4, E: 0.55, F: 0.7, G: 0.85, H: 0.92, wide: 1 };
export const TALK_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "wide"] as const;
export const EMOTIONS = ["angry", "excited", "alarmed", "sad"] as const;

export interface PackOpsClient {
  /** One picture edit (POST /v1/images/edits); returns the PNG. */
  imageEdit(input: { image: Uint8Array; instruction: string; seed: number; imageSource: "generated" | "uploaded" } & PackOpHooks): Promise<Uint8Array>;
  /** `POST /v1/images/talk-frames`: one still per letter (its lip ratio, `LETTER_LIP`) from the rest picture, with the face landmarks (MAKER-B2). */
  talkFrames(input: { image: Uint8Array; letters: readonly string[] } & PackOpHooks): Promise<{ frames: Record<string, Uint8Array>; sourceLandmarks: FaceLandmarks | null; landmarks: Record<string, FaceLandmarks | null> }>;
  /** A media op that reads and writes files in the companion's folder; `report.json` with `ok` and `reasons` comes back as the result. */
  run(kind: PackOpKind, input: Record<string, unknown>, hooks: PackOpHooks): Promise<PackOpResult>;
  cancel(jobId: string): Promise<void>;
}

const ACTIVE = ["queued", "running", "paused", "stalled"];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const PACK_POLL_MS = 500;

/** The real implementation over the Stack client. Request and result shapes follow the MAKER-H names in the brief; the Stack docs did not list them yet (see the report). */
export const StackPackOps: PackOpsClient = {
  async imageEdit(input) {
    const art = resolveCompanionEdit(), form = new FormData();
    form.append("image", new File([new Uint8Array(input.image)], "picture.png", { type: "image/png" }));
    form.append("operation", "edit");
    form.append("instruction", input.instruction);
    form.append("image_source", input.imageSource);
    form.append("audience", "all-ages");
    form.append("timeout_ms", "1");
    form.append("model", art.model);
    form.append("seed", String(input.seed));
    const client = getStackClient(), reply = await client.imageEdit(form, input.signal ? { signal: input.signal } : undefined);
    input.onJob(reply.job);
    if (reply.kind === "done") return new Uint8Array(Buffer.from(reply.item.b64_json, "base64"));
    let job = await client.job(reply.job);
    while (ACTIVE.includes(job.state)) { if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError"); await sleep(PACK_POLL_MS); job = await client.job(reply.job); }
    if (job.state !== "done") throw new Error(jobFailure(job, "The picture could not be made. Try again."));
    // A generative edit (the picture model) keeps its picture as the job's file; the in-memory result route is for the picture tools only.
    const generative = job.kind === "image_edit_generative" || Array.isArray((job.result as { images?: unknown } | null | undefined)?.images);
    return generative ? await fetchPicture(reply.job, 0) : await client.imageEditResult(reply.job);
  },
  async talkFrames(input) {
    const client = getStackClient();
    if (!client.talkFrames || !client.talkFramePicture) throw new Error("The face tools are not available on this Stack. Update the Stack and try again.");
    const form = new FormData();
    form.append("image", new File([new Uint8Array(input.image)], "rest.png", { type: "image/png" }));
    form.append("lip", input.letters.map((l) => LETTER_LIP[l] ?? 0).join(","));
    const reply = await client.talkFrames(form, input.signal ? { signal: input.signal } : undefined);
    const job = reply.kind === "done" ? reply.body.job : reply.job;
    input.onJob(job);
    let body: { sourceLandmarks?: FaceLandmarks | null; frames?: Array<{ landmarks?: FaceLandmarks | null }> } | null = reply.kind === "done" ? reply.body : null;
    if (!body) {
      let status = await client.job(job);
      while (ACTIVE.includes(status.state)) { if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError"); await sleep(PACK_POLL_MS); status = await client.job(job); }
      if (status.state !== "done") throw new Error(jobFailure(status, "The mouth pictures could not be made. Try again."));
      body = (status.result ?? {}) as NonNullable<typeof body>;
    }
    const frames: Record<string, Uint8Array> = {}, landmarks: Record<string, FaceLandmarks | null> = {};
    for (let i = 0; i < input.letters.length; i++) { const letter = input.letters[i]!; frames[letter] = await client.talkFramePicture(job, i, input.signal ? { signal: input.signal } : undefined); landmarks[letter] = body?.frames?.[i]?.landmarks ?? null; }
    return { frames, sourceLandmarks: body?.sourceLandmarks ?? null, landmarks };
  },
  async run(kind, input, hooks) {
    if (typeof input.output_dir === "string") { try { chmodSync(input.output_dir, 0o777); } catch { /* the engine reports it if it cannot write */ } }
    const roots = await ensureCompanionMediaRoot(); // the engine reads and writes only inside the roots Home opened
    if (!roots.ok) return { ok: false, reasons: [roots.error], report: {} };
    const client = getStackClient();
    let job = await client.submitJob({ kind, input }, hooks.signal ? { signal: hooks.signal } : undefined);
    hooks.onJob(job.id);
    while (ACTIVE.includes(job.state)) { if (hooks.signal?.aborted) throw new DOMException("Aborted", "AbortError"); await sleep(PACK_POLL_MS); job = await client.job(job.id); }
    if (job.state !== "done") return { ok: false, reasons: [jobFailure(job, "The step could not finish. Try again.")], report: {} };
    const report = ((job.result ?? {}) as Record<string, unknown>), reasons = Array.isArray(report.reasons) ? report.reasons.filter((r): r is string => typeof r === "string") : [];
    return { ok: report.ok !== false, reasons, report };
  },
  async cancel(jobId) { try { await getStackClient().cancelJob(jobId); } catch { /* the Stack removes its own files */ } },
};

function jobFailure(job: unknown, fallback: string): string {
  const failed = job as { code?: string; message?: string; reason?: string; error?: { code?: string; message?: string } };
  return failed.error?.message ?? failed.message ?? failed.reason ?? fallback;
}

// ---------------------------------------------------------------- dependencies (replaced in tests)

export interface MadeTake { take: string; ok: boolean; /** True when the safety check refused the take: the job closes, no re-roll. */ art: boolean; reasons: string[] }
export interface ClipMaker {
  /** Makes `count` candidate takes for one state through the existing take code, tagged with the pack job; returns each finished take (a failed one carries its reasons). */
  makeTakes(input: { actor: PersonRow; companionId: string; state: string; count: number; job: string; /** The pack's shared frame (source pixels) and the size of the picture it is defined in: every clip is cut to it. */ frame?: PackFrame; frameSource?: Dims; signal: AbortSignal; onRun(id: string | null): void; /** Every Stack job (the video and the clip finishing) as it is seen. */ onJob(id: string): void }): Promise<MadeTake[]>;
}
export interface PackDeps {
  ops: PackOpsClient;
  clips: ClipMaker;
  checkArt(companionId: string, actor: PersonRow, assets: readonly FinishedAsset[], kind: CheckedKind, audience?: CompanionAudience): Promise<FinishedCheckResult>;
  /** Null when the image and video roles and the face tools are ready, else the plain reason. */
  readiness(shapes?: PackShapes): Promise<{ status: 503; error: string } | null>;
}

/** The clips through the existing take code (CMEDIA-STATES): one run at a time, polled until it settles. Takes are attributed by the pack job tag the take code writes, never by "new since before". */
export const takeDeps = { start: startStateTakes };
export const TakeClipMaker: ClipMaker = {
  async makeTakes({ actor, companionId, state, count, job, frame, frameSource, signal, onRun, onJob }) {
    const before = new Set((readStates(companionId).states[state]?.takes ?? []).map((t) => t.id));
    const run = await takeDeps.start({ actor, companionId, states: [state], count, pack: { job, ...(frame ? { frame } : {}), ...(frameSource ? { frameSource } : {}) } });
    onRun(run);
    try {
      for (;;) {
        const current = takeRunFor(run, actor, companionId);
        if (current?.stackJob) onJob(current.stackJob);
        for (const id of finishJobIds(companionId)) onJob(id);
        if (!current || ["done", "failed", "cancelled"].includes(current.state)) { if (current?.state === "failed") throw new Error(current.error ?? "The clip could not be made. Try again."); if (current?.state === "cancelled") throw new DOMException("Aborted", "AbortError"); break; }
        if (signal.aborted) { await cancelTakeRun(run, actor, companionId); throw new DOMException("Aborted", "AbortError"); }
        await sleep(PACK_POLL_MS);
      }
    } finally {
      // Never return or throw while a finishing job is still writing a take folder: a purge after this would delete files under it.
      await takeRunSettled(run); onRun(null);
    }
    return (readStates(companionId).states[state]?.takes ?? []).filter((t) => !before.has(t.id) && t.pack_job === job).map((t) => ({ take: t.id, ok: Boolean(t.report?.ok) && !t.failure, art: t.failure_kind === "art", reasons: t.failure ? [t.failure] : (t.report?.reasons ?? []) }));
  },
};

const defaultDeps: PackDeps = {
  ops: StackPackOps,
  clips: TakeClipMaker,
  checkArt: (companionId, actor, assets, kind, audience) => checkCompanionArt(companionId, actor, assets, kind, audience),
  async readiness(shapes) {
    if (!(await pictureEngineReady())) return { status: 503, error: pictureNotReadyReason(await pictureEngineStatus()) };
    if (!(await videoEngineReady())) return { status: 503, error: videoNotReadyReason(await videoEngineStatus()) || PACK_NO_VIDEO_LINE };
    if (shapes === "stylised") return null; // the stylised path makes its mouth pictures with the picture edit and needs no face tools
    // The face tools report on the image-tools status; their readiness never changes the image role itself.
    try {
      const client = getStackClient();
      if (!client.talkFramesStatus || !faceToolsReady(await client.talkFramesStatus())) return { status: 503, error: PACK_NO_TALK_FRAMES_LINE };
    } catch { return { status: 503, error: PACK_NO_TALK_FRAMES_LINE }; }
    return null;
  },
};
let deps: PackDeps = defaultDeps;
export function __setPackDepsForTests(value: Partial<PackDeps> | null): void { deps = value ? { ...defaultDeps, ...value } : defaultDeps; }

// ---------------------------------------------------------------- state

export const PACK_STAGES = ["source", "clips", "track", "shapes", "emotion", "assemble", "validate", "install"] as const;
export type PackStage = (typeof PACK_STAGES)[number];
export type StageStatus = "pending" | "running" | "done" | "failed";
export type PackShapes = "photo" | "stylised";
export interface PackEyes { left: number[][]; right: number[][] }
export type PackApproval = "A" | "B" | "C";
export type PackJobStatus = "running" | "waiting_approval" | "failed" | "cancelled" | "done";
/** The clips every pack needs: idle twice, then listening, thinking, speaking (the creator vocabulary's names). */
export const PACK_CLIP_STATES: ReadonlyArray<{ state: string; need: number }> = [{ state: "idle", need: 2 }, { state: "listening", need: 1 }, { state: "thinking", need: 1 }, { state: "speaking", need: 1 }];
export const CLIP_REROLLS = 2;

export interface StageRecord { status: StageStatus; reasons: string[]; report: Record<string, unknown> | null; stack_jobs: string[]; started_at: string | null; ended_at: string | null }
export interface PackJobRecord {
  version: 1; job: string; companion_id: string;
  /** The person who started the job (their lane applies to every check). */
  person_id: string;
  /** Everyone who started, resumed or approved: every one of their lanes applies to every check (the strictest wins). */
  actors: string[];
  still_id: string; shapes: PackShapes;
  /** Stylised only: the mouth box [x, y, w, h] in the starting picture's pixels, the face height, the eye points, and the picture size they refer to. */
  box: number[] | null; face_height_px: number | null; eyes: PackEyes | null; rest_size: { width: number; height: number } | null;
  /** The pack's one shared square frame (480x480 in the pack), in the pixels of the green source (`frame_source` is that picture's size): defined once after the source stage, applied to every clip, mouth picture and pose, and kept so a resume uses the same one. */
  frame: PackFrame | null; frame_source: Dims | null;
  status: PackJobStatus; stage: PackStage | null; waiting_for: PackApproval | null; error: string | null;
  /** True after a safety refusal or an unrunnable check: the work was wiped and the job cannot be resumed. */
  closed: boolean;
  approvals: Record<PackApproval, { by: string; at: string } | null>;
  stages: Record<PackStage, StageRecord>;
  /** Plain notes on what this job left out on purpose. */
  notes: string[];
  /** Takes this job made (also tagged `pack_job` in the states file), so a closed job can remove them. */
  takes: Array<{ state: string; take: string }>;
  clips: Array<{ state: string; take: string }>;
  /** Keyframes this job wrote, with the hash of what it wrote: only a file that still matches is ever removed (a person's own keyframe, or one changed since, stays). */
  keyframes: Array<{ state: string; sha: string }>;
  created_at: string; updated_at: string;
}

const blankStage = (): StageRecord => ({ status: "pending", reasons: [], report: null, stack_jobs: [], started_at: null, ended_at: null });
const jobDir = (id: string): string => join(householdCompanionFolder(id)!, "pack-job");
const statePath = (id: string): string => join(jobDir(id), "state.json");
const workDir = (id: string): string => join(jobDir(id), "work");

export function readPackJob(companionId: string): PackJobRecord | null {
  try { const parsed = JSON.parse(readFileSync(statePath(companionId), "utf8")) as PackJobRecord; if (parsed?.version !== 1) return null; parsed.actors ??= [parsed.person_id]; parsed.keyframes = (parsed.keyframes ?? []).map((k) => (typeof k === "string" ? { state: k, sha: "" } : k)); parsed.notes ??= []; parsed.box ??= null; parsed.face_height_px ??= null; parsed.eyes ??= null; parsed.rest_size ??= null; parsed.frame ??= null; parsed.frame_source ??= null; return parsed; } catch { return null; }
}
function jobState(rec: PackJobRecord): string { return rec.status === "running" ? "running" : rec.status === "waiting_approval" ? "waiting" : rec.status; }
function save(rec: PackJobRecord): void {
  rec.updated_at = new Date().toISOString();
  mkdirSync(jobDir(rec.companion_id), { recursive: true });
  const tmp = `${statePath(rec.companion_id)}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2)); renameSync(tmp, statePath(rec.companion_id));
  updateJob(rec.job, { state: jobState(rec), progress: { stage: rec.stage, waiting_for: rec.waiting_for }, waitingReason: rec.waiting_for ? `Waiting for approval ${rec.waiting_for}` : null, errorKind: rec.status === "failed" ? "failed" : null });
}
/** Reads the record for a person: a job the file says is running but no live runner owns (the process restarted) is marked interrupted on its activity row, so the row and the file agree. */
export function readPackJobReconciled(companionId: string): PackJobRecord | null {
  if (!live.has(companionId)) restorePackOld(companionId);
  const rec = readPackJob(companionId);
  if (rec && rec.status === "running" && !live.has(companionId) && !starting.has(companionId)) updateJob(rec.job, { state: "failed", errorKind: "interrupted", waitingReason: "The pack stopped when Home restarted. Start it again to continue." });
  return rec;
}

const loadPerson = (id: string): PersonRow | null => (db.select().from(people).where(eq(people.id, id)).get() as PersonRow | undefined) ?? null;

// ---------------------------------------------------------------- the live run (one per companion, in memory)

interface Live { promise: Promise<void>; controller: AbortController; actor: PersonRow; stackJobs: Set<string>; takeRun: string | null }
const live = new Map<string, Live>();
/** Companions with a start in flight: reserved synchronously, before any await, so two starts cannot both pass. */
const starting = new Set<string>();
export function __clearPackJobsForTests(): void { for (const l of live.values()) l.controller.abort(); live.clear(); starting.clear(); }
/** A restart forgets every live run; the state file stays. */
export function __simulateRestartForTests(): void { __clearPackJobsForTests(); }
export function packJobRunning(companionId: string): boolean { return live.has(companionId); }
export async function waitPackJob(companionId: string): Promise<void> { await live.get(companionId)?.promise.catch(() => undefined); }
let renamer: typeof renameSync = renameSync;
/** A swap cut off between its two renames leaves the old pack beside and none in place: put it back. Runs when a job starts or is read, not only inside an install. */
function restorePackOld(companionId: string): void {
  const root = householdCompanionFolder(companionId); if (!root) return;
  const target = join(root, "pack"), old = join(root, ".pack-old");
  try { if (!existsSync(target) && existsSync(old)) renamer(old, target); } catch { /* the install stage tries again */ }
}
/** At server start: an activity row whose job the state file says is running, with no live runner, is marked interrupted. */
export function reconcileInterruptedPackJobs(): number {
  let n = 0;
  for (const id of listHouseholdCompanionIds()) { restorePackOld(id); const rec = readPackJob(id); if (rec && rec.status === "running" && !live.has(id) && !starting.has(id)) { updateJob(rec.job, { state: "failed", errorKind: "interrupted", waitingReason: "The pack stopped when Home restarted. Start it again to continue." }); n++; } }
  return n;
}
export function __setRenameForTests(fn: typeof renameSync | null): void { renamer = fn ?? renameSync; }

class ClosedError extends Error {}

// ---------------------------------------------------------------- start, approve, cancel

export type StartResult = { ok: true; job: PackJobRecord; resumed: boolean } | { ok: false; status: 403 | 404 | 409 | 422 | 503; error: string };

export async function startPackJob(input: { actor: PersonRow; companionId: string; stillId: string; shapes: string; restart?: boolean; box?: number[]; face_height_px?: number; eyes?: PackEyes }): Promise<StartResult> {
  const { actor, companionId } = input;
  if (!getHouseholdCompanion(companionId)) return { ok: false, status: 404, error: "That household companion could not be found." };
  // The picture and video age and surface gates, as the take code applies them.
  const audience = routeAudience(actor), picture = pictureDenial(audience), video = videoDenial(audience);
  if (picture) return { ok: false, status: 403, error: PICTURE_DENIAL_LINE[picture] };
  if (video) return { ok: false, status: 403, error: VIDEO_DENIAL_LINE[video] };
  if (input.shapes !== "photo" && input.shapes !== "stylised") return { ok: false, status: 422, error: PACK_NOT_SUPPORTED_LINE };
  const shapes: PackShapes = input.shapes;
  if (shapes === "photo" && (input.box !== undefined || input.face_height_px !== undefined || input.eyes !== undefined)) return { ok: false, status: 422, error: PACK_BOX_PHOTO_LINE };
  // Approval A: the approved starting picture, before anything is made.
  const look = readLook(companionId), still = look.versions.find((v) => v.id === input.stillId);
  if (!input.stillId || !still || !versionPath(companionId, input.stillId)) return { ok: false, status: 422, error: PACK_NO_STILL_LINE };
  if (look.rest !== input.stillId) return { ok: false, status: 409, error: PACK_STILL_NOT_APPROVED_LINE };
  let restSize: { width: number; height: number } | null = null, box: number[] | null = null, faceHeight: number | null = null, eyes: PackEyes | null = null;
  if (shapes === "stylised") {
    if (!input.box) return { ok: false, status: 422, error: PACK_NO_BOX_LINE };
    if (!still.width || !still.height) return { ok: false, status: 422, error: PACK_NO_STILL_LINE };
    restSize = { width: still.width, height: still.height }; // the size the look record keeps for the approved picture
    const checked = validateStylised(input, restSize); if (typeof checked === "string") return { ok: false, status: 422, error: checked };
    ({ box, faceHeight, eyes } = checked);
  }
  restorePackOld(companionId);
  // Reserve before any await: a second start for this companion is refused from here on.
  if (live.has(companionId) || starting.has(companionId)) return { ok: false, status: 409, error: PACK_BUSY_LINE };
  starting.add(companionId);
  try {
    const notReady = await deps.readiness(shapes);
    if (notReady) return { ok: false, status: notReady.status, error: notReady.error };
    if (live.has(companionId)) return { ok: false, status: 409, error: PACK_BUSY_LINE };
    let existing = readPackJob(companionId);
    if (existing && input.restart) { await wipeAll(existing); updateJob(existing.job, { state: "cancelled", errorKind: null, waitingReason: null }); existing = null; }
    if (existing && existing.still_id === input.stillId && existing.shapes === shapes && JSON.stringify([existing.box, existing.face_height_px, existing.eyes]) === JSON.stringify([box, faceHeight, eyes]) && !existing.closed && existing.status !== "done") {
      existing.status = "running"; existing.error = null; existing.waiting_for = null; if (!existing.actors.includes(actor.id)) existing.actors.push(actor.id);
      const stage = PACK_STAGES.find((s) => existing!.stages[s].status !== "done"); if (stage && existing.stages[stage].status === "failed") existing.stages[stage] = blankStage();
      save(existing); launch(existing, actor);
      return { ok: true, job: existing, resumed: true };
    }
    const now = new Date().toISOString(), id = crypto.randomUUID();
    const rec: PackJobRecord = { version: 1, job: id, companion_id: companionId, person_id: actor.id, actors: [actor.id], still_id: input.stillId, shapes, box, face_height_px: faceHeight, eyes, rest_size: restSize, frame: null, frame_source: null, status: "running", stage: null, waiting_for: null, error: null, closed: false, approvals: { A: { by: actor.id, at: now }, B: null, C: null }, stages: Object.fromEntries(PACK_STAGES.map((s) => [s, blankStage()])) as Record<PackStage, StageRecord>, notes: [], takes: [], clips: [], keyframes: [], created_at: now, updated_at: now };
    // An older record that is not running (closed, failed, done, cancelled) is replaced; its work folder goes, its installed pack stays.
    if (existing) { await wipeAll(existing); updateJob(existing.job, { state: existing.status === "done" ? "done" : "cancelled" }); }
    rmSync(jobDir(companionId), { recursive: true, force: true });
    mkdirSync(workDir(companionId), { recursive: true });
    createJob({ id, kind: "companion_pack_job", startedBy: actor.id, forPerson: actor.id, title: "Making a companion pack", state: "running", progress: { stage: null }, conversationId: null, resultRef: null, waitingReason: null, errorKind: null, raw: null, companionId, provenance: { producer: "companion_pack_maker" } });
    save(rec); launch(rec, actor);
    return { ok: true, job: rec, resumed: false };
  } finally { starting.delete(companionId); }
}

const finitePoint = (p: unknown, size: { width: number; height: number }): p is number[] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n)) && p[0]! >= 0 && p[1]! >= 0 && p[0]! <= size.width && p[1]! <= size.height;
/** The stylised numbers, checked against the starting picture's size: a plain line on a problem. */
function validateStylised(input: { box?: number[]; face_height_px?: number; eyes?: PackEyes }, size: { width: number; height: number }): { box: number[]; faceHeight: number | null; eyes: PackEyes | null } | string {
  const b = input.box;
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === "number" && Number.isFinite(n))) return PACK_BAD_BOX_LINE;
  const [x, y, w, h] = b as [number, number, number, number];
  if (x < 0 || y < 0 || w < MIN_BOX_PX || h < MIN_BOX_PX || x + w > size.width || y + h > size.height) return PACK_BAD_BOX_LINE;
  const fh = input.face_height_px ?? null;
  if (fh !== null && !(typeof fh === "number" && Number.isFinite(fh) && fh > 0 && fh <= size.height)) return PACK_BAD_BOX_LINE;
  let eyes: PackEyes | null = null;
  if (input.eyes !== undefined) {
    const e = input.eyes;
    if (!e || !Array.isArray(e.left) || !Array.isArray(e.right) || e.left.length < 3 || e.right.length < 3 || e.left.length > 100 || e.right.length > 100 || !e.left.every((p) => finitePoint(p, size)) || !e.right.every((p) => finitePoint(p, size))) return PACK_BAD_EYES_LINE;
    eyes = { left: e.left, right: e.right };
  }
  return { box: [x, y, w, h], faceHeight: fh, eyes };
}

export type ApproveResult = { ok: true; job: PackJobRecord } | { ok: false; status: 403 | 404 | 409 | 503; error: string };
export async function approvePackStage(companionId: string, actor: PersonRow, stage: PackApproval): Promise<ApproveResult> {
  const rec = readPackJob(companionId);
  if (!rec) return { ok: false, status: 404, error: "No pack is being made for this companion. Start one first." };
  if (stage === "A") return rec.approvals.A ? { ok: true, job: rec } : { ok: false, status: 409, error: PACK_APPROVAL_NOT_WAITING_LINE };
  if (rec.status !== "waiting_approval" || rec.waiting_for !== stage || live.has(companionId) || starting.has(companionId)) return { ok: false, status: 409, error: PACK_APPROVAL_NOT_WAITING_LINE };
  // The approver is held to the same gates as the starter (as the look approval is): picture and video denials, then readiness.
  const audience = routeAudience(actor), picture = pictureDenial(audience), video = videoDenial(audience);
  if (picture) return { ok: false, status: 403, error: PICTURE_DENIAL_LINE[picture] };
  if (video) return { ok: false, status: 403, error: VIDEO_DENIAL_LINE[video] };
  starting.add(companionId);
  try {
    const notReady = await deps.readiness(rec.shapes);
    if (notReady) return { ok: false, status: notReady.status, error: notReady.error };
    const fresh = readPackJob(companionId);
    if (!fresh || fresh.status !== "waiting_approval" || fresh.waiting_for !== stage) return { ok: false, status: 409, error: PACK_APPROVAL_NOT_WAITING_LINE };
    const at = new Date().toISOString();
    fresh.approvals[stage] = { by: actor.id, at }; fresh.waiting_for = null; fresh.status = "running"; if (!fresh.actors.includes(actor.id)) fresh.actors.push(actor.id);
    if (stage === "B") { // a clip the pack made and a person approved gets who and when on the existing per-state fields; nobody else's approval is touched
      const mine = new Set(fresh.clips.map((c) => `${c.state}/${c.take}`)), all = readStates(companionId);
      for (const { state } of PACK_CLIP_STATES) { const row = all.states[state as keyof typeof all.states]; if (row?.approved && mine.has(`${state}/${row.approved}`)) { row.approved_by = actor.id; row.approved_at = at; } }
      saveStates(companionId, all);
    }
    save(fresh); launch(fresh, actor);
    return { ok: true, job: fresh };
  } finally { starting.delete(companionId); }
}

export async function cancelPackJob(companionId: string): Promise<{ ok: boolean; job: PackJobRecord | null }> {
  const rec = readPackJob(companionId), run = live.get(companionId);
  if (!rec) return { ok: false, job: null };
  if (run) {
    run.controller.abort();
    for (const id of run.stackJobs) await deps.ops.cancel(id);
    if (run.takeRun) await cancelTakeRun(run.takeRun, run.actor, companionId).catch(() => false);
    await run.promise.catch(() => undefined);
  }
  const fresh = readPackJob(companionId) ?? rec;
  // Only a job that is still going is cancelled; a closed, failed, done or already cancelled record keeps its status and its reason.
  if (fresh.status === "running" || fresh.status === "waiting_approval") {
    fresh.status = "cancelled"; fresh.waiting_for = null; fresh.error = PACK_CANCELLED_LINE;
    for (const s of PACK_STAGES) if (fresh.stages[s].status === "running") fresh.stages[s] = blankStage();
    // The job's takes go (a take may still be mid-finish only until the clip maker settled above), so the clips stage and everything after it must run again.
    purgeTakes(fresh, new Set()); removeOwnKeyframes(fresh); fresh.takes = []; fresh.clips = [];
    for (const stage of PACK_STAGES.slice(PACK_STAGES.indexOf("clips"))) fresh.stages[stage] = blankStage();
    fresh.approvals.B = null; fresh.approvals.C = null; fresh.notes = [];
    save(fresh);
  }
  return { ok: true, job: fresh };
}

/** A job whose process ended while it ran (status running, no live run): the next start with the same picture continues it. */
export function packJobInterrupted(rec: PackJobRecord | null): boolean { return Boolean(rec && rec.status === "running" && !live.has(rec.companion_id)); }

function packPreviewBlock(rec: PackJobRecord): { pack_url_base: string; pack_json_url: string; installed: boolean } | null {
  const base = `/api/companions/${encodeURIComponent(rec.companion_id)}`;
  if (rec.status === "done" && rec.stages.install.status === "done") return { pack_url_base: `${base}/pack/`, pack_json_url: `${base}/pack/pack.json`, installed: true };
  if (rec.status === "waiting_approval" && rec.waiting_for === "C") return { pack_url_base: `${base}/pack-job/preview/`, pack_json_url: `${base}/pack-job/preview/pack.json`, installed: false };
  return null;
}

export const PACK_PREVIEW_NOT_WAITING_LINE = "There is no assembled pack to look at right now. The preview is open only while a pack waits for approval C; after that the installed pack is served at the pack address.";
const PREVIEW_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".webp": "image/webp", ".json": "application/json", ".z": "application/octet-stream" };
/**
 * A file of the assembled pack in the work folder, for the owner to look at before approval C. Open ONLY while the job is waiting at approval C
 * (not while running, so not during install, and not after it is done, failed, cancelled or closed). Every file served here was already art-checked:
 * `validate` scans the whole pack folder, and `install` scans it again before copying. Same safety as `packFile` (lib/companionPack.ts): extension
 * allow-list, no traversal, no link, real path inside the folder. Returns "closed" when no pack is open to preview, null for a bad file.
 */
export function packPreviewFile(companionId: string, rel: string): { path: string; type: string } | "closed" | null {
  const rec = readPackJob(companionId);
  if (!rec || rec.closed || rec.stages.validate.status !== "done" || rec.status !== "waiting_approval" || rec.waiting_for !== "C") return "closed";
  const dir = packOut(companionId);
  if (!rel || rel.includes("\0") || !existsSync(join(dir, "pack.json"))) return rel && existsSync(dir) ? null : "closed";
  const type = PREVIEW_TYPES[rel.slice(rel.lastIndexOf(".")).toLowerCase()];
  if (!type) return null;
  const path = resolve(dir, rel);
  if (!path.startsWith(resolve(dir) + sep)) return null;
  try {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !statSync(path).isFile() || !realpathSync(path).startsWith(realpathSync(dir) + sep)) return null;
  } catch { return null; }
  return { path, type };
}

export function publicPackJob(rec: PackJobRecord) {
  return {
    job: rec.job, notes: rec.notes ?? [], status: rec.status, stage: rec.stage, waiting_for: rec.waiting_for, error: rec.error, interrupted: packJobInterrupted(rec), still_id: rec.still_id, shapes: rec.shapes, box: rec.box ?? null, face_height_px: rec.face_height_px ?? null, eyes: rec.eyes ?? null,
    // At approval B: the take ids and the playable clip URLs (the existing states file route). Nothing else is exposed, and every one of these clips already passed the art check in the clips stage.
    clips: rec.status === "waiting_approval" && rec.waiting_for === "B" ? rec.clips.map(({ state, take }) => ({ state, take, url: `/api/companions/${encodeURIComponent(rec.companion_id)}/states/${state}/${take}/clip.h264.mp4` })) : [],
    // At approval C (and once done): where to look at the pack. Before install it is the preview route over the work folder (installed false); after install it is the served pack (installed true, PACK-06, with Range).
    preview: packPreviewBlock(rec),
    approvals: rec.approvals,
    stages: PACK_STAGES.map((name) => ({ name, status: rec.stages[name].status, reasons: rec.stages[name].reasons, report: rec.stages[name].report, stack_jobs: rec.stages[name].stack_jobs })),
  };
}

// ---------------------------------------------------------------- the runner

function launch(rec: PackJobRecord, actor: PersonRow): void {
  const controller = new AbortController(), entry: Live = { promise: Promise.resolve(), controller, actor, stackJobs: new Set(), takeRun: null };
  live.set(rec.companion_id, entry);
  entry.promise = drive(rec.companion_id, actor, entry).catch((error) => console.warn(`[pack-maker] ${rec.companion_id}: ${(error as Error).message}`)).finally(() => { if (live.get(rec.companion_id) === entry) live.delete(rec.companion_id); });
}

interface Ctx { id: string; actor: PersonRow; run: Live; rec: PackJobRecord; stage: PackStage }
/** What a stage writes, so a stage found running after a restart starts from clean folders. */
const STAGE_DIRS: Partial<Record<PackStage, string[]>> = { track: ["track", "staging"], shapes: ["shapes-in", "shapes-out"], emotion: ["emotion-in", "emotion-out"], assemble: ["pack-out"] };

async function drive(companionId: string, actor: PersonRow, run: Live): Promise<void> {
  const rec = readPackJob(companionId)!;
  for (;;) {
    if (run.controller.signal.aborted) return;
    const next = PACK_STAGES.find((s) => rec.stages[s].status !== "done");
    if (!next) { rec.status = "done"; rec.stage = null; rec.waiting_for = null; save(rec); return; }
    const gate: PackApproval | null = next === "track" ? "B" : next === "install" ? "C" : null;
    if (gate && !rec.approvals[gate]) { rec.status = "waiting_approval"; rec.waiting_for = gate; rec.stage = next; save(rec); return; }
    const stage = rec.stages[next];
    // A stage still marked running was cut off by a restart: stop its recorded Stack jobs (once) and clear what it wrote before it runs again.
    if (stage.status === "running") {
      for (const id of stage.stack_jobs) await deps.ops.cancel(id);
      stage.stack_jobs = [];
      for (const sub of STAGE_DIRS[next] ?? []) rmSync(join(workDir(companionId), sub), { recursive: true, force: true });
    }
    stage.status = "running"; stage.started_at = new Date().toISOString(); stage.reasons = []; rec.stage = next; rec.status = "running"; save(rec);
    const ctx: Ctx = { id: companionId, actor, run, rec, stage: next };
    try {
      const outcome = await STAGE_RUNNERS[next](ctx);
      if (run.controller.signal.aborted) return;
      stage.report = outcome ?? null; stage.status = "done"; stage.ended_at = new Date().toISOString(); save(rec);
    } catch (error) {
      if (run.controller.signal.aborted) return;
      const closed = error instanceof ClosedError;
      stage.status = "failed"; stage.ended_at = new Date().toISOString();
      stage.reasons = (error as { reasons?: string[] }).reasons ?? [error instanceof Error ? error.message : "This step did not work. Try again."];
      rec.status = "failed"; rec.error = stage.reasons.join(" ");
      if (closed) { rec.closed = true; wipe(rec); }
      save(rec); return;
    }
  }
}

const TAKE_ID = /^take-[1-9][0-9]*$/;
/** Removes takes this job made: the whole take folder, the take record and any approval of it. `keep` are takes that stay. */
function purgeTakes(rec: PackJobRecord, keep: Set<string>): void {
  try {
    const all = readStates(rec.companion_id), root = householdCompanionFolder(rec.companion_id)!, listed = new Set(rec.takes.map((t) => `${t.state}/${t.take}`));
    for (const [state, row] of Object.entries(all.states)) {
      if (!row) continue;
      for (const t of [...row.takes]) {
        if (keep.has(t.id) || !TAKE_ID.test(t.id) || !(t.pack_job === rec.job || listed.has(`${state}/${t.id}`))) continue;
        if (row.approved === t.id) { row.approved = null; row.approved_by = null; row.approved_at = null; }
        row.takes = row.takes.filter((x) => x.id !== t.id);
        rmSync(join(root, "states", state, t.id), { recursive: true, force: true });
      }
    }
    saveStates(rec.companion_id, all);
  } catch { /* the states file is unreadable: the work folder is still removed */ }
}

/** Closes a job on a safety result: the work folder, this job's takes (whole folders), the keyframes it wrote and a half-copied pack are removed; nothing is installed. */
function wipe(rec: PackJobRecord): void {
  rmSync(workDir(rec.companion_id), { recursive: true, force: true });
  purgeTakes(rec, new Set());
  removeOwnKeyframes(rec);
  const root = householdCompanionFolder(rec.companion_id); if (root) rmSync(join(root, ".pack-installing"), { recursive: true, force: true });
  rec.takes = []; rec.clips = []; rec.keyframes = [];
  for (const s of PACK_STAGES) if (rec.stages[s].status === "done") rec.stages[s] = blankStage();
}
/** Removes the keyframes this job wrote, and only while they are still what it wrote. */
function removeOwnKeyframes(rec: PackJobRecord): void {
  for (const { state, sha } of rec.keyframes) {
    try { const path = keyframePath(rec.companion_id, state); if (sha && existsSync(path) && createHash("sha256").update(readFileSync(path)).digest("hex") === sha) removeKeyframe(rec.companion_id, state); } catch { /* already gone */ }
  }
  rec.keyframes = [];
}
/** A start-over: stops what ran, removes this job's work and takes (never the installed pack). */
async function wipeAll(rec: PackJobRecord): Promise<void> {
  for (const s of PACK_STAGES) for (const id of rec.stages[s].stack_jobs) await deps.ops.cancel(id);
  wipe(rec); rmSync(jobDir(rec.companion_id), { recursive: true, force: true });
}

/** The people whose lanes apply: everyone who started, resumed or approved (the strictest check wins). */
function lanes(ctx: Ctx): PersonRow[] {
  const seen = new Map<string, PersonRow>([[ctx.actor.id, ctx.actor]]);
  for (const id of ctx.rec.actors) if (!seen.has(id)) { const person = loadPerson(id); if (person) seen.set(id, person); }
  return [...seen.values()];
}
/** RULES 0 and 10: the one place every generated output is checked before a later stage reads it. A check that cannot run closes the job. The audience is read when the check runs. */
async function guard(ctx: Ctx, assets: FinishedAsset[], kind: CheckedKind): Promise<void> {
  for (const person of lanes(ctx)) {
    let result: FinishedCheckResult;
    try { result = await deps.checkArt(ctx.id, person, assets, kind); } catch { throw Object.assign(new ClosedError(PACK_CHECK_CLOSED_LINE), { reasons: [PACK_CHECK_CLOSED_LINE] }); }
    if (!result.ok) throw Object.assign(new ClosedError(result.reasons.join(" ")), { reasons: result.reasons.length ? result.reasons : [PACK_CHECK_CLOSED_LINE] });
  }
}
const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(path));
const hooks = (ctx: Ctx): PackOpHooks => ({ signal: ctx.run.controller.signal, onJob: (id) => { ctx.run.stackJobs.add(id); if (!ctx.rec.stages[ctx.stage].stack_jobs.includes(id)) { ctx.rec.stages[ctx.stage].stack_jobs.push(id); save(ctx.rec); } } });
const seedOf = (id: string): number => { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h % 2_147_483_647; };
function opFailed(label: string, result: PackOpResult): never { throw Object.assign(new Error(result.reasons.join(" ") || `${label} did not pass its checks. Try again.`), { reasons: result.reasons.length ? result.reasons : [`${label} did not pass its checks. Try again.`] }); }
export const PACK_EMPTY_LINE = "A step wrote no pictures or clips the safety check can look at, so the pack was stopped and nothing was kept. Try again.";
/** Checks every file under a folder (images, the frames of every mp4 or webm, nothing else readable passes): no files, or a file the check cannot read, closes the job. */
/** The length finishTake used for a clip (its report), so the pack scan takes the same number of frames; a file that is not a known clip gets the longest. */
function packClipSeconds(ctx: Ctx): (name: string) => number | null {
  const states = readStates(ctx.id).states, byName = new Map<string, number | null>(); let longest: number | null = null;
  for (const { state, take, name } of clipNames(ctx.rec)) { const sec = states[state as "idle"]?.takes.find((t) => t.id === take)?.report?.seconds ?? null; byName.set(name, sec); if (sec !== null && (longest === null || sec > longest)) longest = sec; }
  return (file) => { const stem = file.replace(/\.phone\.mp4$|\.mp4$/i, ""); return byName.has(stem) ? byName.get(stem)! : longest; };
}
async function guardDir(ctx: Ctx, dir: string, label: string, kind: CheckedKind = "picture", seconds: number | null | ((name: string) => number | null) = null): Promise<number> {
  const found = await dirAssets(dir, label, seconds);
  if (found.assets.length === 0) throw Object.assign(new ClosedError(PACK_EMPTY_LINE), { reasons: [PACK_EMPTY_LINE] });
  await guard(ctx, found.assets, kind);
  return found.assets.length;
}
const sourcePath = (id: string): string => join(workDir(id), "source.png");
/** The keyed rest picture cropped to the pack frame, 480x480 with alpha: the `rest` of every op after the clips. */
const restPackPath = (id: string): string => join(workDir(id), "rest_480.png");

/** The pack frame: defined once from the keyed green source and kept in the job record (a resume reuses it); writes rest_480.png. */
async function frameFor(ctx: Ctx): Promise<{ frame: PackFrame; frameSource: Dims }> { const { frame, source } = await ensureFrame(ctx); return { frame, frameSource: source }; }
async function ensureFrame(ctx: Ctx): Promise<{ frame: PackFrame; source: Dims }> {
  const rec = ctx.rec;
  if (rec.frame && rec.frame_source && existsSync(restPackPath(ctx.id))) return { frame: rec.frame, source: rec.frame_source };
  const source = bytesOf(sourcePath(ctx.id)), key = readLook(ctx.id).sheet?.key ?? "#00FF00";
  if (!rec.frame || !rec.frame_source) { const made = await packFrameOfSource(source, key); rec.frame = made.frame; rec.frame_source = made.size; save(rec); }
  writeFileSync(restPackPath(ctx.id), await cropToPack(await keyOut(source, key), rec.frame, rec.frame_source));
  return { frame: rec.frame, source: rec.frame_source };
}
const packOut = (id: string): string => join(workDir(id), "pack-out", "pack");
/** The clips in the order they were made, each with the name it carries in the staging folder (idle-1, idle-2, listening-1, ...). */
function clipNames(rec: PackJobRecord): Array<{ state: string; take: string; name: string }> {
  const seen: Record<string, number> = {};
  return rec.clips.map(({ state, take }) => ({ state, take, name: `${state}-${(seen[state] = (seen[state] ?? 0) + 1)}` }));
}

/** The starting picture's pixels to the green source's pixels (the edit may return another size). */
async function restScale(ctx: Ctx): Promise<{ x: number; y: number }> {
  const meta = await sharp(sourcePath(ctx.id)).metadata().catch(() => null), rest = ctx.rec.rest_size;
  return rest && meta?.width && meta.height ? { x: meta.width / rest.width, y: meta.height / rest.height } : { x: 1, y: 1 };
}

/** The stylised mouth set: the calm letters B to H, each one picture edit from the checked green source, each through the art check before the engine op reads it. Needs the mouth box. */
async function stylisedShapes(ctx: Ctx): Promise<Record<string, unknown>> {
  const box = ctx.rec.box;
  if (!box) throw Object.assign(new Error(PACK_NO_BOX_LINE), { reasons: [PACK_NO_BOX_LINE] });
  const k = await restScale(ctx), source = bytesOf(sourcePath(ctx.id)), { frame, source: frameSource } = await ensureFrame(ctx), pk = PACK_FRAME_PX / frame.size;
  const dir = join(workDir(ctx.id), "shapes-in"); rmSync(dir, { recursive: true, force: true }); mkdirSync(join(dir, "calm"), { recursive: true });
  let outputs = 0;
  for (const letter of STYLISED_LETTERS) {
    if (ctx.run.controller.signal.aborted) return {};
    // The source already passed prepareEditSource and the art check (stage source); generatedness is the pack maker's own.
    const edit = await deps.ops.imageEdit({ image: source, instruction: stylisedLetterInstruction(letter), seed: seedOf(ctx.id) + 2, imageSource: "generated", ...hooks(ctx) });
    await guard(ctx, [{ label: `The mouth picture ${letter}`, bytes: edit }], "picture"); outputs++;
    writeFileSync(join(dir, "calm", `${letter}.png`), await cropToPack(edit, frame, frameSource));
  }
  const out = join(workDir(ctx.id), "shapes-out"); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const [bx, by, bw, bh] = box as [number, number, number, number], corner = packPoint(frame, frameSource, frameSource, [bx * k.x, by * k.y]); // the mouth box in the pack frame (480x480)
  // MAKER-F: { path: "stylised", rest, frames_dir, mouth_box, face_height_px?, sets, output_dir } -> <output_dir>/shapes/calm/..., report.json.
  const result = await deps.ops.run("media.companion_shapes", { path: "stylised", rest: restPackPath(ctx.id), frames_dir: dir, mouth_box: [Math.round(corner[0]!), Math.round(corner[1]!), Math.round(bw * k.x * pk), Math.round(bh * k.y * pk)], ...(ctx.rec.face_height_px ? { face_height_px: Math.round(ctx.rec.face_height_px * k.y * pk) } : {}), sets: ["calm"], output_dir: out }, hooks(ctx));
  if (!result.ok) opFailed("The mouth shapes", result);
  outputs += await guardDir(ctx, join(out, "shapes"), "A mouth shape tile");
  return { frames: outputs, ...result.report };
}

const STAGE_RUNNERS: Record<PackStage, (ctx: Ctx) => Promise<Record<string, unknown> | void>> = {
  async source(ctx) {
    const path = versionPath(ctx.id, ctx.rec.still_id);
    if (!path || !existsSync(path)) throw new Error(PACK_NO_STILL_LINE);
    const still = bytesOf(path), generated = Boolean(versionOriginalPath(ctx.id, ctx.rec.still_id));
    // RULES 0: the starting image through prepareEditSource.
    const screened = await prepareEditSource({ audience: routeAudience(ctx.actor), bytes: still, generated, text: "Put the character on a flat green background." });
    if (!screened.ok) throw Object.assign(new Error(screened.line), { reasons: [screened.line] });
    const key = readLook(ctx.id).sheet?.key === "#FF00FF" ? "magenta" : "green";
    const edited = await deps.ops.imageEdit({ image: still, instruction: `Place the exact same character on a flat, even ${key} chroma key background (pure ${key === "green" ? "#00FF00" : "#FF00FF"}). Keep the face, skin, hair, clothes, pose and lighting exactly as they are, with no ${key} tint on the character.`, seed: seedOf(ctx.id), imageSource: screened.imageSource, ...hooks(ctx) });
    await guard(ctx, [{ label: "The green source picture", bytes: edited }], "picture");
    mkdirSync(workDir(ctx.id), { recursive: true });
    writeFileSync(sourcePath(ctx.id), edited);
    ctx.rec.frame = null; ctx.rec.frame_source = null; rmSync(restPackPath(ctx.id), { force: true }); // a new source gets a new frame
    await ensureFrame(ctx);
    return { file: "source.png", sha: promptHash(Buffer.from(edited).toString("base64")).slice(0, 16) };
  },

  async clips(ctx) {
    const made: Array<{ state: string; take: string }> = [];
    // A clips stage that runs again (a resume, a retry) starts from none of its own earlier takes.
    purgeTakes(ctx.rec, new Set()); ctx.rec.takes = []; ctx.rec.clips = [];
    // The takes start from the checked green source: a state with no picture of its own gets it as its keyframe (a person's own keyframe stays).
    const source = bytesOf(sourcePath(ctx.id)), now = new Date().toISOString();
    for (const { state } of PACK_CLIP_STATES) if (!existsSync(keyframePath(ctx.id, state))) { writeKeyframe(ctx.id, state, source, { source: "generated", style: "keep", prompt_hash: promptHash("Keyframe from the pack maker's green source"), model: null, created_at: now, edited_at: now }); ctx.rec.keyframes = ctx.rec.keyframes.filter((k) => k.state !== state); ctx.rec.keyframes.push({ state, sha: createHash("sha256").update(source).digest("hex") }); }
    save(ctx.rec);
    try {
      for (const { state, need } of PACK_CLIP_STATES) {
        const good: string[] = [], reasons: string[] = [];
        for (let attempt = 0; attempt <= CLIP_REROLLS && good.length < need; attempt++) {
          if (ctx.run.controller.signal.aborted) return;
          const takes = await deps.clips.makeTakes({ actor: ctx.actor, companionId: ctx.id, state, count: need - good.length, job: ctx.rec.job, ...(await frameFor(ctx)), signal: ctx.run.controller.signal, onRun: (id) => { ctx.run.takeRun = id; }, onJob: hooks(ctx).onJob });
          for (const t of takes) ctx.rec.takes.push({ state, take: t.take });
          save(ctx.rec);
          for (const t of takes) {
            // A safety refusal closes the job at once; only a measured-quality failure is re-rolled.
            if (t.art) throw Object.assign(new ClosedError(t.reasons.join(" ") || PACK_CHECK_CLOSED_LINE), { reasons: t.reasons.length ? t.reasons : [PACK_CHECK_CLOSED_LINE] });
            if (!t.ok) { reasons.push(...t.reasons); continue; }
            // RULES 0 and 10: the still, the clip frames and the phone twin of this take, sampled as finishTake samples them, before anything reads the clip.
            const seconds = readStates(ctx.id).states[state as "idle"]?.takes.find((x) => x.id === t.take)?.report?.seconds ?? null;
            await guard(ctx, await takeAssets(ctx.id, state, t.take, seconds), "video");
            good.push(t.take);
          }
        }
        if (good.length < need) throw Object.assign(new Error(`The ${state} clip did not come out after ${CLIP_REROLLS + 1} tries.`), { reasons: [`The ${state} clip did not come out after ${CLIP_REROLLS + 1} tries.${reasons.length ? ` ${[...new Set(reasons)].join(" ")}` : ""}`] });
        for (const take of good) made.push({ state, take });
      }
    } catch (error) {
      removeOwnKeyframes(ctx.rec); save(ctx.rec); // a failed or stopped clips stage leaves no green-source keyframe behind
      // Takes a call made before it was stopped (or that failed) are removed, closed job or not; takes of a finished state stay with the stage record.
      if (!(error instanceof ClosedError)) purgeTakes(ctx.rec, new Set(made.map((m) => m.take)));
      throw error;
    }
    // Keep only the takes that passed; the rest of this job's takes (failed re-rolls) are removed.
    purgeTakes(ctx.rec, new Set(made.map((m) => m.take))); ctx.rec.takes = made.map((m) => ({ ...m }));
    removeOwnKeyframes(ctx.rec); // the takes are made: later normal takes must not start from the green source
    ctx.rec.clips = made;
    return { clips: made };
  },

  async track(ctx) {
    await ensureFrame(ctx);
    const reports: Record<string, unknown>[] = [], staging = join(workDir(ctx.id), "staging", "clips"); rmSync(join(workDir(ctx.id), "track"), { recursive: true, force: true }); mkdirSync(staging, { recursive: true });
    for (const { state, take, name } of clipNames(ctx.rec)) {
      const clip = takePath(ctx.id, state, take, "clip.h264.mp4")!, out = join(workDir(ctx.id), "track", name); mkdirSync(out, { recursive: true });
      // MAKER-H: { rest, clip, output_dir } -> track.json and report.json in output_dir.
      const result = await deps.ops.run("media.companion_track", { rest: restPackPath(ctx.id), clip, clip_stacked: true, output_dir: out }, hooks(ctx));
      reports.push({ state, take, ok: result.ok, reasons: result.reasons });
      if (!result.ok) opFailed(`The ${state} head track`, result);
      // The staging folder the pack op reads: clips/<name>.mp4, .track.json and the phone twin when the clip op made one.
      cpSync(clip, join(staging, `${name}.mp4`)); cpSync(join(out, "track.json"), join(staging, `${name}.track.json`));
      const phone = join(clip, "..", "clip.phone.h264.mp4"); if (existsSync(phone)) cpSync(phone, join(staging, `${name}.phone.mp4`));
    }
    return { clips: reports };
  },

  async shapes(ctx) {
    if (ctx.rec.shapes === "stylised") return stylisedShapes(ctx);
    if (ctx.rec.shapes !== "photo") throw new Error(PACK_NOT_SUPPORTED_LINE);
    const { frame: packFrameOf, source: frameSource } = await ensureFrame(ctx);
    const frames = await deps.ops.talkFrames({ image: bytesOf(sourcePath(ctx.id)), letters: TALK_LETTERS, ...hooks(ctx) });
    const dir = join(workDir(ctx.id), "shapes-in"); rmSync(dir, { recursive: true, force: true }); mkdirSync(join(dir, "calm"), { recursive: true });
    let outputs = 0;
    const lm: Record<string, unknown> = {};
    for (const letter of TALK_LETTERS) {
      const frame = frames.frames[letter];
      if (!frame) throw Object.assign(new Error(`The mouth picture ${letter} was not made. Try again.`), { reasons: [`The mouth picture ${letter} was not made. Try again.`] });
      await guard(ctx, [{ label: `The mouth picture ${letter}`, bytes: frame }], "picture"); outputs++;
      // The baker reads calm/B.png to H.png; A (closed, the rest) and wide are kept beside, not sent.
      // The LivePortrait frames and their landmarks are in the green source's pixels: both go into the pack frame (crop, 480x480) before the op reads them.
      const packed = await cropToPack(frame, packFrameOf, frameSource);
      if (/^[B-H]$/.test(letter)) { writeFileSync(join(dir, "calm", `${letter}.png`), packed); const marks = frames.landmarks[letter]; lm[letter] = marks ? packLandmarks(marks, packFrameOf, frameSource, await sizeOf(frame)) : marks; }
      else writeFileSync(join(workDir(ctx.id), `mouth-${letter}.png`), packed);
    }
    const missing = ["rest", ...Object.keys(lm)].filter((k) => (k === "rest" ? !frames.sourceLandmarks : !lm[k]));
    if (missing.length) throw Object.assign(new Error("The face tools did not find the face in every mouth picture. Choose a starting picture where the face is clear."), { reasons: ["The face tools did not find the face in every mouth picture. Choose a starting picture where the face is clear."] });
    // landmarks.json holds the rest picture's landmarks in the pack frame (480x480 pixels): the emotion eyes and the mouth anchor read it.
    writeFileSync(join(workDir(ctx.id), "landmarks.json"), JSON.stringify(packLandmarks(frames.sourceLandmarks!, packFrameOf, frameSource, frameSource)));
    const out = join(workDir(ctx.id), "shapes-out"); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
    // MAKER-H: { rest, frames_dir, landmarks: { rest, calm: { B..H } }, sets, output_dir } -> <output_dir>/shapes/calm/..., report.json.
    const result = await deps.ops.run("media.companion_shapes", { rest: restPackPath(ctx.id), frames_dir: dir, landmarks: { rest: packLandmarks(frames.sourceLandmarks!, packFrameOf, frameSource, frameSource), calm: lm }, sets: ["calm"], output_dir: out }, hooks(ctx));
    if (!result.ok) opFailed("The mouth shapes", result);
    outputs += await guardDir(ctx, join(out, "shapes"), "A mouth shape tile");
    return { frames: outputs, ...result.report };
  },

  async emotion(ctx) {
    const dir = join(workDir(ctx.id), "emotion-in"); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    if (ctx.rec.shapes === "stylised" && (!ctx.rec.eyes?.left.length || !ctx.rec.eyes?.right.length)) throw Object.assign(new Error(PACK_NO_EYES_LINE), { reasons: [PACK_NO_EYES_LINE] }); // before any picture is made
    const source = bytesOf(sourcePath(ctx.id)), poses: Record<string, string[]> = {}, { frame, source: frameSource } = await ensureFrame(ctx);
    for (const emotion of EMOTIONS) {
      const pose = await deps.ops.imageEdit({ image: source, instruction: `Change only the face to look ${emotion}. Keep the exact same character, skin, hair, clothes, framing, lighting and green background.`, seed: seedOf(ctx.id) + 1, imageSource: "generated", ...hooks(ctx) });
      await guard(ctx, [{ label: `The ${emotion} pose`, bytes: pose }], "picture");
      writeFileSync(join(dir, `${emotion}.png`), await cropToPack(pose, frame, frameSource)); poses[emotion] = [join(dir, `${emotion}.png`)];
    }
    // The 203-point layout: points 0..23 are the eye on the image's left, 24..47 the one on its right (confirmed on a real run); an explicit leftEye/rightEye wins if the Stack ever returns them.
    let leftEye: number[][] | undefined, rightEye: number[][] | undefined;
    if (ctx.rec.shapes === "stylised") { // no face landmark model for a drawn face: the eye points come from the request (scaled to the green source's size)
      const k = await restScale(ctx);
      leftEye = ctx.rec.eyes?.left.map(([x, y]) => packPoint(frame, frameSource, frameSource, [x! * k.x, y! * k.y])); rightEye = ctx.rec.eyes?.right.map(([x, y]) => packPoint(frame, frameSource, frameSource, [x! * k.x, y! * k.y]));
      if (!leftEye?.length || !rightEye?.length) throw Object.assign(new Error(PACK_NO_EYES_LINE), { reasons: [PACK_NO_EYES_LINE] });
    } else { // landmarks.json is already in the pack frame
      const face = JSON.parse(readFileSync(join(workDir(ctx.id), "landmarks.json"), "utf8")) as { leftEye?: number[][]; rightEye?: number[][]; points?: number[][] } | null;
      leftEye = face?.leftEye ?? face?.points?.slice(0, 24); rightEye = face?.rightEye ?? face?.points?.slice(24, 48);
      if (!leftEye?.length || !rightEye?.length) throw Object.assign(new Error("The face tools did not find the eyes. Choose a starting picture where the face is clear."), { reasons: ["The face tools did not find the eyes. Choose a starting picture where the face is clear."] });
    }
    const out = join(workDir(ctx.id), "emotion-out"); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
    // MAKER-H: { rest, landmarks: { leftEye, rightEye }, poses: { <emotion>: [path] }, output_dir } -> <output_dir>/emotion/.
    const result = await deps.ops.run("media.companion_emotion", { rest: restPackPath(ctx.id), landmarks: { leftEye, rightEye }, poses, output_dir: out }, hooks(ctx));
    if (!result.ok) opFailed("The emotions", result);
    await guardDir(ctx, join(out, "emotion"), "An emotion tile");
    return { poses: EMOTIONS.length, ...result.report };
  },

  async assemble(ctx) {
    const staging = join(workDir(ctx.id), "staging"), out = join(workDir(ctx.id), "pack-out");
    cpSync(join(workDir(ctx.id), "shapes-out", "shapes", "calm"), join(staging, "mouth", "calm"), { recursive: true });
    cpSync(join(workDir(ctx.id), "emotion-out", "emotion"), join(staging, "emotion"), { recursive: true });
    rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
    const w = PACK_FRAME_PX, h = PACK_FRAME_PX, { frame, source: frameSource } = await ensureFrame(ctx); // lip points are in the pack frame, so the anchor is a share of 480
    let lips: number[][] = [];
    if (ctx.rec.shapes === "stylised" && ctx.rec.box) { const k = await restScale(ctx), [bx, by, bw, bh] = ctx.rec.box as [number, number, number, number]; lips = [packPoint(frame, frameSource, frameSource, [bx * k.x, by * k.y]), packPoint(frame, frameSource, frameSource, [(bx + bw) * k.x, (by + bh) * k.y])]; } // the mouth box stands in for the lip outline
    else lips = (JSON.parse(readFileSync(join(workDir(ctx.id), "landmarks.json"), "utf8")) as { outerLips?: number[][] } | null)?.outerLips ?? [];
    const xs = lips.map((p) => p[0]!), ys = lips.map((p) => p[1]!);
    const names = clipNames(ctx.rec), states: Record<string, string[]> = {};
    for (const { state, name } of names) (states[state] ??= []).push(name);
    // MAKER-H: { rest, staging, descriptor, output_dir } -> <output_dir>/pack/ (pack.json, files, build-report.json).
    const descriptor = { id: ctx.id, name: getHouseholdCompanion(ctx.id)?.companion?.display_name ?? ctx.id, provenance: { source: "MaiPai Home pack maker", maker: "MaiPai Home", created: new Date().toISOString() }, ...(lips.length ? { mouth: { anchor: { x: Math.min(...xs) / w, y: Math.min(...ys) / h, w: (Math.max(...xs) - Math.min(...xs)) / w, h: (Math.max(...ys) - Math.min(...ys)) / h } } } : {}), states };
    // The Stack has no op for the head and eyes layers yet; the pack is built without them (they are optional in the spec).
    ctx.rec.notes = [...new Set([...(ctx.rec.notes ?? []), PACK_NOTE_HEAD_EYES, PACK_NOTE_SHOUT])]; save(ctx.rec);
    const result = await deps.ops.run("media.companion_pack", { rest: restPackPath(ctx.id), staging, descriptor, output_dir: out }, hooks(ctx));
    if (!result.ok) opFailed("The pack", result);
    if (!existsSync(join(packOut(ctx.id), "pack.json"))) throw Object.assign(new Error("The pack was not written. Try again."), { reasons: ["The pack was not written. Try again."] });
    return result.report;
  },

  async validate(ctx) {
    const dir = packOut(ctx.id), problems: string[] = [];
    // The spec validator, then the measured reports of every op that ran.
    try { problems.push(...packFolderProblems(dir, JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")))); } catch (error) { problems.push(`pack.json could not be read (${(error as Error).message}); make the pack again.`); }
    for (const stage of PACK_STAGES) for (const note of reportReasons(ctx.rec.stages[stage].report)) problems.push(note);
    if (problems.length) throw Object.assign(new Error(problems.join(" ")), { reasons: problems });
    await guardDir(ctx, dir, "The assembled pack", "video", packClipSeconds(ctx)); // the pack's own art, every picture and the frames of every clip including the phone twins
    return { bytes: dirBytes(dir) };
  },

  async install(ctx) {
    const root = householdCompanionFolder(ctx.id)!, from = packOut(ctx.id), staged = join(root, ".pack-installing"), target = join(root, "pack"), old = join(root, ".pack-old");
    // A swap that was cut off leaves the old pack beside: put it back first.
    if (!existsSync(target) && existsSync(old)) renamer(old, target);
    // The check runs again here against the audience as it is now: an audience change after validate is caught, and nothing is installed unchecked.
    await guardDir(ctx, from, "The pack to install", "video", packClipSeconds(ctx));
    const problems = (() => { try { return packFolderProblems(from, JSON.parse(readFileSync(join(from, "pack.json"), "utf8"))); } catch { return ["The pack could not be read. Make it again."]; } })();
    if (problems.length) throw Object.assign(new Error(problems.join(" ")), { reasons: problems });
    rmSync(staged, { recursive: true, force: true });
    cpSync(from, staged, { recursive: true, filter: (src) => !lstatSync(src).isSymbolicLink() }); // a link is never copied (the scan above already refuses one)
    try {
      if (existsSync(target)) { rmSync(old, { recursive: true, force: true }); renamer(target, old); } // the current pack is confirmed here, so a stale `.pack-old` can go
      renamer(staged, target);
    } catch (error) {
      if (!existsSync(target) && existsSync(old)) renamer(old, target); // roll back: the old pack is installed again
      rmSync(staged, { recursive: true, force: true });
      throw Object.assign(new Error("The pack could not be installed, so the old pack was kept. Try again."), { reasons: ["The pack could not be installed, so the old pack was kept. Try again."], cause: error });
    }
    rmSync(old, { recursive: true, force: true }); // only now, with the new pack in place
    return { installed: "pack" };
  },
};

function reportReasons(report: Record<string, unknown> | null): string[] {
  if (!report) return [];
  const out: string[] = [];
  if (report.ok === false) out.push(...(Array.isArray(report.reasons) ? report.reasons.map(String) : ["A step reported a problem."]));
  const clips = (report as { clips?: unknown }).clips;
  if (Array.isArray(clips)) for (const c of clips as Array<{ ok?: boolean; reasons?: string[] }>) if (c?.ok === false) out.push(...(c.reasons ?? ["A clip reported a problem."]));
  return out;
}
function dirBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) if (entry.isFile()) total += statSync(join(entry.parentPath, entry.name)).size;
  return total;
}
