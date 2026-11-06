// IMGGEN-UI-01: the picture card's calls to Home (`/api/pictures`). Data only; nothing here draws.
import { requestJson } from "@/lib/api";

export interface PictureFile { id: string; url: string; width: number; height: number; seed: number | null; model: string | null; steps: number | null; ms: number | null; alt: string }
export interface PictureCard {
  id: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  percent: number;
  label: string;
  position: number | null;
  /** While running (GENPREVIEW-01): the engine's step, time left and the latest preview of where the picture is heading. */
  stage_label: string | null;
  eta_seconds: number | null;
  step: number | null;
  steps: number | null;
  preview_url: string | null;
  preview_step: number | null;
  elapsed_ms: number;
  prompt: string;
  kind: "generate" | "variation" | "edit";
  conversation_id: string | null;
  error: string | null;
  files: PictureFile[];
  can_vary: boolean;
  /** IMGGEN-QUALITY-01: which maker made it, and the other kind it can be made again as (null: a style binds it, or the other kind is not on this computer). */
  quality: "quick" | "detailed";
  switch_to: "quick" | "detailed" | null;
  /** TIER-HOME-03: this person is shown Make it Max (they hold it and a Max model is set). */
  max_offered?: boolean;
  /** TIER-PRIO-07: set while the card asks whether to make it now with the level it can run at and this person may answer; null otherwise. */
  fit_ask?: { job_id: string; picked?: string | null; actual?: string | null } | null;
  size: string;
  stop_id: string;
  adult: PictureAdultState | null;
}
export interface PictureAdultState { made_audience: "all-ages" | "adult-only"; lock: "on" | "off"; can_clear: boolean; can_mark: boolean; line: string | null; history: Array<{ action: "clear" | "mark"; via: "creator_passcode" | "creator" | "admin" | "auto"; at: string }> }
export interface LockedPictureCard { locked: true; making: boolean }
export type PictureCardOrLocked = PictureCard | LockedPictureCard;
export interface PictureStatus { can_make: boolean; reason: string | null; engine_ready: boolean; adult_styles: boolean; styles: Array<{ id: string; name: string }> }


export const picturesApi = {
  status: () => requestJson<PictureStatus>("/api/pictures/status"),
  card: (id: string, signal?: AbortSignal) => requestJson<PictureCardOrLocked>(`/api/pictures/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {}),
  stop: (id: string) => requestJson<PictureCardOrLocked>(`/api/pictures/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  again: (id: string, quality?: "quick" | "detailed", prompt?: string, tier?: "standard" | "boost" | "max") => requestJson<PictureCard>(`/api/pictures/jobs/${encodeURIComponent(id)}/variation`, { method: "POST", ...(quality || prompt || tier ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(quality ? { quality } : {}), ...(prompt ? { prompt } : {}), ...(tier ? { tier } : {}) }) } : {}) }),
  confirmUnmark: (item: string, secret: string) => requestJson<{ ticket: string; expires_in: number }>("/api/adult-lock/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret, action: "unmark", item }) }),
  adultMark: (id: string, body: { action: "clear" | "mark"; ticket?: string }) => requestJson<{ made_audience: "all-ages" | "adult-only"; lock: "on" | "off" }>(`/api/pictures/jobs/${encodeURIComponent(id)}/adult-mark`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
};
