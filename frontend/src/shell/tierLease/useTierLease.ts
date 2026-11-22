// TIER-LEASE-04: the one hook every feature that holds a degrading tier mounts (docs/design/tier-lease-2026-11-22.md section 4). It reads the lease view, calls touch
// at most once every 10 seconds when the composer is used, and turns the view into the notice value Chat's composer line already draws. Chat and Code add no lease
// logic of their own: their one call is `useTierLease(key, options)`, and the value goes in the composer's notice slot.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { i18n } from "@lingui/core";
import type { ChatComposerNoticeValue } from "@/apps/chat/chatThreadContexts";
import { tierLeaseApi, type TierLeaseActionCode, type TierLeaseKey, type TierLeaseNoticeWire, type TierLeaseView } from "@/shell/tierLease/tierLeaseApi";

/** At most one touch every 10 seconds (the design's cadence). */
export const TOUCH_INTERVAL_MS = 10_000;

export interface TierLeaseOptions {
  /** False for a person or page that never holds a degrading tier (a child, a guest): nothing is read. */
  enabled?: boolean;
  /** The coding session the line is for: Pause, Resume and Use a lower tier act on it. */
  sessionId?: string;
  /** The session is paused (it holds no lease, so the view cannot say so). */
  paused?: boolean;
  /** Code shows its own status line while a session works; the idle holder sentence is for Chat. */
  showIdle?: boolean;
  /** This person has a job waiting for the lease right now (the page knows; the lease view cannot say whose job waits). The waiter line shows only then. */
  waiting?: boolean;
  /** Tell the page something changed (a session paused, resumed or lowered) so it re-reads its own state. */
  onChanged?: () => void;
  /** Seconds between reads while the lease is held (tests lower it). */
  refetchMs?: number;
}

const ACTION_WORDS: Record<TierLeaseActionCode, () => string> = {
  keep: () => i18n._({ id: "Keep going", message: "Keep going" }),
  lower: () => i18n._({ id: "Use a lower tier", message: "Use a lower tier" }),
  pause: () => i18n._({ id: "Pause", message: "Pause" }),
  resume: () => i18n._({ id: "Resume", message: "Resume" }),
  standard_now: () => i18n._({ id: "Use Standard now", message: "Use Standard now" }),
};
export const tierLeaseActionLabel = (code: TierLeaseActionCode): string => ACTION_WORDS[code]();

export interface TierLease { view: TierLeaseView | null; notice: ChatComposerNoticeValue | null; touch: () => void }

export function useTierLease(key: TierLeaseKey, options: TierLeaseOptions = {}): TierLease {
  const { enabled = true, sessionId, paused = false, showIdle = true, waiting = false, onChanged, refetchMs = 15_000 } = options;
  const qc = useQueryClient();
  const queryKey = ["tier-lease", key] as const;
  const query = useQuery<TierLeaseView>({ queryKey, queryFn: () => tierLeaseApi.get(key), enabled, retry: false, refetchInterval: (q) => (q.state.data?.state === "off" ? 60_000 : refetchMs) });
  // A read that failed or came back in another shape says nothing (a lease line never blocks anyone).
  const view = enabled && query.data?.waiters ? query.data : null;

  // Released while idle: the lease was mine with something waiting, and now it is not. The line stays until I type again or take it back.
  const [released, setReleased] = useState(false);
  const was = useRef<{ mine: boolean; waiting: number } | null>(null);
  useEffect(() => {
    if (!view) return;
    const mine = view.held_by_you && view.state === "held";
    if (was.current?.mine && !mine && was.current.waiting > 0) setReleased(true);
    if (mine) setReleased(false);
    was.current = { mine, waiting: view.waiters.count };
  }, [view]);
  const [keptFor, setKeptFor] = useState<number | null>(null);

  const lastTouch = useRef(0);
  const touch = useCallback(() => {
    const now = Date.now();
    const cached = qc.getQueryData<TierLeaseView>(queryKey);
    if (!cached || !cached.held_by_you || cached.state !== "held") { if (released) setReleased(false); return; }
    if (now - lastTouch.current < TOUCH_INTERVAL_MS) return;
    lastTouch.current = now;
    void tierLeaseApi.touch(key).then((next) => qc.setQueryData(queryKey, next)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, key, released]);

  const run = useCallback((code: TierLeaseActionCode) => {
    const refresh = () => { void qc.invalidateQueries({ queryKey }); onChanged?.(); };
    const settle = (call: Promise<unknown>) => { void call.then(refresh).catch(refresh); };
    if (code === "keep") { lastTouch.current = 0; setKeptFor(view?.waiters.count ?? 0); touch(); return; }
    if (code === "lower" || code === "standard_now") { settle(tierLeaseApi.lower(key, "standard", sessionId)); return; }
    if (!sessionId) return;
    if (code === "pause") settle(tierLeaseApi.pause(key, sessionId));
    else settle(tierLeaseApi.resume(key, sessionId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, key, sessionId, view, touch, onChanged]);

  let wire: TierLeaseNoticeWire | null = null;
  if (view) {
    if (paused) wire = view.paused_notice;
    else if (released && !(view.held_by_you && view.state === "held")) wire = view.released_notice;
    else wire = view.notice;
  }
  if (wire?.code === "holder_idle" && !showIdle) wire = null;
  if ((wire?.code === "waiter" || wire?.code === "waiter_pinned") && !waiting) wire = null;
  if (!wire) return { view, notice: null, touch };

  // Keep going hides the offer until the number waiting changes; the line itself stays.
  const offered = wire.code === "holder_waiting" && keptFor === (view?.waiters.count ?? 0) ? [] : wire.actions;
  const actions = offered.filter((code) => code === "keep" || sessionId || (key === "chat" && (code === "lower" || code === "standard_now"))).map((code) => ({ label: tierLeaseActionLabel(code), onAction: () => run(code) }));
  return {
    view,
    touch,
    notice: { text: wire.text, more: wire.more, repairsLink: null, ...(actions.length ? { actions } : {}), ...(view?.held_by_you && view.state === "held" ? { onEngage: touch } : {}) },
  };
}
