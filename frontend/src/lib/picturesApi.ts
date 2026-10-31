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
  size: string;
  stop_id: string;
}
export interface PictureStatus { can_make: boolean; reason: string | null; engine_ready: boolean; adult_styles: boolean; styles: Array<{ id: string; name: string }> }


export const picturesApi = {
  status: () => requestJson<PictureStatus>("/api/pictures/status"),
  card: (id: string, signal?: AbortSignal) => requestJson<PictureCard>(`/api/pictures/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {}),
  stop: (id: string) => requestJson<PictureCard>(`/api/pictures/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  again: (id: string, quality?: "quick" | "detailed", prompt?: string, tier?: "standard" | "boost" | "max") => requestJson<PictureCard>(`/api/pictures/jobs/${encodeURIComponent(id)}/variation`, { method: "POST", ...(quality || prompt || tier ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(quality ? { quality } : {}), ...(prompt ? { prompt } : {}), ...(tier ? { tier } : {}) }) } : {}) }),
};

// IMGGEN-SET-01: the admin side (/api/pictures/admin), for the Pictures and videos settings view.
export interface AdminAdapter {
  id: string; name: string; base_model: string; classification: "all-ages" | "adult-only"; classification_note: string | null;
  licence: string; licence_known: boolean; source_url: string | null; bytes: number; sha256: string; trigger_words: string[]; added_at: string;
  enabled: boolean; needs_confirmation: boolean;
}
export interface AdminOverview {
  stack: "ok" | "unreachable";
  engine: {
    state: string; available: boolean; reason: string | null; default_model: string | null; edit_ready: boolean;
    models: Array<{ id: string; label: string; installed: boolean; available: boolean; licence: string; edit: boolean; peak_gb: number | null; remaining_bytes: number }>;
    remaining_bytes: number;
  };
  adapters: AdminAdapter[];
  bands: Array<{ band: "children" | "teens" | "adults"; label: string; on: boolean; locked: boolean; note: string }>;
  adult_adapters: "allowed" | "restricted";
  /** IMGGEN-QUALITY-01: the household's Picture quality setting, and whether Detailed can be made now. */
  quality: "quick" | "detailed";
  detailed_ready: boolean;
}
export interface AdminJob { state: "running" | "done" | "failed"; percent: number; label: string; error: string | null; code: string | null; adapter: AdminAdapter | null }

export const picturesAdminApi = {
  overview: () => requestJson<AdminOverview>("/api/pictures/admin"),
  installModel: (family?: string) => requestJson<{ job: string; family: string }>("/api/pictures/admin/models/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(family ? { family } : {}) }),
  job: (id: string) => requestJson<AdminJob>(`/api/pictures/admin/jobs/${encodeURIComponent(id)}`),
  addAdapter: (form: FormData) => requestJson<{ job: string } | { adapter: AdminAdapter }>("/api/pictures/admin/adapters", { method: "POST", body: form }),
  setEnabled: (id: string, enabled: boolean) => requestJson<AdminAdapter>(`/api/pictures/admin/adapters/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }),
  remove: (id: string) => requestJson<{ ok: true }>(`/api/pictures/admin/adapters/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
