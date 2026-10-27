// Finished-item check for a companion's own art (look pictures, character sheet views, clip stills and clip frames), run when the art is made
// or uploaded and again at Publish and on an audience change. It is the standard check (pictures/finishedCheck.ts) held to the stricter of the
// companion's audience and the person who asked: an all-ages companion's art gets the child lane's cartoon question, a teen one the teen
// lane, an adult-only one withholds a possible minor in a nude or sexual picture. A check that cannot run withholds (adult-only, teen and child). Verdicts are kept per sha256 in the
// companion's states record, so a file is looked at once.
import type { PersonRow } from "@/types";
import { getHouseholdCompanion } from "@/lib/householdCompanions";
import { readStates, saveStates, takePath } from "@/lib/companionStates";
import { checkFinishedAssets, stricterLane, type FinishedAsset, type FinishedCheckResult } from "@/lib/pictures/finishedCheck";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import type { CheckedKind } from "@/lib/pictures/ageCheck";
import type { Lane } from "@/lib/pictures/lane";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "@/lib/paths";
import { householdCompanionFolder, listHouseholdCompanionIds, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
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

/** The art a companion shows today: its starting picture and each state's still and clip frames. */
export async function collectLiveAssets(companionId: string): Promise<FinishedAsset[]> {
  const root = join(householdCompanionFolder(companionId)!, "animation"), animation = getHouseholdCompanion(companionId)?.companion?.animation, assets: FinishedAsset[] = [];
  const add = (label: string, path: string) => { try { assets.push({ label, bytes: new Uint8Array(readFileSync(path)) }); } catch { assets.push({ label }); } };
  add("The starting picture", join(root, animation?.sheet?.rest ?? "rest.png"));
  for (const [state, files] of Object.entries(animation?.states ?? {})) {
    add(`The ${state} still`, join(root, files.still));
    let frames: Uint8Array[] | null = null;
    try { frames = await extractKeyframes(new Uint8Array(readFileSync(join(root, files.h264))), null); } catch { frames = null; }
    if (!frames) assets.push({ label: `The ${state} clip frames` }); else for (const bytes of frames) assets.push({ label: `The ${state} clip frames`, bytes });
  }
  return assets;
}

// ---------------------------------------------------------------- the one-time check of art that was live before art was checked

function sweepMarker(): string { return join(process.env.MAIPAI_DATA_DIR || dataDir, "companions", ".art-checked.json"); }
export interface SweepOutcome { companionId: string; from: CompanionAudience; to: CompanionAudience | "draft" | null; unavailable: boolean }

/** Checks every household companion's live art once against the audience it is shown to. Art that fails keeps the companion only for the stricter audience it does pass
 * (all ages, then teen, then adult-only); art that fails even adult-only makes the companion a draft. A companion whose art could not be checked is left alone and tried
 * again on the next boot (the marker is written only when every companion was decided). Nothing is deleted. */
export async function sweepLiveCompanionArt(): Promise<SweepOutcome[]> {
  if (existsSync(sweepMarker())) return [];
  const outcomes: SweepOutcome[] = [];
  for (const id of listHouseholdCompanionIds()) {
    const companion = getHouseholdCompanion(id)?.companion;
    if (!companion?.animation) continue;
    const from = companion.audience ?? "adult", assets = await collectLiveAssets(id);
    const order: CompanionAudience[] = ["all", "teen", "adult"], start = order.indexOf(from);
    let to: CompanionAudience | "draft" | null = null, unavailable = false;
    for (const audience of order.slice(start)) {
      const result = await checkCompanionArt(id, null, assets, "video", audience);
      if (result.ok) { to = audience; break; }
      if (result.unavailable) { unavailable = true; break; }
    }
    if (unavailable) { outcomes.push({ companionId: id, from, to: null, unavailable }); continue; }
    if (to === null) { setHouseholdCompanionStatus(id, "draft"); to = "draft"; }
    else if (to !== from) setHouseholdCompanionAudience(id, to);
    outcomes.push({ companionId: id, from, to, unavailable: false });
  }
  reloadPersonas();
  if (!outcomes.some((outcome) => outcome.unavailable)) { mkdirSync(dirname(sweepMarker()), { recursive: true }); writeFileSync(sweepMarker(), JSON.stringify({ at: new Date().toISOString(), outcomes }, null, 2)); }
  return outcomes;
}
