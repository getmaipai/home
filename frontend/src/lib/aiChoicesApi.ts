// AIMODELS-CHOICES-01: Settings, AI and models. Home's calls to /api/ai (the job cards, the one "set everything to recommended"
// button and "Free up space"). Data only; nothing here draws. The routes are owner and admin only.
import { ApiError } from "@/lib/api";
import type { AiAlwaysOn, AiCard, AiRecommendedPlan } from "../../../shared/aiChoices";

export interface AiChoicesOverview {
  stack: "ok" | "unreachable"; message: string | null; tier: string | null;
  free_disk_bytes: number | null; installed_bytes: number;
  cards: AiCard[]; alwaysOn: AiAlwaysOn; recommended: AiRecommendedPlan | null; unused_bytes: number; memory_available_bytes?: number | null;
}
export interface UnusedModel { id: string; name: string; bytes: number; reason: string; lastUsedAt: string | null }
export interface UnusedList { items: UnusedModel[]; total_bytes: number }
export interface RecommendedResult { ok: boolean; changed: string[]; started: string[]; already: string[]; skipped: Array<{ rowId?: string; id?: string; label: string; reason: string }>; needs_licence: Array<{ id: string; label: string }> }
export interface CleanupResult { results: Array<{ id: string; status: "removed" | "kept" | "failed"; freed_bytes: number; message: string }>; freed_bytes: number; kept: number; failed: number }

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.code);
  return body as T;
}
const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });

export const aiChoicesApi = {
  overview: () => send<AiChoicesOverview>("/api/ai/choices"),
  unused: () => send<UnusedList>("/api/ai/unused"),
  choose: (job: string, choice: string) => send<{ ok: true; started: string[] }>(`/api/ai/choices/${encodeURIComponent(job)}`, post({ choice })),
  applyRecommended: () => send<RecommendedResult>("/api/ai/recommended", post()),
  cleanup: (ids: string[]) => send<CleanupResult>("/api/ai/cleanup", post({ ids })),
};
