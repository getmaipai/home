// VIDEOS-PARITY: chapters for a clip made at home by joining others (a join, a beat cut or a film). The cuts are the lengths of the clips it was made from, in
// order, so each source clip is one chapter. A clip with no such history has no chapters. Never reads anything outside the person's own jobs.
import type { PersonRow } from "@/types";
import { getVideoJobByFileFor, getVideoJobFor } from "./jobs";

export interface ClipChapter { start_s: number; title: string }

const TITLE_MAX = 48;
function chapterTitle(prompt: string, index: number): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  if (!flat) return `Scene ${index + 1}`;
  return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/** The chapters of a Library clip the person made by joining clips, or []. Skipped when a source is missing or the sources do not add up to the clip's length
 * (a crossfade or a trim moved the cuts), so a chapter never points at the wrong moment. */
export function chaptersForMadeClip(person: PersonRow, fileId: string): ClipChapter[] {
  const job = getVideoJobByFileFor(person, fileId);
  const edit = job?.request.edit;
  if (!job || !edit || ((edit.change as string) !== "join" && (edit.change as string) !== "film") || !edit.with?.length) return [];
  const sources = [edit.from, ...edit.with].map((id) => getVideoJobFor(person, id));
  if (sources.some((source) => !source || source.files[0]?.seconds == null)) return [];
  const lengths = sources.map((source) => source!.files[0]!.seconds as number);
  const total = lengths.reduce((sum, seconds) => sum + seconds, 0);
  const made = job.files[0]?.seconds;
  if (made == null || Math.abs(total - made) > 1.5) return [];
  let start = 0;
  return sources.map((source, index) => {
    const chapter = { start_s: Math.round(start * 10) / 10, title: chapterTitle(source!.prompt, index) };
    start += lengths[index]!;
    return chapter;
  });
}
