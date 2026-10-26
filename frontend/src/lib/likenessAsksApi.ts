// PERUSE-2026-10-25: the consent ask's calls to Home (`/api/likeness/asks`). Data only; nothing here draws.
import { ApiError } from "@/lib/api";

export type LikenessAskState = "waiting" | "approved" | "declined" | "expired" | "consumed" | "cancelled";
export interface LikenessAsk {
  id: string;
  state: LikenessAskState;
  medium: "picture" | "video";
  count: number;
  style_name: string | null;
  requester_name: string;
  subject_name: string;
  /** The exact prompt Home will send; null once the ask has ended. */
  prompt: string | null;
  expires_at: string | null;
  created_at: string;
  decided_at: string | null;
  as: "subject" | "requester";
}

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.code);
  return body as T;
}

export const likenessAsksApi = {
  list: () => send<{ asks: LikenessAsk[] }>("/api/likeness/asks"),
  get: (id: string, signal?: AbortSignal) => send<LikenessAsk>(`/api/likeness/asks/${encodeURIComponent(id)}`, signal ? { signal } : {}),
  decide: (id: string, decision: "consent" | "decline") => send<{ state: LikenessAskState }>(`/api/likeness/asks/${encodeURIComponent(id)}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) }),
};
