// FILM-LINES-01: the ONE reader of what a film shot says. A shot has `line` (one line, spoken by the film's speaker) or `lines` (an exchange: at most 3, each with its speaker),
// never both. Every consumer (the clip request, the finished-film check, the rough cut, the storyboard rows, the repair) reads a shot's dialogue through `shotLines`;
// a test fails on any direct `shot.line` read outside this file and the plan's own schema (tests/filmLinesReader.test.ts).
import type { FilmPlan, FilmShotLine } from "./plan";
import { speakerOfPlan } from "./speaker";

export type ShotLike = { line?: string | undefined; lines?: ReadonlyArray<FilmShotLine> | undefined };

/** The lines of a shot in the order they are spoken: `lines` when present, else `line` as one line by the film's speaker, else none. Blank text is no line. */
export function shotLines(plan: Pick<FilmPlan, "cast">, shot: ShotLike): FilmShotLine[] {
  if (shot.lines?.length) return shot.lines.map((entry) => ({ speaker: entry.speaker, text: entry.text.trim() })).filter((entry) => entry.text !== "");
  const text = shot.line?.trim();
  return text ? [{ speaker: speakerOfPlan(plan).name, text }] : [];
}

/** What the shot says as one passage (the lines' words in order): the passage the finished-film check expects to hear in the shot, and the words a silent cut shows. */
export function shotText(plan: Pick<FilmPlan, "cast">, shot: ShotLike): string {
  return shotLines(plan, shot).map((entry) => entry.text).join(" ");
}
