import { requestJson } from "@/lib/api";

export interface FilmPlan {
  title: string; summary: string;
  shots: Array<{ id: string; still: string; framing: string; motion: string; seconds: number }>;
}
export interface FilmProgress {
  id: string; state: "planning" | "waiting_for_go" | "running" | "done" | "failed" | "cancelled";
  stage: "Plan" | "Cast" | "Stills" | "Clips" | "Music" | "Assemble" | null;
  done_steps: number; total_steps: number; plan: FilmPlan | null; film_file_id: string | null;
  note: string | null; error_line: string | null; production_id: string | null;
}
const path = (id: string) => `/api/films/${encodeURIComponent(id)}`;
const post = (id: string, action: string, body?: unknown) => requestJson<FilmProgress>(`${path(id)}/${action}`, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
export const filmsApi = {
  get: (id: string, signal?: AbortSignal) => requestJson<FilmProgress>(path(id), signal ? { signal } : {}),
  go: (id: string) => post(id, "go"), cancel: (id: string) => post(id, "cancel"), resume: (id: string) => post(id, "resume"),
  redoShot: (id: string, shot_id: string) => post(id, "redo-shot", { shot_id }), music: (id: string) => post(id, "music"),
};
