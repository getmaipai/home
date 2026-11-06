import { createHash } from "node:crypto";
import { getStackClient } from "@/lib/stackEngine";
import { readAttachment } from "@/lib/attachments";
import { readableItem } from "@/lib/media/access";
import { serveItemBytes } from "@/lib/media/serve";
import type { PersonRow } from "@/types";
import type { Segment } from "./store";

export type TranscriptJobResult = {
  segments: Segment[];
  language: string;
  speakers?: { id: string; label: string }[];
  vocabulary?: string[];
  engine?: string;
  model_id?: string;
};

export type TranscriptStackClient = {
  transcribeJob(input: {
    item_id: string;
    language?: string;
    vocabulary?: string[];
    source?: string;
    source_sha256?: string;
  }, signal?: AbortSignal): Promise<TranscriptJobResult>;
};

let scripted: TranscriptStackClient | null = null;

export function __setTranscriptStackClientForTests(client: TranscriptStackClient | null): void {
  scripted = client;
}

/** The audio or video bytes of a media item or of an uploaded or generated file the person can see. */
async function itemBytes(actor: PersonRow, itemId: string): Promise<Uint8Array> {
  const item = readableItem(actor, itemId);
  if (item) {
    const served = await serveItemBytes(actor, item, undefined);
    if (!(served instanceof Response)) throw new Error(served.error);
    if (!served.ok) throw new Error("The audio or video file could not be read.");
    return new Uint8Array(await served.arrayBuffer());
  }
  const file = readAttachment(actor, itemId);
  if (!file.ok) throw new Error("Library item not found");
  return file.value.bytes;
}

export async function transcribeJob(
  actor: PersonRow,
  input: { item_id: string; language?: string; vocabulary?: string[] },
  signal?: AbortSignal,
): Promise<TranscriptJobResult> {
  if (scripted) {
    return scripted.transcribeJob({ item_id: input.item_id, language: input.language, vocabulary: input.vocabulary }, signal);
  }
  const bytes = await itemBytes(actor, input.item_id);
  const source = Buffer.from(bytes).toString("base64");
  const source_sha256 = createHash("sha256").update(bytes).digest("hex");
  const client = getStackClient();
  if (!client.transcriptionJob) {
    throw new Error("The Stack does not support timed transcript jobs yet. Update Stack and try again.");
  }

  const response = await client.transcriptionJob({
    source,
    source_sha256,
    ...(input.language ? { language: input.language } : {}),
    ...(input.vocabulary ? { vocabulary: input.vocabulary } : {}),
  }, { signal });
  if (!response.data.data) {
    throw new Error("Transcription is still running. Check the job status and try again when it finishes.");
  }

  return {
    language: response.data.data.language,
    segments: response.data.data.segments.map((segment, index) => ({
      id: `segment-${index + 1}`,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      ...(segment.words?.length ? { words: segment.words } : {}),
    })),
    engine: response.identity.host,
    model_id: response.identity.model ?? "unknown",
  };
}
