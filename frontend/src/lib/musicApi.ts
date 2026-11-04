// MUSIC-GEN-04: the song card's calls to Home (`/api/music`). Data only; nothing here draws. The routes belong to
// backend/src/routes/music.ts: the card, Stop, Use this version and the file URLs. There is no Make another or Try
// again route yet, so the card offers neither.
import { requestJson } from "@/lib/api";

export interface MusicVersion { id: string; label: string; url: string }
export interface MusicCard {
  /** The chat the card lives in; null for a temporary one. */ conversation_id?: string | null; /** A split of an audio file the person owns, not a song made here. */ made_from_file?: boolean;
  id: string;
  task: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  /** TIER-PRIO-07: set while the card asks whether to make it now with the level it can run at and this person may answer; null otherwise. */
  fit_ask?: { job_id: string; picked?: string | null; actual?: string | null } | null;
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
  /** A remix, extension or new length still being made on this song; null when none is. */
  making_version?: { stage_label: string; progress: number; eta_seconds: number | null; position: number | null } | null;
  cover_pending: boolean;
  /** Oldest first. Each url is the owner's own audio, with Range support. */
  versions: MusicVersion[];
  current_id: string | null;
  /** The kind of the version on show: quick (the hook) or full (every part). */
  length: "quick" | "full";
  /** The maker the shown version really used: quick is Standard, detailed is Boost, max is Max. A Max song made without the Max models says detailed. */
  quality: "quick" | "detailed" | "max";
  /** Whether this person may make the song again at Boost here. */
  boost_offered: boolean;
  /** Whether this person is shown Max on the Quality control (the engine offers a Max maker and they hold Max). */
  max_offered?: boolean;
  /** Whether the Max music models are installed; Max is shown but not selectable until they are. */
  max_installed?: boolean;
  cut: "asked" | "ceiling" | null;
  max_seconds: number | null;
  title: string | null;
  description: string | null;
  /** The owner's own words; null when there are none. */
  lyrics: string | null;
  /** `words` (each with start and end seconds) is present on a line once the song's words were timed (MUSIC-GEN-20b); the kit wipes the highlight word by word. */
  timed_lyrics: { t: number; line: string; section: string | null; secondary?: string; words?: { t: number; end: number; text: string }[] }[] | null;
  duration_s: number | null;
  /** ISO time the song was asked for. */
  started_at: number;
}
export interface MusicStatus { can_make: boolean; engine_ready: boolean; limits: { min_seconds: number; max_seconds: number } | null }

export interface MakeSongBody { idea: string; lyrics?: string; instrumental?: boolean; title?: string; length?: "quick" | "full"; bpm?: number; key?: string; song_style?: string; band?: string }
export interface SongDetailChanges { title?: string; lyrics?: string; description?: string; bpm?: number; key?: string }

export const musicApi = {
  status: () => requestJson<MusicStatus>("/api/music/status"),
  card: (id: string, signal?: AbortSignal) => requestJson<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {}),
  stop: (id: string) => requestJson<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Makes an older version the one the next edit starts from. The newer versions stay. */
  /** Make it full / Make it quick: the same song made again at the other length, as a new version on this card. */
  setLength: (id: string, length: "quick" | "full", fileId?: string) => requestJson<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/length`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ length, ...(fileId ? { file_id: fileId } : {}) }) }),
  /** Make it Boost / Make it Standard: the same song made again with the other maker, as a new version on this card. */
  setTier: (id: string, tier: "standard" | "boost" | "max", fileId?: string) => requestJson<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/quality`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fileId ? { tier, file_id: fileId } : { tier }) }),
  /** Delete a song: it, its versions and its covers move to Trash together. */
  remove: (id: string) => requestJson<{ deleted: number; trash_until: string | null }>(`/api/music/jobs/${encodeURIComponent(id)}/delete`, { method: "POST" }),
  revise: (id: string, change: string, fileId?: string) => requestJson<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/revise`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ change, ...(fileId ? { file_id: fileId } : {}) }) }),
  /** Make a song from the Make a song page: the same path the generate_music tool runs. Answers with the card, still being made. */
  makeSong: (body: MakeSongBody) => requestJson<MusicCard>("/api/music/songs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  /** A new title, words, style, tempo or key: a new version on the same card. */
  details: (id: string, changes: SongDetailChanges, fileId?: string) => requestJson<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/details`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...changes, ...(fileId ? { file_id: fileId } : {}) }) }),
  stems: (id: string, fileId?: string) => requestJson<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/stems`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fileId ? { file_id: fileId } : {}) }),
  stemsFromFile: (fileId: string) => requestJson<MusicCard>("/api/music/stems/from-file", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: fileId }) }),
  newCover: (id: string, prompt: string) => requestJson<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/cover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) }),
  useVersion: (id: string, fileId: string) => requestJson<MusicCard>(`/api/music/jobs/${encodeURIComponent(id)}/use`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: fileId }) }),
  /** A personal download of one version (never the commercial purpose). */
  fileUrl: (fileId: string) => `/api/music/files/${encodeURIComponent(fileId)}`,
};
