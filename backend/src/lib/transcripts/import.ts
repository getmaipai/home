import type { PersonRow } from "@/types";
import { TranscriptError, createTranscript } from "./store";
import { parseTranscriptDocument } from "./parse";

export function importTranscript(
  actor: PersonRow,
  itemId: string,
  input: string,
  format: "srt" | "vtt" | "txt" | "text",
  language = "und",
) {
  try {
    const parsed = parseTranscriptDocument(input, format);
    return createTranscript(actor, {
      itemId,
      language: language === "und" ? parsed.language : language,
      segments: parsed.segments,
      provenance: { engine: "import", model_id: "none", source_kind: "imported" },
    });
  } catch (error) {
    if (error instanceof TranscriptError) throw error;
    if (error instanceof Error) throw new TranscriptError(error.message);
    throw error;
  }
}
