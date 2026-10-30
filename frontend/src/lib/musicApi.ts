// MUSIC-GEN-04: the song card's calls to Home (`/api/music`). Data only; nothing here draws. The routes belong to
// backend/src/routes/music.ts: the card, Stop, Use this version and the file URLs. There is no Make another or Try
// again route yet, so the card offers neither.
import { ApiError } from "@/lib/api";

export interface MusicVersion { id: string; label: string; url: string }
export interface MusicCard {
  id: string;
  task: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string | null;
  /** The plain stage label for the current short stage, or the shared busy line while queued. */
  stage_label: string;
  stages: Array<{ id: string; label: string }>;
  stage_index: number;
  /** 0 to 1. */
  progress: number;
  eta_seconds: number | null;
  position: number | null;
  error_line: string | null;
  cover_url: string | null;
  cover_versions: { id: string; url: string }[];
  cover_pending: boolean;
  /** Oldest first. Each url is the owner's own audio, with Range support. */
  versions: MusicVersion[];
  current_id: string | null;
  /** The kind of the version on show: quick (the hook) or full (every part). */
  length: "quick" | "full";
  cut: "asked" | "ceiling" | null;
  max_seconds: number | null;
  title: string | null;
  description: string | null;
  /** The owner's own words; null when there are none. */
  lyrics: string | null;
  timed_lyrics: { t: number; line: string; section: string | null }[] | null;
  duration_s: number | null;
  /** ISO time the song was asked for. */
  started_at: number;
}
export interface MusicStatus { can_make: boolean; engine_ready: boolean; limits: { min_seconds: number; max_seconds: number } | null }

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.code);
  return body as T;
}

export const musicApi = {
  status: () => send<MusicStatus>("/api/music/status"),
  card: (id: string, signal?: AbortSignal) => send<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {}),
  stop: (id: string) => send<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Makes an older version the one the next edit starts from. The newer versions stay. */
  /** Make it full / Make it quick: the same song made again at the other length, as a new version on this card. */
  setLength: (id: string, length: "quick" | "full", fileId?: string) => send<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/length`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ length, ...(fileId ? { file_id: fileId } : {}) }) }),
  revise: (id: string, change: string, fileId?: string) => send<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/revise`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ change, ...(fileId ? { file_id: fileId } : {}) }) }),
  stems: (id: string, fileId?: string) => send<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/stems`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fileId ? { file_id: fileId } : {}) }),
  newCover: (id: string, prompt: string) => send<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/cover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) }),
  useVersion: (id: string, fileId: string) => send<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/use`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: fileId }) }),
  /** A personal download of one version (never the commercial purpose). */
  fileUrl: (fileId: string) => `/api/music/files/${encodeURIComponent(fileId)}`,
};
