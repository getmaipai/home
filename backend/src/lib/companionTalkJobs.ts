import { readFileSync } from "node:fs";
import sharp from "sharp";
import type { PersonRow } from "@/types";
import { ArtWithheldError, requireCompanionPictureOk } from "@/lib/companionArtCheck";
import { addVersion, deleteVersion, readLook, updateSheet, versionPath } from "@/lib/companionLook";
import type { CompanionTalk } from "@/lib/companionLook";
import { makeTalkPicture, TALK_SHAPES, TALK_EYES, TALK_KEEP } from "@/lib/companionTalkMaker";
import { resolveCompanionEdit, promptHash } from "@/lib/companionArt";
import { pictureDenial, PICTURE_DENIAL_LINE } from "@/lib/pictures/policy";
import { routeAudience } from "@/lib/pictures/audience";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { lookGenerationGate, activeLookJob, busyLineFor, LOOK_ENGINE_NOT_READY_LINE } from "@/lib/companionLookJobs";
import type { LookJobState } from "@/lib/companionLookJobs";
import { companionHasFinishingJob } from "@/lib/companionStates";
import { companionHasTakeRun } from "@/lib/companionTakes";

type Box = { x: number; y: number; w: number; h: number };
type TalkAnchors = { anchor: Box; eyes_anchor: Box };

interface TalkJob {
  companionId: string;
  personId: string;
  state: LookJobState;
  percent: number;
  error: string | null;
  index: number;
  anchors: TalkAnchors;
  controller: AbortController;
}

const GENERIC_FAILURE_LINE = "The talk pictures did not work. Try again.";
const talkJobs = new Map<string, TalkJob>();
const activeTalkByCompanion = new Map<string, string>();

const talkSteps = [
  ...Object.entries(TALK_SHAPES).map(([key, words]) => ({ kind: "shape" as const, key, label: `Talk ${key}`, words })),
  ...Object.entries(TALK_EYES).map(([key, words]) => ({ kind: "eyes" as const, key, label: `Eyes ${key}`, words })),
];

export function talkJobBusy(companionId: string): boolean {
  return activeTalkByCompanion.has(companionId);
}

export function talkJobFor(id: string, actor: PersonRow, companionId: string): TalkJob | null {
  const job = talkJobs.get(id);
  return job?.personId === actor.id && job.companionId === companionId ? job : null;
}

function stepInstruction(step: (typeof talkSteps)[number]): string {
  if (step.kind === "eyes") {
    return `Change only the eyes: ${step.words}. ${TALK_KEEP}`;
  }
  return `Change only the mouth: ${step.words}. ${TALK_KEEP}`;
}

/** The same gates as `startLookSheet`: picture policy, prompt screen, engine ready, nothing else running. */
export async function startCompanionTalk(input: { actor: PersonRow; companionId: string; anchors: TalkAnchors }): Promise<string> {
  const denied = pictureDenial(routeAudience(input.actor));
  if (denied) throw Object.assign(new Error(PICTURE_DENIAL_LINE[denied]), { status: 403 });
  const gate = lookGenerationGate(input.actor, "Make consistent talking mouth and eye pictures.");
  if (gate) throw Object.assign(new Error(gate.error), { status: gate.status });
  if (!(await pictureEngineReady())) throw Object.assign(new Error(LOOK_ENGINE_NOT_READY_LINE), { status: 503 });
  const busy =
    activeLookJob(input.companionId) ||
    talkJobBusy(input.companionId) ||
    companionHasFinishingJob(input.companionId) ||
    companionHasTakeRun(input.companionId);
  if (busy) throw Object.assign(new Error(busyLineFor(input.companionId)), { status: 409 });
  const look = readLook(input.companionId);
  if (!look.rest || !versionPath(input.companionId, look.rest)) {
    throw Object.assign(new Error("Choose a rest picture before making talk pictures."), { status: 400 });
  }
  const id = crypto.randomUUID();
  const job: TalkJob = {
    companionId: input.companionId,
    personId: input.actor.id,
    state: "queued",
    percent: 0,
    error: null,
    index: 0,
    anchors: input.anchors,
    controller: new AbortController(),
  };
  talkJobs.set(id, job);
  activeTalkByCompanion.set(input.companionId, id);
  const key = look.sheet?.key ?? look.key;
  const emptySheet = {
    views: { left: null, right: null, mouth: null },
    card: null,
    key,
    state: "needs_review" as const,
    approved_by: null,
    approved_at: null,
  };
  const prior = look.sheet?.talk;
  updateSheet(input.companionId, {
    ...(look.sheet ?? emptySheet),
    talk: {
      state: "needs_review",
      maker: "crop-edit",
      anchor: input.anchors.anchor,
      eyes_anchor: input.anchors.eyes_anchor,
      shapes: prior?.shapes ?? {},
      eyes: prior?.eyes ?? {},
    },
  });
  void runTalk(id, job, input.actor);
  return id;
}

async function makeStep(job: TalkJob, actor: PersonRow, rest: Uint8Array, restId: string, index: number): Promise<void> {
  const step = talkSteps[index]!;
  const eyes = step.kind === "eyes";
  const instruction = stepInstruction(step);
  const image = await makeTalkPicture({
    rest,
    anchor: eyes ? job.anchors.eyes_anchor : job.anchors.anchor,
    instruction,
    companionId: job.companionId,
    eyes,
    signal: job.controller.signal,
  });
  await requireCompanionPictureOk(job.companionId, actor, step.label, image);
  const meta = await sharp(image).metadata();
  const saved = addVersion(job.companionId, image, {
    source: "edit",
    label: step.label,
    width: meta.width ?? 1024,
    height: meta.height ?? 1024,
    from: restId,
    style: "keep",
    model: resolveCompanionEdit().model,
    quality: "quick",
    prompt_hash: promptHash(instruction),
    model_reported: null,
  });
  const sheet = readLook(job.companionId).sheet!;
  const talk = sheet.talk!;
  const updated: CompanionTalk =
    step.kind === "shape"
      ? { ...talk, shapes: { ...talk.shapes, [step.key]: saved.id } }
      : { ...talk, eyes: { ...talk.eyes, [step.key]: saved.id } };
  updateSheet(job.companionId, { ...sheet, talk: updated });
}

/** After a full run only the newest picture per shape and eye state stays; the rest picture and everything else is left alone. */
function pruneOldTalkVersions(companionId: string): void {
  const look = readLook(companionId);
  const talk = look.sheet?.talk;
  if (!talk) return;
  const current = new Set([...Object.values(talk.shapes), ...Object.values(talk.eyes)]);
  for (const version of look.versions) {
    if (current.has(version.id) || version.id === look.rest) continue;
    if (version.source === "edit" && /^(Talk [A-F]|Eyes (closed|half))$/.test(version.label)) {
      deleteVersion(companionId, version.id);
    }
  }
}

async function runTalk(id: string, job: TalkJob, actor: PersonRow): Promise<void> {
  try {
    const look = readLook(job.companionId);
    const path = look.rest ? versionPath(job.companionId, look.rest) : null;
    if (!look.rest || !path) throw new Error("The rest picture could not be found.");
    const rest = new Uint8Array(readFileSync(path));
    for (let index = job.index; index < talkSteps.length; index++) {
      if (job.controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      job.index = index;
      job.state = "running";
      await makeStep(job, actor, rest, look.rest, index);
      job.percent = Math.round(((index + 1) / talkSteps.length) * 100);
    }
    pruneOldTalkVersions(job.companionId);
    job.state = "done";
    job.percent = 100;
  } catch (error) {
    const stopped = error instanceof DOMException && error.name === "AbortError";
    job.state = stopped ? "cancelled" : "failed";
    const withheld = error instanceof ArtWithheldError;
    job.error = withheld && error instanceof Error ? error.message : GENERIC_FAILURE_LINE;
  } finally {
    // A cancelled job may finish after a newer one started for the same companion; only free our own slot.
    if (activeTalkByCompanion.get(job.companionId) === id) activeTalkByCompanion.delete(job.companionId);
  }
}

function cardLabel(state: LookJobState): string {
  if (state === "done") return "Talk pictures ready";
  if (state === "failed") return "Talk pictures need attention";
  if (state === "cancelled") return "Talk picture making stopped";
  return "Making talk pictures";
}

export function publicTalkJob(id: string, actor: PersonRow, companionId: string) {
  const job = talkJobFor(id, actor, companionId);
  if (!job) return null;
  const steps = talkSteps.map((step, index) => {
    let state = "queued";
    if (index < job.index || job.state === "done") state = "done";
    else if (index === job.index && job.state === "running") state = "running";
    else if (index === job.index && job.state === "failed") state = "failed";
    return { label: step.label, state };
  });
  return { state: job.state, percent: job.percent, label: cardLabel(job.state), steps, error: job.error };
}

export function cancelTalkJob(id: string, actor: PersonRow, companionId: string): boolean {
  const job = talkJobFor(id, actor, companionId);
  if (!job || ["done", "failed", "cancelled"].includes(job.state)) return false;
  job.controller.abort();
  job.state = "cancelled";
  activeTalkByCompanion.delete(companionId);
  return true;
}

export function clearCompanionTalkJobs(): void {
  talkJobs.clear();
  activeTalkByCompanion.clear();
}
