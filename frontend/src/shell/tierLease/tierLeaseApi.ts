// TIER-LEASE-04: Home's calls to the shared tier-lease routes (backend/src/routes/tierLeases.ts). Data only; nothing here draws.
import { requestJson } from "@/lib/api";

export type TierLeaseKey = "chat" | "coding";
export type TierLeaseActionCode = "keep" | "lower" | "pause" | "resume" | "standard_now";
export interface TierLeaseNoticeWire {
  code: "holder_idle" | "holder_waiting" | "paused" | "released" | "waiter" | "waiter_pinned";
  /** One short sentence in this person's form (adult or child), counts and kinds only. */
  text: string;
  more: string;
  actions: TierLeaseActionCode[];
}
export interface TierLeaseView {
  key: TierLeaseKey;
  state: "off" | "starting" | "held" | "releasing";
  held_by_you: boolean;
  pinned: boolean;
  releases_in_seconds: number | null;
  waiters: { count: number; kinds: string[] };
  holder_jobs: number;
  decision: string | null;
  pause_max_minutes: number;
  notice: TierLeaseNoticeWire | null;
  released_notice: TierLeaseNoticeWire;
  paused_notice: TierLeaseNoticeWire;
}

const post = <T,>(path: string, body?: unknown) => requestJson<T>(`/api/tier-leases/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

export const tierLeaseApi = {
  get: (key: TierLeaseKey) => requestJson<TierLeaseView>(`/api/tier-leases/${key}`),
  touch: (key: TierLeaseKey) => post<TierLeaseView>(`${key}/touch`),
  release: (key: TierLeaseKey) => post<TierLeaseView>(`${key}/release`),
  pause: (key: TierLeaseKey, sessionId: string) => post<{ state: "pausing" | "paused" }>(`${key}/pause`, { session_id: sessionId }),
  resume: (key: TierLeaseKey, sessionId: string) => post<{ turn_id: string }>(`${key}/resume`, { session_id: sessionId }),
  /** Only lowers, through the existing tier grants. Chat releases the lease; coding needs the session. */
  lower: (key: TierLeaseKey, to: "standard" | "boost", sessionId?: string) => post<{ tier: string }>(`${key}/lower`, { to, ...(sessionId ? { session_id: sessionId } : {}) }),
};
