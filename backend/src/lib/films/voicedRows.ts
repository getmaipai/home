// VOICED-ROUGH-CUT-HOME-01: the rows of the Film maker page's storyboard_player for the newest voiced preview of the viewer's own film. The same row shape as the
// silent storyboard (`storyboardRows`); the Stack-known parts (shot lengths, each line's start, its own audio and wave) come from the result Home kept, Home's
// own words and pictures beside them. Adults only; empty when there is no preview.
import { roughCutShotRows } from "@maipai/spec/stack/ts/stack-rough-cut.js";
import type { PersonRow } from "@/types";
import { storyboardRows } from "./storyboardRows";
import { pageFilmRun } from "./pageFilm";
import { allowed } from "./background";
import { latestVoicedPreview } from "./roughCut";

export function voicedStoryboardRows(person: PersonRow, id?: string): ReturnType<typeof storyboardRows> {
  if (!allowed(person)) return [];
  const run = pageFilmRun(person, id);
  if (!run?.production_id) return [];
  const kept = latestVoicedPreview(person, run.production_id);
  if (!kept) return [];
  const base = storyboardRows(person, id);
  const captions: Record<string, string> = {}, stills: Record<string, string> = {}, lineTexts: Record<string, string> = {};
  for (const row of base) { captions[row.shot_id] = row.caption; if (row.still) stills[row.shot_id] = row.still; if (row.line_text) lineTexts[row.shot_id] = row.line_text; }
  return roughCutShotRows(kept.result as never, { captions, stills, lineTexts });
}
