import { eq } from "drizzle-orm";
import { db } from "@/db";
import { captionTracks, transcriptRevisions, transcripts } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newCaptionTrackId, newTranscriptId, newTranscriptRevisionId } from "@/lib/id";
import { getAttachment } from "@/lib/attachments";
import { readableItem } from "@/lib/media/access";
import { mediaBandOf } from "@/lib/media/band";
import type { PersonRow } from "@/types";
import { Transcript } from "@maipai/spec/gen/ts/transcript.js";

export class TranscriptError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type Segment = Transcript["segments"][number];
export type Speaker = Transcript["speakers"][number];
export type Provenance = Transcript["provenance"];
export const CHILD_TRANSCRIPT_ERROR = "Transcripts are available to teens and adults.";

function gate(actor: PersonRow, itemId: string): void {
  if (mediaBandOf(actor) === "child") throw new TranscriptError(CHILD_TRANSCRIPT_ERROR, 403);
  if (!canSeeItem(actor, itemId)) {
    throw new TranscriptError("That Library item is not available to you.", 404);
  }
}

/** A Library item is either a media item (music, podcast) or an uploaded or generated file; each keeps its own visibility rule. */
export function canSeeItem(actor: PersonRow, itemId: string): boolean {
  if (readableItem(actor, itemId)) return true;
  return getAttachment(actor, itemId).ok;
}

function asRecord(row: typeof transcripts.$inferSelect): Transcript {
  const stamp = new Date(Number(row.hlc.split(":", 1)[0])).toISOString();
  return Transcript.parse({
    id: row.id,
    source: row.libraryItemId,
    language: row.language,
    current_revision: row.currentRevision,
    segments: JSON.parse(row.segments),
    speakers: JSON.parse(row.speakers),
    vocabulary: JSON.parse(row.vocabulary),
    provenance: JSON.parse(row.provenance),
    clock: { created_at: stamp, updated_at: stamp, hlc: row.hlc },
    hlc: row.hlc,
  });
}

export function getTranscript(actor: PersonRow, id: string): Transcript {
  const row = db.select().from(transcripts).where(eq(transcripts.id, id)).get();
  if (!row) throw new TranscriptError("That transcript is not available to you.", 404);
  gate(actor, row.libraryItemId);
  return asRecord(row);
}

export function transcriptRowForItem(actor: PersonRow, itemId: string): Transcript | null {
  gate(actor, itemId);
  const row = db.select().from(transcripts).where(eq(transcripts.libraryItemId, itemId)).get();
  return row ? asRecord(row) : null;
}

export function listTranscriptsForItem(actor: PersonRow, itemId: string): Transcript[] {
  const record = transcriptRowForItem(actor, itemId);
  return record ? [record] : [];
}

export function getTranscriptDatabaseRow(actor: PersonRow, id: string) {
  const row = db.select().from(transcripts).where(eq(transcripts.id, id)).get();
  if (!row) throw new TranscriptError("That transcript is not available to you.", 404);
  gate(actor, row.libraryItemId);
  return row;
}

export function createTranscript(
  actor: PersonRow,
  input: {
    itemId: string;
    language: string;
    segments: Segment[];
    speakers?: Transcript["speakers"];
    vocabulary?: string[];
    provenance: Provenance;
    author?: string;
  },
): Transcript {
  gate(actor, input.itemId);

  const stamp = nextHlc();
  const id = newTranscriptId();
  const row = {
    id,
    libraryItemId: input.itemId,
    ownerId: actor.id,
    language: input.language,
    currentRevision: 1,
    segments: JSON.stringify(input.segments),
    speakers: JSON.stringify(input.speakers ?? []),
    vocabulary: JSON.stringify(input.vocabulary ?? []),
    provenance: JSON.stringify(input.provenance),
    hlc: stamp,
  };

  db.transaction(() => {
    db.insert(transcripts).values(row).run();
    db.insert(transcriptRevisions).values({
      id: newTranscriptRevisionId(),
      transcriptId: id,
      n: 1,
      author: input.author ?? actor.id,
      reason: input.provenance.source_kind === "generated" ? "transcription" : "import",
      ops: JSON.stringify([{
        kind: "replace_range",
        start: 0,
        end: Number.MAX_SAFE_INTEGER,
        segments: input.segments,
        speakers: input.speakers ?? [],
      }]),
      provenance: JSON.stringify(input.provenance),
      hlc: stamp,
    }).run();
  });
  return asRecord(row as typeof transcripts.$inferSelect);
}

export function addCaptionTrack(
  actor: PersonRow,
  transcriptId: string,
  value: {
    language: string;
    basedOnRevision: number;
    cues: unknown[];
    style?: Record<string, unknown>;
    provenance: { source_kind: "generated" | "imported" | "translated"; engine: string };
  },
) {
  getTranscriptDatabaseRow(actor, transcriptId);
  const stamp = nextHlc();
  const row = {
    id: newCaptionTrackId(),
    transcriptId,
    language: value.language,
    basedOnRevision: value.basedOnRevision,
    cues: JSON.stringify(value.cues),
    style: JSON.stringify(value.style ?? {}),
    provenance: JSON.stringify(value.provenance),
    hlc: stamp,
  };
  db.insert(captionTracks).values(row).run();
  return row;
}

export function revisionsForTranscript(actor: PersonRow, id: string) {
  getTranscriptDatabaseRow(actor, id);
  return db.select().from(transcriptRevisions).where(eq(transcriptRevisions.transcriptId, id))
    .all().sort((a, b) => a.n - b.n)
    .map((row) => ({ ...row, ops: JSON.parse(row.ops), provenance: JSON.parse(row.provenance) }));
}
