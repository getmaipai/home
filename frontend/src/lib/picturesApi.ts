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
