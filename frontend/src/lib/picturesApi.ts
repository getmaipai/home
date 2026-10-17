// IMGGEN-UI-01: the picture card's calls to Home (`/api/pictures`). Data only; nothing here draws.
import { ApiError } from "@/lib/api";

export interface PictureFile { id: string; url: string; width: number; height: number; seed: number | null; model: string | null; steps: number | null; ms: number | null; alt: string }
export interface PictureCard {
  id: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  percent: number;
  label: string;
  position: number | null;
  elapsed_ms: number;
  prompt: string;
  kind: "generate" | "variation" | "edit";
  conversation_id: string | null;
  error: string | null;
  files: PictureFile[];
  can_vary: boolean;
  size: string;
  stop_id: string;
}
export interface PictureStatus { can_make: boolean; reason: string | null; engine_ready: boolean; adult_styles: boolean; styles: Array<{ id: string; name: string }> }

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.code);
  return body as T;
}

export const picturesApi = {
  status: () => send<PictureStatus>("/api/pictures/status"),
  card: (id: string, signal?: AbortSignal) => send<PictureCard>(`/api/pictures/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {}),
  stop: (id: string) => send<PictureCard>(`/api/pictures/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  again: (id: string) => send<PictureCard>(`/api/pictures/jobs/${encodeURIComponent(id)}/variation`, { method: "POST" }),
};

// IMGGEN-SET-01: the admin side (/api/pictures/admin), for the Pictures and videos settings view.
export interface AdminAdapter {
  id: string; name: string; base_model: string; classification: "all-ages" | "adult-only"; classification_note: string | null;
  licence: string; licence_known: boolean; source_url: string | null; bytes: number; sha256: string; trigger_words: string[]; added_at: string;
  enabled: boolean; needs_confirmation: boolean; looks_like?: { id: string; name: string } | null;
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
}
export interface AdminJob { state: "running" | "done" | "failed"; percent: number; label: string; error: string | null; code: string | null; adapter: AdminAdapter | null }

export const picturesAdminApi = {
  overview: () => send<AdminOverview>("/api/pictures/admin"),
  installModel: (family?: string) => send<{ job: string; family: string }>("/api/pictures/admin/models/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(family ? { family } : {}) }),
  job: (id: string) => send<AdminJob>(`/api/pictures/admin/jobs/${encodeURIComponent(id)}`),
  addAdapter: (form: FormData) => send<{ job: string } | { adapter: AdminAdapter }>("/api/pictures/admin/adapters", { method: "POST", body: form }),
  setEnabled: (id: string, enabled: boolean) => send<AdminAdapter>(`/api/pictures/admin/adapters/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }),
  remove: (id: string) => send<{ ok: true }>(`/api/pictures/admin/adapters/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
