// Find and replace across a transcript: a literal match (never a regular expression), previewed before it is applied.
import type { PersonRow } from "@/types";
import { applyOps, type Op } from "./revisions";
import { getTranscript, TranscriptError, type Segment } from "./store";

export const MAX_PREVIEW_LINES = 500;
export const EMPTY_FIND = "Type the text to find, then try again.";

export type FindOptions = { find: string; replace: string; match_case?: boolean; whole_word?: boolean };
export type FindMatch = { segment_id: string; start: number; before: string; after: string; count: number };
export type FindPreview = { matches: FindMatch[]; total_lines: number; total_matches: number; more: boolean };

const WORD_CHARACTER = "[\\p{L}\\p{N}_]";

function patternFor(options: FindOptions): RegExp {
  if (options.find === "") throw new TranscriptError(EMPTY_FIND);
  const literal = options.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = options.whole_word ? `(?<!${WORD_CHARACTER})${literal}(?!${WORD_CHARACTER})` : literal;
  return new RegExp(body, options.match_case ? "gu" : "giu");
}

/** The lines that change, with their new text. The replacement is inserted as typed (no $1 style tricks). */
function changedLines(segments: readonly Segment[], options: FindOptions, only?: ReadonlySet<string>): FindMatch[] {
  const pattern = patternFor(options);
  const found: FindMatch[] = [];
  for (const segment of segments) {
    if (only && !only.has(segment.id)) continue;
    let count = 0;
    const after = segment.text.replace(pattern, () => {
      count += 1;
      return options.replace;
    });
    if (count > 0) found.push({ segment_id: segment.id, start: segment.start, before: segment.text, after, count });
  }
  return found;
}

export function previewFindReplace(actor: PersonRow, transcriptId: string, options: FindOptions): FindPreview {
  const lines = changedLines(getTranscript(actor, transcriptId).segments, options);
  const preview = {
    matches: lines.slice(0, MAX_PREVIEW_LINES),
    total_lines: lines.length,
    total_matches: lines.reduce((sum, line) => sum + line.count, 0),
    more: lines.length > MAX_PREVIEW_LINES,
  };
  console.info(JSON.stringify({ event: "transcript.find_preview", lines: preview.total_lines, matches: preview.total_matches }));
  return preview;
}

/** Applies every change as one revision made of edit_text ops, so line times never move. */
export function applyFindReplace(
  actor: PersonRow,
  transcriptId: string,
  options: FindOptions & { segment_ids?: string[] },
): { replaced_lines: number; replaced_matches: number } {
  const only = options.segment_ids ? new Set(options.segment_ids) : undefined;
  const lines = changedLines(getTranscript(actor, transcriptId).segments, options, only);
  if (lines.length === 0) return { replaced_lines: 0, replaced_matches: 0 };
  const ops: Op[] = lines.map((line) => ({ kind: "edit_text", segment_id: line.segment_id, text: line.after }));
  applyOps(actor, transcriptId, actor.id, ops, "find and replace");
  const replaced_matches = lines.reduce((sum, line) => sum + line.count, 0);
  console.info(JSON.stringify({ event: "transcript.find_replace", lines: lines.length, matches: replaced_matches }));
  return { replaced_lines: lines.length, replaced_matches };
}
