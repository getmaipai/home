import type { PersonRow } from "@/types";
import type { Creation } from "@/lib/creations/store";
import { getAttachment } from "@/lib/attachments";
import { mediaBandOf } from "@/lib/media/band";
import { addCaptionTrack, createTranscript } from "./store";
import { transcribeJob } from "./stack";
import { matchScript, quotedLines, scriptCaptionCues, type HeardWord } from "./scriptMatch";

/** Best effort captioning for a stored generated clip. The file access check also applies adult locks. */
export async function captionMadeClip(input: { actor: PersonRow; creation: Creation; clipFilePath: string }): Promise<string | null> {
  try {
    const { actor, creation } = input;
    const fileId = creation.file_ids[0];
    if (!fileId || mediaBandOf(actor) === "child" || !creation.words?.written) return null;
    const scripts = quotedLines(creation.words.written);
    if (!scripts.length) return null;
    if (!getAttachment(actor, fileId).ok) return null;
    const result = await transcribeJob(actor, { item_id: fileId });
    const heard: HeardWord[] = result.segments.flatMap((segment) => segment.words?.map((word) => ({ text: word.text, start_s: word.start, end_s: word.end })) ?? segment.text.trim().split(/\s+/).filter(Boolean).map((text, index, all) => ({
      text,
      start_s: segment.start + (segment.end - segment.start) * index / all.length,
      end_s: segment.start + (segment.end - segment.start) * (index + 1) / all.length,
    })));
    const matched = matchScript(scripts.join(" "), heard);
    if (!matched.length) return null;
    const transcript = createTranscript(actor, {
      itemId: fileId,
      language: result.language || "en",
      segments: result.segments,
      speakers: result.speakers,
      provenance: { engine: result.engine ?? "stack", model_id: result.model_id ?? "unknown", source_kind: "generated" },
    });
    const track = addCaptionTrack(actor, transcript.id, {
      language: transcript.language,
      basedOnRevision: transcript.current_revision,
      cues: scriptCaptionCues(matched),
      provenance: { source_kind: "generated", engine: result.engine ?? "stack" },
    });
    return track.id;
  } catch {
    return null;
  }
}
