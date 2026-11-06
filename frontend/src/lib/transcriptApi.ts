import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import type { TranscriptRevision } from "@maipai/spec/gen/ts/transcript-revision.js";
import { ApiError, requestJson } from "@/lib/api";

export type TranscriptFormat = "srt" | "vtt" | "txt" | "md" | "json";
export type ImportFormat = "srt" | "vtt" | "txt";
export type TranscriptOp = { kind: "replace_text"; segment_id: string; text: string };

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
      return await requestJson<Transcript>(itemPath(item));
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
  import: (item: string, format: ImportFormat, text: string) =>
    post<Transcript>(`${itemPath(item)}/import`, { format, text }),
  exportUrl: (id: string, format: TranscriptFormat) => `${transcriptPath(id)}/export?format=${format}`,
};
