import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import type { TranscriptRevision } from "@maipai/spec/gen/ts/transcript-revision.js";
import { ApiError, requestJson } from "@/lib/api";

export type TranscriptFormat = "srt" | "vtt" | "txt" | "md" | "json";
export type ImportFormat = "srt" | "vtt" | "txt";
export type TranscriptOp =
  | { kind: "replace_text"; segment_id: string; text: string }
  | { kind: "set_speaker"; segment_id: string; speaker: string }
  | { kind: "add_speaker"; speaker_id: string; label: string }
  | { kind: "rename_speaker"; speaker_id: string; label: string };

/** What detect-speakers answers: the transcript, whether detection worked, and the Stack's plain-words note when it did not. */
export type DetectSpeakersResult = {
  transcript: Transcript;
  diarization: "done" | "unavailable";
  note: string | null;
};

const JSON_HEADERS = { "content-type": "application/json" };

function post<T>(path: string, body?: unknown): Promise<T> {
  if (body === undefined) return requestJson<T>(path, { method: "POST" });
  return requestJson<T>(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

const transcriptPath = (id: string) => `/api/transcripts/${encodeURIComponent(id)}`;
const itemPath = (item: string) => `/api/library/${encodeURIComponent(item)}/transcript`;

export const transcriptApi = {
  start: (item: string) => post<Transcript>(itemPath(item), {}),
  /** The transcript this item already has, or null when it has none yet. */
  forItem: async (item: string): Promise<Transcript | null> => {
    try {
      const found = await requestJson<Transcript>(itemPath(item));
      // Anything that is not a transcript record (an empty or unexpected answer) means there is none to show.
      return Array.isArray(found?.segments) ? found : null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  get: (id: string) => requestJson<Transcript>(transcriptPath(id)),
  edit: (id: string, ops: readonly TranscriptOp[]) =>
    requestJson<Transcript>(transcriptPath(id), {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ops }),
    }),
  revisions: (id: string) => requestJson<TranscriptRevision[]>(`${transcriptPath(id)}/revisions`),
  undo: (id: string) => post<Transcript>(`${transcriptPath(id)}/undo`),
  restore: (id: string, revision: number) =>
    post<Transcript>(`${transcriptPath(id)}/restore`, { revision }),
  /** Label who is speaking on every line. An unavailable result leaves the transcript as it was. */
  detectSpeakers: (id: string, numSpeakers?: number) =>
    post<DetectSpeakersResult>(
      `${transcriptPath(id)}/detect-speakers`,
      numSpeakers === undefined ? undefined : { num_speakers: numSpeakers },
    ),
  /** Redo only the lines between start and end (seconds). */
  regenerateRange: (id: string, start: number, end: number) =>
    post<Transcript>(`${transcriptPath(id)}/regenerate-range`, { start, end }),
  import: (item: string, format: ImportFormat, text: string) =>
    post<Transcript>(`${itemPath(item)}/import`, { format, text }),
  exportUrl: (id: string, format: TranscriptFormat) => `${transcriptPath(id)}/export?format=${format}`,
};
