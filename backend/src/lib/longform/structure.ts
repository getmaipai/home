// LONGFORM-01: the structure of a long-form production, set by code from the length (design: docs/design/long-form-productions-2026-11-09.md).
// No length is special. A scene is about two minutes (60 to 180 s), a shot is about five seconds, a run holds at most twelve shots (the film plan's
// limit), and a production of three or more scenes has three acts. The model fills content into these slots; it never chooses the numbers.

export const SCENE_TARGET_SECONDS = 120;
export const SCENE_MIN_SECONDS = 60;
export const SCENE_MAX_SECONDS = 180;
export const AVG_SHOT_SECONDS = 5;
export const MAX_SHOTS_PER_RUN = 12;
export const MIN_PRODUCTION_SECONDS = 20;
export const MAX_PRODUCTION_SECONDS = 4 * 60 * 60;

import { filmOverhead } from "@/lib/videos/editPlan";

export interface ScenePlan { key: string; act: number; seconds: number; shots: number; runs: number[] }
export interface StructurePlan { seconds: number; acts: number; scenes: ScenePlan[]; totalShots: number; totalRuns: number }
export type StructureResult = { ok: true; plan: StructurePlan } | { ok: false; line: string };

/** How many scenes a length gets: about one per two minutes, never fewer than one, and never a scene under the minimum or over the maximum length. */
export function sceneCountFor(seconds: number): number {
  const byTarget = Math.round(seconds / SCENE_TARGET_SECONDS);
  const most = Math.max(1, Math.floor(seconds / SCENE_MIN_SECONDS));
  const fewest = Math.max(1, Math.ceil(seconds / SCENE_MAX_SECONDS));
  return Math.min(most, Math.max(fewest, byTarget, 1));
}

/** The act of each scene: one act for one or two scenes, otherwise three acts in the proportion 1 : 2 : 1. */
export function actsFor(sceneCount: number): number[] {
  if (sceneCount < 3) return Array.from({ length: sceneCount }, () => 1);
  const firstEnd = Math.max(1, Math.round(sceneCount * 0.25));
  const lastStart = sceneCount - Math.max(1, Math.round(sceneCount * 0.25));
  return Array.from({ length: sceneCount }, (_, i) => (i < firstEnd ? 1 : i >= lastStart ? 3 : 2));
}

/** Split n shots into the fewest runs of at most MAX_SHOTS_PER_RUN, as even as possible. */
export function runsFor(shots: number): number[] {
  const runs = Math.max(1, Math.ceil(shots / MAX_SHOTS_PER_RUN));
  const base = Math.floor(shots / runs), extra = shots % runs;
  return Array.from({ length: runs }, (_, i) => base + (i < extra ? 1 : 0));
}

export function planStructure(seconds: number): StructureResult {
  if (!Number.isFinite(seconds) || seconds < MIN_PRODUCTION_SECONDS) return { ok: false, line: `A production is at least ${MIN_PRODUCTION_SECONDS} seconds. For something shorter, ask for a film or a single clip.` };
  if (seconds > MAX_PRODUCTION_SECONDS) return { ok: false, line: `A production is at most ${MAX_PRODUCTION_SECONDS / 3600} hours. Ask for a shorter length, or make it in parts.` };
  // LENGTH-01: the title card and the credits are part of the ask, so the scenes hold the rest (they are on the first and last run only).
  const total = Math.round(seconds), content = Math.max(1, total - filmOverhead(true, true));
  const count = sceneCountFor(total);
  const acts = actsFor(count);
  const base = Math.floor(content / count), extra = content % count;
  const scenes: ScenePlan[] = acts.map((act, i) => {
    const sceneSeconds = base + (i < extra ? 1 : 0);
    const shots = Math.max(1, Math.round(sceneSeconds / AVG_SHOT_SECONDS));
    return { key: `scene-${i + 1}`, act, seconds: sceneSeconds, shots, runs: runsFor(shots) };
  });
  return { ok: true, plan: { seconds: total, acts: Math.max(...acts), scenes, totalShots: scenes.reduce((n, s) => n + s.shots, 0), totalRuns: scenes.reduce((n, s) => n + s.runs.length, 0) } };
}

/** Minutes to render, from this home's measured minutes per shot (null while there is no estimate yet) and the dailies' retake rate (0 to 1). */
export function estimateMinutes(plan: StructurePlan, minutesPerShot: number | null, retakeRate = 0.15): number | null {
  if (minutesPerShot === null) return null;
  return Math.round(plan.totalShots * minutesPerShot * (1 + Math.min(Math.max(retakeRate, 0), 1)));
}
