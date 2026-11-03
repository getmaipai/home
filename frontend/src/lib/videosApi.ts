// VIDEO-GEN-06: the video card's calls to Home (`/api/videos`). Data only; nothing here draws.
import { requestJson } from "@/lib/api";

export interface VideoClip { url: string; poster_url: string; width: number; height: number; seconds: number | null; seed: number | null; file_id: string; poster_file_id: string; /** VIDEO-LTX-01: the clip has a sound track the model made (speech included). */ has_sound?: boolean }
export interface VideoItem {
  id: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  percent: number;
  label: string;
  position: number | null;
  /** While running (GENPREVIEW-01): seconds left from earlier clips, and the first frame once the motion is done. */
  eta_seconds: number | null;
  step: number | null;
  steps: number | null;
  preview_url: string | null;
  started_at: number;
  prompt: string;
  kind: "generate" | "animate" | "edit";
  error: string | null;
  /** VIDEO-LTX-01: Quick (about two minutes, no sound) or Detailed (with sound and speech), and the other kind this video can be made again as (null: a style binds it, or the other kind is not on this computer). */
  quality?: "quick" | "detailed";
  switch_to?: "quick" | "detailed" | null;
  /** TIER-HOME-03: this person is shown Max on the card. */
  /** TIER-PRIO-07: set while the card asks whether to make it now with the level it can run at and this person may answer; null otherwise. */
  fit_ask?: { job_id: string; picked?: string | null; actual?: string | null } | null;
  max_offered?: boolean;
  /** ADULT-LOCK-06: the item's Adult lock state for its creator, once it is shown (null while it is made, for a minor, in a temporary chat). */
  adult?: VideoAdultState | null;
  clip: VideoClip | null;
}
/** ADULT-LOCK-06: what the item's menu needs. `can_clear` shows "Unmark as NSFW" (confirm dialog and a fresh passcode); `can_mark` shows "Mark as NSFW". */
export interface VideoAdultState {
  made_audience: "all-ages" | "adult-only";
  lock: "on" | "off";
  can_clear: boolean;
  can_mark: boolean;
  line: string | null;
  history: Array<{ action: "clear" | "mark"; via: "creator_passcode" | "creator" | "admin" | "auto"; at: string }>;
}
/** ADULT-LOCK-02: a card that holds an adult-only clip while the page holds no unlock proof: the one lock tile. */
export interface LockedVideoCard { locked: true; making: boolean }
export interface VideoCard { id: string; conversation_id: string | null; items: VideoItem[]; can_make_another: boolean; limits: string }
export interface VideoStatus { can_make: boolean; reason: string | null; engine_ready: boolean; adult_styles: boolean; limits: string; styles: Array<{ id: string; name: string }> }
export interface VideoAdapterRow { id: string; name: string; classification: "all-ages" | "adult-only"; enabled: boolean; needs_confirmation: boolean; sha256: string; base_model: string; trigger_words: string[]; licence: string; strength_default: number; bytes: number; source_url: string | null; added_at: string }
/** VIDEO-LTX-01: Detailed videos as Settings sees them. */
export interface DetailedVideoSettings { installed: boolean; available: boolean; reason: string | null; download_bytes: number; component: string; licence: { id: string; name: string; url: string } | null; lora_base_model: string }
export interface VideoSettings {
  quality?: "quick" | "detailed";
  detailed?: DetailedVideoSettings;
  state: string; available: boolean; reason: string | null; tier: string | null; model_installed: boolean; limits: string;
  enabled: boolean; adult_adapters: boolean; minors: string; adapters: VideoAdapterRow[];
  /** VIDEO-SETTINGS-02: some adult-only styles are locked; one tile stands for them, never a count. */
  locked_styles?: boolean;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const videosApi = {
  status: () => requestJson<VideoStatus>("/api/videos/status"),
  /** The clip prepared for texting (a sound track, a name from the prompt). */
  messagesUrl: (id: string) => `/api/videos/jobs/${encodeURIComponent(id)}/messages.mp4`,
  card: (id: string, signal?: AbortSignal) => requestJson<VideoCard | LockedVideoCard>(`/api/videos/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {}),
  stop: (id: string) => requestJson<VideoCard>(`/api/videos/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  another: (id: string, quality?: "quick" | "detailed", prompt?: string, tier?: "standard" | "boost" | "max") => requestJson<VideoCard>(`/api/videos/jobs/${encodeURIComponent(id)}/another`, { method: "POST", ...(quality || prompt || tier ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(quality ? { quality } : {}), ...(prompt ? { prompt } : {}), ...(tier ? { tier } : {}) }) } : {}) }),
  /** A fresh passcode for one action on one clip: a single-use ticket valid 30 seconds (an unlock proof does not replace it). */
  confirmUnmark: (item: string, secret: string) => requestJson<{ ticket: string; expires_in: number }>("/api/adult-lock/confirm", json({ secret, action: "unmark", item })),
  /** Clear the lock (with the ticket) or mark the clip NSFW again (no passcode). */
  adultMark: (id: string, body: { action: "clear" | "mark"; ticket?: string }) => requestJson<{ made_audience: "all-ages" | "adult-only"; lock: "on" | "off" }>(`/api/videos/jobs/${encodeURIComponent(id)}/adult-mark`, json(body)),
  animate: (input: { conversation_id: string; turn_id: string; file_id?: string; prompt?: string }) => requestJson<VideoCard>("/api/videos/animate", json(input)),
  settings: () => requestJson<VideoSettings>("/api/videos/settings"),
  setAdapter: (id: string, patch: { enabled?: boolean; classification?: "all-ages" | "adult-only" }) => requestJson<VideoAdapterRow>(`/api/videos/adapters/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }),
  removeAdapter: (id: string) => requestJson<{ ok: true }>(`/api/videos/adapters/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addAdapter: (form: FormData) => requestJson<VideoAdapterRow>("/api/videos/adapters", { method: "POST", body: form }),
};
