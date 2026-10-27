// Finished-item check for a companion's own art (look pictures, character sheet views, clip stills and clip frames), run when the art is made
// or uploaded and again at Publish and on an audience change. It is the standard check (pictures/finishedCheck.ts) held to the stricter of the
// companion's audience and the person who asked: an all-ages companion's art gets the child lane's cartoon question, a teen one the teen
// lane, an adult-only one withholds a possible minor in a nude or sexual picture. A check that cannot run withholds (adult-only, teen and child). Verdicts are kept per sha256 in the
// companion's states record, so a file is looked at once.
import type { PersonRow } from "@/types";
import { getHouseholdCompanion } from "@/lib/householdCompanions";
import { readStates, saveStates, takePath } from "@/lib/companionStates";
import { readLook, versionPath } from "@/lib/companionLook";
import { checkFinishedAssets, stricterLane, type FinishedAsset, type FinishedCheckResult } from "@/lib/pictures/finishedCheck";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import type { CheckedKind } from "@/lib/pictures/ageCheck";
import type { Lane } from "@/lib/pictures/lane";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import media from "@maipai/spec/vocab/companion-media.json";
import { dirname, join } from "node:path";
import { dataDir } from "@/lib/paths";
import { householdCompanionFolder, listHouseholdCompanionIds, holdHouseholdCompanionAudience, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { reloadPersonas } from "@/lib/persona";

export type CompanionAudience = "adult" | "teen" | "all";

/** Thrown where art is refused, so the caller can show the reason as it stands (it already says what to do next). */
export class ArtWithheldError extends Error {}

export function audienceLane(audience: CompanionAudience): Lane { return audience === "all" ? "child" : audience; }

export function companionAudience(companionId: string): CompanionAudience { return getHouseholdCompanion(companionId)?.companion?.audience ?? "adult"; }

/** Checks art for a companion for the person asking (null: a sweep with no one asking, held to the companion's audience alone). */
export async function checkCompanionArt(companionId: string, actor: PersonRow | null, assets: readonly FinishedAsset[], kind: CheckedKind = "picture", audience: CompanionAudience = companionAudience(companionId)): Promise<FinishedCheckResult> {
  const lane = actor ? stricterLane(audienceLane(audience), laneOfPerson(actor)) : audienceLane(audience);
  const cache = { ...(readStates(companionId).checks ?? {}) };
  const result = await checkFinishedAssets({ assets, lane, adultOnly: audience === "adult", kind, cache, ...(actor ? { report: { personId: actor.id, jobId: `companion:${companionId}` } } : {}) });
  // The checks can take a while: merge only the verdicts gained into a fresh read.
  const fresh = readStates(companionId);
  fresh.checks = { ...(fresh.checks ?? {}), ...cache };
  saveStates(companionId, fresh);
  return result;
}

/** One picture, refused with its reason when it fails. */
export async function requireCompanionPictureOk(companionId: string, actor: PersonRow, label: string, bytes: Uint8Array): Promise<void> {
  const result = await checkCompanionArt(companionId, actor, [{ label, bytes }]);
  if (!result.ok) throw new ArtWithheldError(result.reasons.join(" "));
}

/** A finished take: its still and the frames of its clip. */
export async function takeAssets(companionId: string, state: string, takeId: string, seconds: number | null): Promise<FinishedAsset[]> {
  const assets: FinishedAsset[] = [];
  const stillPath = takePath(companionId, state, takeId, "still.png"), clipPath = takePath(companionId, state, takeId, "clip.h264.mp4");
  try { assets.push({ label: `The ${state} still`, bytes: new Uint8Array(readFileSync(stillPath!)) }); } catch { assets.push({ label: `The ${state} still` }); }
  let frames: Uint8Array[] | null = null;
  try { frames = await extractKeyframes(new Uint8Array(readFileSync(clipPath!)), seconds); } catch { frames = null; }
  if (!frames) assets.push({ label: `The ${state} clip frames` }); else for (const bytes of frames) assets.push({ label: `The ${state} clip frames`, bytes });
  return assets;
}

/** Clip lengths are not recorded for a live clip, so frames are taken within the shortest length the state allows. */
function clipSeconds(state: string): number { return media.states.find((row) => row.id === state)?.min_seconds ?? 3; }

/** Every picture the person may be shown for this companion, for the audience check: the look pictures (any of them can be served as a portrait) and the live animation's starting picture, stills and clip frames. */
export async function collectLiveAssets(companionId: string): Promise<FinishedAsset[]> {
  const assets: FinishedAsset[] = [], add = (label: string, path: string | null) => { try { assets.push({ label, bytes: new Uint8Array(readFileSync(path!)) }); } catch { assets.push({ label }); } };
  for (const version of readLook(companionId).versions) add(`Look picture ${version.id}`, versionPath(companionId, version.id));
  const animation = getHouseholdCompanion(companionId)?.companion?.animation;
  if (!animation) return assets;
  const root = join(householdCompanionFolder(companionId)!, "animation");
  add("The starting picture", join(root, animation.sheet?.rest ?? "rest.png"));
  for (const [state, files] of Object.entries(animation.states ?? {})) {
    add(`The ${state} still`, join(root, files.still));
    let frames: Uint8Array[] | null = null;
    try { frames = await extractKeyframes(new Uint8Array(readFileSync(join(root, files.h264))), clipSeconds(state)); } catch { frames = null; }
    if (!frames) assets.push({ label: `The ${state} clip frames` }); else for (const bytes of frames) assets.push({ label: `The ${state} clip frames`, bytes });
  }
  return assets;
}

// ---------------------------------------------------------------- the one-time check of art that was live before art was checked

function sweepMarker(): string { return join(process.env.MAIPAI_DATA_DIR || dataDir, "companions", ".art-checked.json"); }
interface SweepRecord { at?: string; /** Companions held at a stricter audience until their art can be checked: id to the audience to restore. */ pending: Record<string, CompanionAudience>; done: boolean }
function readSweep(): SweepRecord { try { const parsed = JSON.parse(readFileSync(sweepMarker(), "utf8")) as Partial<SweepRecord>; return { pending: parsed.pending ?? {}, done: parsed.done === true, ...(parsed.at ? { at: parsed.at } : {}) }; } catch { return { pending: {}, done: false }; } }
function writeSweep(record: SweepRecord): void { mkdirSync(dirname(sweepMarker()), { recursive: true }); writeFileSync(sweepMarker(), JSON.stringify(record, null, 2)); }

export interface SweepOutcome { companionId: string; from: CompanionAudience; to: CompanionAudience | "draft" | "pending"; }
const ORDER: CompanionAudience[] = ["all", "teen", "adult"];

function narrow(id: string, to: CompanionAudience | "draft", hold = false): void {
  try {
    const result = to === "draft" ? setHouseholdCompanionStatus(id, "draft") : hold ? holdHouseholdCompanionAudience(id, to) : setHouseholdCompanionAudience(id, to);
    if (!result.ok) throw new Error(result.error);
  } finally { reloadPersonas(); }
}

/** Checks the art of every household companion shown to teens or children, once, against the audience it is shown to. Art that fails keeps the companion only for the stricter
 * audience it does pass (all ages, then teen, then adult-only); art that fails even adult-only makes the companion a draft. A companion whose art could not be looked at (no
 * vision model yet, a missing file) and has no clear failure is held one step stricter (all ages becomes teen, teen becomes adult-only) until the check can run, then restored.
 * Nothing is deleted. An admin's own change made while the checks ran is never overwritten. Returns what was decided this pass; `done` in the record is true when nothing is pending. */
export async function sweepLiveCompanionArt(): Promise<SweepOutcome[]> {
  const record = readSweep();
  if (record.done) return [];
  const outcomes: SweepOutcome[] = [];
  for (const id of listHouseholdCompanionIds()) {
    const companion = getHouseholdCompanion(id)?.companion;
    if (!companion) continue;
    const held = record.pending[id], current = companion.audience ?? "adult", from = held ?? current;
    if (from === "adult") continue;
    const assets = await collectLiveAssets(id);
    if (assets.length === 0) { delete record.pending[id]; continue; }
    let to: CompanionAudience | "draft" | "pending" | null = null;
    for (const audience of ORDER.slice(ORDER.indexOf(from))) {
      const result = await checkCompanionArt(id, null, assets, "video", audience);
      if (result.ok) { to = audience; break; }
      if (!result.definite && result.unavailable) { to = "pending"; break; }
    }
    const nowAudience = getHouseholdCompanion(id)?.companion?.audience ?? "adult";
    if (nowAudience !== current) continue; // an admin changed it while the checks ran: theirs stands, and the next pass looks again
    if (to === null) { narrow(id, "draft"); delete record.pending[id]; outcomes.push({ companionId: id, from, to: "draft" }); continue; }
    if (to === "pending") {
      const stricter = ORDER[Math.min(ORDER.indexOf(from) + 1, ORDER.length - 1)]!;
      if (!held && stricter !== current) narrow(id, stricter, true);
      record.pending[id] = from; outcomes.push({ companionId: id, from, to: "pending" }); continue;
    }
    if (to !== current) narrow(id, to, held !== undefined && to === held);
    delete record.pending[id]; outcomes.push({ companionId: id, from, to });
  }
  record.done = Object.keys(record.pending).length === 0;
  if (record.done) record.at = new Date().toISOString();
  writeSweep(record);
  return outcomes;
}

/** Runs the one-time check a minute after start and again with growing gaps (up to an hour) until every companion has been decided. The timer never keeps the process alive. */
export function startLiveArtSweep(delayMs = 60_000): void {
  const run = (wait: number) => {
    const timer = setTimeout(() => {
      sweepLiveCompanionArt().then(() => { if (!readSweep().done) run(Math.min(wait * 2, 3_600_000)); }).catch((error) => { console.warn(`[companions] live art check will retry: ${(error as Error).message}`); run(Math.min(wait * 2, 3_600_000)); });
    }, wait);
    timer.unref?.();
  };
  run(delayMs);
}
