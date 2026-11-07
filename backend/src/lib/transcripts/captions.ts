// Caption tracks made from a transcript, and the check that says a track is older than the transcript it came from.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { captionTracks } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";
import { buildCues, type Cue } from "./cues";
import { addCaptionTrack, getTranscript, getTranscriptDatabaseRow, TranscriptError, type Segment } from "./store";

export type CaptionTrackSummary = {
  id: string;
  language: string;
  based_on_revision: number;
  needs_refreshing: boolean;
  cue_count: number;
  translated: boolean;
};

type TrackRow = typeof captionTracks.$inferSelect;

function summarize(row: TrackRow, currentRevision: number): CaptionTrackSummary {
  return {
    id: row.id,
    language: row.language,
    based_on_revision: row.basedOnRevision,
    needs_refreshing: row.basedOnRevision < currentRevision,
    cue_count: (JSON.parse(row.cues) as unknown[]).length,
    translated: (JSON.parse(row.provenance) as { source_kind?: string }).source_kind === "translated",
  };
}

function trackRow(actor: PersonRow, transcriptId: string, trackId: string): TrackRow {
  getTranscriptDatabaseRow(actor, transcriptId);
  const row = db.select().from(captionTracks).where(eq(captionTracks.id, trackId)).get();
  if (!row || row.transcriptId !== transcriptId) {
    throw new TranscriptError("That caption track was not found. Reload the transcript and try again.", 404);
  }
  return row;
}

export function listCaptionTracks(actor: PersonRow, transcriptId: string): CaptionTrackSummary[] {
  const transcript = getTranscriptDatabaseRow(actor, transcriptId);
  return db.select().from(captionTracks).where(eq(captionTracks.transcriptId, transcriptId)).all()
    .map((row) => summarize(row, transcript.currentRevision));
}

/** A new track from the transcript as it is now, in the transcript's language. */
export function createCaptionTrack(actor: PersonRow, transcriptId: string): CaptionTrackSummary {
  const transcript = getTranscriptDatabaseRow(actor, transcriptId);
  const segments = JSON.parse(transcript.segments) as Segment[];
  const row = addCaptionTrack(actor, transcriptId, {
    language: transcript.language,
    basedOnRevision: transcript.currentRevision,
    cues: buildCues(segments),
    provenance: { source_kind: "generated", engine: "home" },
  });
  return summarize(row, transcript.currentRevision);
}

/**
 * Cues for the current transcript. A line whose cues were hand edited (text_overridden) keeps those cues exactly,
 * so a refresh never throws away a caption someone fixed by hand.
 */
export function refreshedCues(segments: readonly Segment[], oldCues: readonly Cue[]): Cue[] {
  const liveSegments = new Set(segments.map((segment) => segment.id));
  const keptBySegment = new Map<string, Cue[]>();
  for (const cue of oldCues) {
    if (!cue.text_overridden || !liveSegments.has(cue.segment_id)) continue;
    keptBySegment.set(cue.segment_id, [...(keptBySegment.get(cue.segment_id) ?? []), cue]);
  }
  const rebuilt = buildCues(segments.filter((segment) => !keptBySegment.has(segment.id)));
  const kept = [...keptBySegment.values()].flat();
  return [...rebuilt, ...kept].sort((a, b) => a.start - b.start);
}

export function refreshCaptionTrack(actor: PersonRow, transcriptId: string, trackId: string): CaptionTrackSummary {
  const row = trackRow(actor, transcriptId, trackId);
  if ((JSON.parse(row.provenance) as { source_kind?: string }).source_kind === "translated") {
    throw new TranscriptError("This track is a translation. Refresh the original track, then translate it again.", 409);
  }
  const transcript = getTranscript(actor, transcriptId);
  const cues = refreshedCues(transcript.segments, JSON.parse(row.cues) as Cue[]);
  const updated = {
    cues: JSON.stringify(cues),
    basedOnRevision: transcript.current_revision,
    hlc: nextHlc(),
  };
  db.update(captionTracks).set(updated).where(eq(captionTracks.id, trackId)).run();
  console.info(JSON.stringify({ event: "transcript.captions_refreshed", cues: cues.length }));
  return summarize({ ...row, ...updated }, transcript.current_revision);
}

/** The stored cues of one track, so a translated or hand-fixed track exports as it is. */
export function captionTrackCues(actor: PersonRow, transcriptId: string, trackId: string): Cue[] {
  return JSON.parse(trackRow(actor, transcriptId, trackId).cues) as Cue[];
}
