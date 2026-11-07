// CAPTION-01g: detect speakers on an existing transcript, and redo one time range with the Stack.
// Both land as ONE revision through applyOps, so Undo and Restore work and corrections elsewhere stay.
import { getTranscriptDatabaseRow, TranscriptError, type Segment, type Speaker } from "./store";
import { applyOps } from "./revisions";
import { transcribeJob } from "./stack";
import type { PersonRow } from "@/types";

const WHOLE_FILE_END = Number.MAX_SAFE_INTEGER;

export const NO_SPEECH_IN_RANGE = "No speech was found in that range, so the lines there were left as they were. Pick a range with talking and try again.";
export const RANGE_PAST_END = "That range starts after the end of the transcript. Pick a start time inside the transcript and try again.";
export const RANGE_ORDER = "The end time must be after the start time. Check both times and try again.";

/** Seconds of overlap between two time spans (0 when they only touch or are apart). */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * For each target line, the speaker of the reference line that overlaps it most in time.
 * A target with no overlapping reference speaker maps to undefined, so the caller keeps what it had.
 */
export function speakerByOverlap(
  targets: ReadonlyArray<Pick<Segment, "start" | "end">>,
  references: ReadonlyArray<Pick<Segment, "start" | "end" | "speaker">>,
): Array<string | undefined> {
  return targets.map((target) => {
    let best: string | undefined;
    let bestOverlap = 0;
    for (const reference of references) {
      if (!reference.speaker) continue;
      const shared = overlap(target.start, target.end, reference.start, reference.end);
      if (shared > bestOverlap) {
        bestOverlap = shared;
        best = reference.speaker;
      }
    }
    return best;
  });
}

/** The speaker list after detection: the Stack's list, keeping any name the person already gave a speaker with the same id. */
function mergeSpeakers(existing: Speaker[], detected: Speaker[]): Speaker[] {
  const known = new Map(existing.map((speaker) => [speaker.id, speaker]));
  const merged = detected.map((speaker) => known.get(speaker.id) ?? speaker);
  const kept = existing.filter((speaker) => !detected.some((entry) => entry.id === speaker.id));
  return [...merged, ...kept];
}

export type DetectSpeakersResult = {
  diarization: "done" | "unavailable";
  note: string | null;
};

const rowSegments = (raw: string) => JSON.parse(raw) as Segment[];
const rowSpeakers = (raw: string) => JSON.parse(raw) as Speaker[];

export async function detectSpeakers(
  actor: PersonRow,
  transcriptId: string,
  input: { num_speakers?: number },
  signal?: AbortSignal,
): Promise<DetectSpeakersResult> {
  const before = getTranscriptDatabaseRow(actor, transcriptId);
  const result = await transcribeJob(actor, {
    item_id: before.libraryItemId,
    ...(before.language !== "und" ? { language: before.language } : {}),
    diarize: true,
    ...(input.num_speakers ? { num_speakers: input.num_speakers } : {}),
  }, signal);

  const detected = result.speakers ?? [];
  if (result.diarization !== "done" || detected.length === 0) {
    return {
      diarization: "unavailable",
      note: result.diarization_note ?? "Speaker detection is not available right now. Check that the local Stack is ready, then try again.",
    };
  }

  // Read again: the person may have edited while the Stack worked, and their text must win.
  const row = getTranscriptDatabaseRow(actor, transcriptId);
  const segments = rowSegments(row.segments);
  const assigned = speakerByOverlap(segments, result.segments);
  const next = segments.map((segment, index) => {
    const speaker = assigned[index];
    return speaker ? { ...segment, speaker } : segment;
  });
  applyOps(actor, transcriptId, actor.id, [{
    kind: "replace_range",
    start: 0,
    end: WHOLE_FILE_END,
    segments: next,
    speakers: mergeSpeakers(rowSpeakers(row.speakers), detected),
  }], "detect speakers");
  console.info(JSON.stringify({ event: "transcript.speakers_detected", segments: next.length, speakers: detected.length }));
  return { diarization: "done", note: null };
}

export async function regenerateRange(
  actor: PersonRow,
  transcriptId: string,
  input: { start: number; end: number; language?: string },
  signal?: AbortSignal,
): Promise<void> {
  if (!(input.end > input.start)) throw new TranscriptError(RANGE_ORDER);
  const before = getTranscriptDatabaseRow(actor, transcriptId);
  const lastEnd = rowSegments(before.segments).reduce((latest, segment) => Math.max(latest, segment.end), 0);
  if (input.start >= lastEnd) throw new TranscriptError(RANGE_PAST_END);

  const language = input.language ?? (before.language !== "und" ? before.language : undefined);
  const result = await transcribeJob(actor, {
    item_id: before.libraryItemId,
    ...(language ? { language } : {}),
    from_s: input.start,
    to_s: input.end,
  }, signal);

  // Keep only what falls inside the range, clamped, on the original timeline.
  const fresh = result.segments
    .map((segment) => ({ ...segment, start: Math.max(segment.start, input.start), end: Math.min(segment.end, input.end) }))
    .filter((segment) => segment.end > segment.start && segment.text.trim() !== "");
  if (fresh.length === 0) throw new TranscriptError(NO_SPEECH_IN_RANGE, 409);

  const row = getTranscriptDatabaseRow(actor, transcriptId);
  const replaced = rowSegments(row.segments).filter((segment) => segment.end > input.start && segment.start < input.end);
  const inherited = speakerByOverlap(fresh, replaced);
  const revision = row.currentRevision + 1;
  const segments = fresh.map((segment, index): Segment => {
    const { speaker: _ignored, ...rest } = segment;
    return { ...rest, id: `range-${revision}-${index + 1}`, ...(inherited[index] ? { speaker: inherited[index] } : {}) };
  });
  applyOps(actor, transcriptId, actor.id, [{ kind: "replace_range", start: input.start, end: input.end, segments }], "regenerate range");
  console.info(JSON.stringify({ event: "transcript.range_regenerated", replaced: replaced.length, segments: segments.length }));
}
