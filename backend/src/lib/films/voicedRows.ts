// VOICED-ROUGH-CUT-HOME-01: what the Film maker page reads for the voiced preview: the storyboard rows of the newest fresh voiced preview, the one-row offer, and the one
// check that decides whether the offer is made. The row shape of `voicedRows` is the silent storyboard's (`storyboardRows`), so the page binds one storyboard. Adults only.
import { roughCutShotRows } from "@maipai/spec/stack/ts/stack-rough-cut.js";
import type { PersonRow } from "@/types";
import { storyboardRows } from "./storyboardRows";
import { pageFilmRun } from "./pageFilm";
import { allowed } from "./background";
import { latestVoicedPreview, roughCutAvailableNow } from "./roughCut";

/** The rows of the newest voiced preview that still matches the film's plan, else []. */
export function voicedRows(person: PersonRow, id?: string): ReturnType<typeof storyboardRows> {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run?.production_id || !run.plan) return [];
  const kept = latestVoicedPreview(person, run.production_id, run.plan);
  if (!kept) return [];
  const base = storyboardRows(person, id);
  const captions: Record<string, string> = {}, stills: Record<string, string> = {}, lineTexts: Record<string, string> = {};
  for (const row of base) { captions[row.shot_id] = row.caption; if (row.still) stills[row.shot_id] = row.still; if (row.line_text) lineTexts[row.shot_id] = row.line_text; }
  return roughCutShotRows(kept.result as never, { captions, stills, lineTexts });
}
export const voicedStoryboardRows = voicedRows;

/** True when this person may be offered the voiced preview: an adult, and the Stack lists `media.rough_cut`. Fails closed (false) while that is unknown. */
import { shotText } from "./lines";

export function voicedAvailable(person: PersonRow): boolean { return allowed(person) && roughCutAvailableNow(); }

export const VOICED_OFFER_LINE = "Hear the lines in the voices of your cast.";
export const VOICED_BLOCKED_LINE = "Hearing the voices needs the speech engine, which is not ready yet.";
export type VoicedOfferRow = { run_id: string; available: boolean; reason: string };

/** `film-voiced`: one row `{ run_id, available, reason }` for a waiting film whose plan has a line to speak, an adult's only. `available: true` means the preview can be made now and `reason` is the
 * offer's own line; `available: false` means it cannot be made now and `reason` says why in plain words, so the person learns that voices exist. No row: not an adult, no waiting film, or nothing to speak. */
export function voicedOfferRows(person: PersonRow, id?: string): VoicedOfferRow[] {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run?.plan || run.state !== "waiting_for_go" || !run.production_id) return [];
  if (!run.plan.shots.some((shot) => (shot as { kept?: boolean }).kept !== false && shotText(run.plan!, shot))) return [];
  return voicedAvailable(person) ? [{ run_id: run.id, available: true, reason: VOICED_OFFER_LINE }] : [{ run_id: run.id, available: false, reason: VOICED_BLOCKED_LINE }];
}
