// TIER-HOME-05: the Max chat lease (docs/design/resource-tiers-2026-10-27.md sections 7 T6 and T7, addendum docs/design/max-chat-lease-2026-10-31.md).
// Max chat is a lease on the machine, not a household switch: a holder picks Max, the resident chat model is swapped for the big one, and the
// lease ends by itself when nothing is in flight. This file is the state machine only. The swap (unload residents, load the big model,
// post-load check, rollback on failure) is injected, so the Stack's coding-mode transaction stays the one implementation. In-memory state,
// no person text: the record holds a person id, times and a state.
import { holdsMax } from "@/lib/tiers";
import type { PersonRow } from "@/types";

export type LeaseState = "off" | "starting" | "held" | "releasing";
export type LeaseRefusal = "not_a_holder" | "not_ready" | "swap_failed" | "stack_busy";

export interface LeaseConfig { idleMs: number; pinCapMs: number }
/** Section 7 T7: 30 minutes idle, and a pinned lease still ends after 4 hours of quiet from the pinned person. */
export const DEFAULT_LEASE: LeaseConfig = { idleMs: 30 * 60_000, pinCapMs: 4 * 60 * 60_000 };

export interface LeaseDeps {
  now: () => number;
  /** The coding-mode swap transaction toward the big model. Throws when the post-load check fails; the Stack has already put the residents back. */
  swapToBig: () => Promise<void>;
  /** The swap back to the standard model between requests. */
  swapToStandard: () => Promise<void>;
  /** The readiness record gate (coding mode's eight items): false means Max chat is not offered on this machine. */
  ready: () => Promise<boolean>;
  config?: LeaseConfig;
}

export interface LeaseSnapshot {
  state: LeaseState;
  holderId: string | null;
  pinned: boolean;
  inFlight: number;
  lastActivityAt: number | null;
  /** Seconds until the idle timer would release it, or null when no timer runs (not held, or a request is in flight). */
  releasesInSeconds: number | null;
}

type Holder = Pick<PersonRow, "id" | "role">;
export type AcquireResult = { ok: true; state: "held" } | { ok: false; refusal: LeaseRefusal };

export function createChatLease(deps: LeaseDeps) {
  const config = deps.config ?? DEFAULT_LEASE;
  let state: LeaseState = "off";
  let holderId: string | null = null;
  let pinned = false;
  let inFlight = 0;
  let lastActivityAt: number | null = null;
  let transition: Promise<unknown> | null = null;

  const limitMs = () => (pinned ? config.pinCapMs : config.idleMs);

  function snapshot(): LeaseSnapshot {
    const timer = state === "held" && inFlight === 0 && lastActivityAt !== null;
    return {
      state, holderId, pinned, inFlight, lastActivityAt,
      releasesInSeconds: timer ? Math.max(0, Math.ceil((lastActivityAt! + limitMs() - deps.now()) / 1000)) : null,
    };
  }

  /** The admission hold: Boost and Max generator jobs queue with `max_chat` while this is true (section 7 T6). Standard jobs that fit still run. */
  const holdsGenerators = () => state === "starting" || state === "held" || state === "releasing";

  async function acquire(person: Holder, opts: { pinned?: boolean } = {}): Promise<AcquireResult> {
    // A minor never holds Max chat (RULES.md rules 0 and 8): holdsMax already refuses child, guest and a teen's chat.
    if (person.role === "teen" || !holdsMax(person, "chat")) return { ok: false, refusal: "not_a_holder" };
    if (state === "held" && holderId === person.id) {
      lastActivityAt = deps.now();
      if (opts.pinned && (person.role === "owner" || person.role === "admin")) pinned = true;
      return { ok: true, state: "held" };
    }
    if (transition) return { ok: false, refusal: "stack_busy" };
    if (state !== "off") return { ok: false, refusal: "stack_busy" };
    if (!(await deps.ready())) return { ok: false, refusal: "not_ready" };
    state = "starting";
    const run = deps.swapToBig();
    transition = run;
    try {
      await run;
    } catch {
      state = "off";
      transition = null;
      return { ok: false, refusal: "swap_failed" };
    }
    transition = null;
    state = "held";
    holderId = person.id;
    pinned = !!opts.pinned && (person.role === "owner" || person.role === "admin");
    lastActivityAt = deps.now();
    return { ok: true, state: "held" };
  }

  /** A request on the big model started. While any is in flight the lease cannot end, however long the idle timer says (T7 a). */
  function requestStarted(): void { inFlight += 1; lastActivityAt = deps.now(); }
  /** A token arrived: the idle timer counts from the last token (T7 c). */
  function noteToken(): void { lastActivityAt = deps.now(); }
  function requestEnded(): void { inFlight = Math.max(0, inFlight - 1); lastActivityAt = deps.now(); }

  async function release(): Promise<void> {
    if (state !== "held" || inFlight > 0) return;
    state = "releasing";
    const run = deps.swapToStandard();
    transition = run;
    try { await run; } catch { /* The Stack's retry loop owns a failed return; the lease reads as released so generators are not held forever. */ }
    transition = null;
    state = "off";
    holderId = null;
    pinned = false;
    lastActivityAt = null;
  }

  /** Called on a short interval: releases between requests once the holder has been quiet for the limit. Never while a request is in flight. */
  async function tick(): Promise<boolean> {
    if (state !== "held" || inFlight > 0 || lastActivityAt === null) return false;
    if (deps.now() - lastActivityAt < limitMs()) return false;
    await release();
    return true;
  }

  /** A watchdog CRITICAL evicted the big model (T7 e): the lease re-opens by itself when memory is fine, so only the state is dropped here. */
  function evicted(): void {
    if (state !== "held") return;
    state = "off";
    holderId = null;
    pinned = false;
    inFlight = 0;
    lastActivityAt = null;
  }

  return { acquire, release, tick, evicted, requestStarted, noteToken, requestEnded, snapshot, holdsGenerators };
}

export type ChatLease = ReturnType<typeof createChatLease>;
