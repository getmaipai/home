// TIER-HOME-05: the Max chat lease (docs/design/resource-tiers-2026-10-27.md sections 7 T6 and T7, addendum docs/design/max-chat-lease-2026-10-31.md).
// Max chat is a lease on the machine, not a household switch: a holder picks Max, the resident chat model is swapped for the big one, and the
// lease ends by itself when nothing is in flight. This file is the state machine only. The swap (unload residents, load the big model,
// post-load check, rollback on failure) is injected, so the Stack's coding-mode transaction stays the one implementation. In-memory state,
// no person text: the record holds a person id, times and a state.
// TIER-LEASE-01: this file is the engine-swap driver. When to hold and when to release is decided by lib/tierLease/policy.ts (one policy for every
// degrading tier); this file reads the household queue's signals, asks the policy, and does the swap.
import { holdsMax, type TierCategory } from "@/lib/tiers";
import type { PersonRow } from "@/types";
import { isOwnerOrAdmin } from "@/lib/access";
import {
  decide, leaseKeyForCategory, LEASE_REGISTRY, mayRenew, mayTake, NO_QUEUE_SIGNALS, releasesInSeconds,
  type LeaseDecision, type LeaseKey, type LeaseQueueSignals, type LeaseRegistry,
} from "@/lib/tierLease/policy";

export type LeaseState = "off" | "starting" | "held" | "releasing";
export type LeaseRefusal = "not_a_holder" | "not_ready" | "swap_failed" | "stack_busy" | "max_window";

export interface LeaseConfig { idleMs: number; pinCapMs: number }
/** Max is one message at a time: the lease is handed back this long after the last answer finishes (owner, 2026-11-01), short enough that
 * other jobs are not held, long enough that a quick second pick is fast. A lease nobody uses ends the same way. */
export const LEASE_GRACE_MS = 3 * 60_000;
/** Section 7 T7 (grace shortened from 30 minutes, 2026-11-01); a pinned lease still ends after 4 hours of quiet from the pinned person. */
export const DEFAULT_LEASE: LeaseConfig = { idleMs: LEASE_GRACE_MS, pinCapMs: 4 * 60 * 60_000 };

export interface LeaseDeps {
  now: () => number;
  /** The coding-mode swap transaction toward the big model. Throws when the post-load check fails; the Stack has already put the residents back. */
  swapToBig: () => Promise<void>;
  /** The swap back to the standard model between requests. */
  swapToStandard: () => Promise<void>;
  /** The readiness record gate (coding mode's eight items): false means Max chat is not offered on this machine. */
  ready: () => Promise<boolean>;
  /** A generator Max window is open: a lease request waits for it (the job's card says so). */
  windowOpen?: () => boolean;
  /** Whether the Stack is really in coding mode right now: true while the big model is loaded for chat. A read failure counts as true (no swap storm). */
  bigIsUp?: () => Promise<boolean>;
  config?: LeaseConfig;
  /** TIER-LEASE-01: what the household queue says about this lease (counts and kinds only). `forPersonId` leaves that person's own jobs out of "heavy running elsewhere". */
  signals?: (forPersonId?: string) => LeaseQueueSignals;
}

export interface LeaseSnapshot {
  state: LeaseState;
  holderId: string | null;
  pinned: boolean;
  inFlight: number;
  lastActivityAt: number | null;
  /** Seconds until the idle timer would release it, or null when no timer runs (not held, or a request is in flight). */
  releasesInSeconds: number | null;
  /** TIER-LEASE-01: which lease key the holder took (chat or coding) and the signals the policy last saw; additive for the lease API (-03). */
  key: LeaseKey;
  waiters: { count: number; kinds: string[] };
  holderJobs: number;
}

type Holder = Pick<PersonRow, "id" | "role">;
export type AcquireResult = { ok: true; state: "held" } | { ok: false; refusal: LeaseRefusal };

export function createChatLease(deps: LeaseDeps) {
  const config = deps.config ?? DEFAULT_LEASE;
  let state: LeaseState = "off";
  let holderId: string | null = null;
  let pinned = false;
  /** TIER-LEASE-03: the holder asked to hand the lease over at the next boundary (no request in flight); `tick` honours it before the grace. */
  let yielding = false;
  let inFlight = 0;
  let lastActivityAt: number | null = null;
  let transition: Promise<unknown> | null = null;
  /** The swap back failed: the lease reads as off, but the Stack may still hold the big model, so the next ticks keep asking it to return. */
  let pendingReturn = false;

  let key: LeaseKey = "chat";
  /** An explicit config (tests, a later setting) bounds both keys; otherwise each key uses its own registry entry. */
  const registry: LeaseRegistry = deps.config
    ? { chat: { graceMs: config.idleMs, pinCapMs: config.pinCapMs }, coding: { graceMs: config.idleMs, pinCapMs: config.pinCapMs } }
    : { chat: { graceMs: DEFAULT_LEASE.idleMs, pinCapMs: DEFAULT_LEASE.pinCapMs }, coding: LEASE_REGISTRY.coding };
  const queueSignals = (forPersonId?: string): LeaseQueueSignals => { try { return deps.signals?.(forPersonId) ?? NO_QUEUE_SIGNALS; } catch { return NO_QUEUE_SIGNALS; } };
  const facts = () => ({ now: deps.now(), lastEngagedAt: lastActivityAt, inFlight, pinned, signals: queueSignals() });
  /** What the policy says about the lease right now. Only meaningful while held. */
  const decision = (): LeaseDecision => decide(key, facts(), registry);

  function snapshot(): LeaseSnapshot {
    const f = facts();
    return {
      state, holderId, pinned, inFlight, lastActivityAt,
      releasesInSeconds: state === "held" ? releasesInSeconds(key, f, registry) : null,
      key, waiters: f.signals.waiters, holderJobs: f.signals.holderJobs,
    };
  }

  /** The admission hold: Boost and Max generator jobs queue with `max_chat` while this is true (section 7 T6). Standard jobs that fit still run. */
  const holdsGenerators = () => state === "starting" || state === "held" || state === "releasing";

  async function acquire(person: Holder, opts: { pinned?: boolean; category?: TierCategory } = {}): Promise<AcquireResult> {
    // A minor never holds Max chat (RULES.md rules 0 and 8): holdsMax already refuses child, guest and a teen's chat.
    // CODE-TIER-03: a Max Code turn takes this same lease and is checked against its own category's grant (`tier.max:coding`).
    if (person.role === "teen" || !holdsMax(person, opts.category ?? "chat")) return { ok: false, refusal: "not_a_holder" };
    if (state === "held" && holderId === person.id) {
      key = leaseKeyForCategory(opts.category);
      if (opts.pinned && isOwnerOrAdmin(person)) pinned = true;
      // The Stack may have left coding mode since the take (restart, watchdog): a held lease then follows the Stack's real mode.
      let up = true;
      if (deps.bigIsUp) { try { up = await deps.bigIsUp(); } catch { up = true; } }
      if (up) { lastActivityAt = deps.now(); return { ok: true, state: "held" }; }
      if (transition) return { ok: false, refusal: "stack_busy" };
      state = "starting";
      const run = deps.swapToBig();
      transition = run;
      try { await run; } catch { state = "off"; holderId = null; transition = null; return { ok: false, refusal: "swap_failed" }; }
      transition = null;
      state = "held";
      lastActivityAt = deps.now();
      return { ok: true, state: "held" };
    }
    if (deps.windowOpen?.()) return { ok: false, refusal: "max_window" };
    if (transition) return { ok: false, refusal: "stack_busy" };
    if (state !== "off" || pendingReturn) return { ok: false, refusal: "stack_busy" };
    // Every take is a queue job and never preempts: another person's heavy job that is running keeps the machine until it ends.
    if (!mayTake(queueSignals(person.id))) return { ok: false, refusal: "stack_busy" };
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
    key = leaseKeyForCategory(opts.category);
    pinned = !!opts.pinned && isOwnerOrAdmin(person);
    lastActivityAt = deps.now();
    return { ok: true, state: "held" };
  }

  /** A request on the big model started. While any is in flight the lease cannot end, however long the idle timer says (T7 a). */
  /** TIER-LEASE-01: only the holder renews the lease. A request by someone else still counts as in flight (it is never cut off) but does not restart the idle timer; no person named is the driver's own call. */
  function requestStarted(byPersonId?: string): void { inFlight += 1; if (mayRenew(holderId, byPersonId)) lastActivityAt = deps.now(); }
  /** A token arrived: the idle timer counts from the last token (T7 c). */
  function noteToken(byPersonId?: string): void { if (mayRenew(holderId, byPersonId)) lastActivityAt = deps.now(); }
  function requestEnded(byPersonId?: string): void { inFlight = Math.max(0, inFlight - 1); if (mayRenew(holderId, byPersonId)) lastActivityAt = deps.now(); }
  /** TIER-LEASE-01: the holder acted (a key, an attachment, a submit). Renews the grace; false when this person does not hold the lease. Seam for `POST /api/tier-leases/:key/touch` (-03). */
  function touch(personId: string): boolean {
    if (state !== "held" || holderId !== personId) return false;
    lastActivityAt = deps.now();
    return true;
  }

  /** TIER-LEASE-03: Yield. Holder only. Released at once when nothing is in flight, else at the next boundary (the running request is never cut off). */
  async function yieldLease(personId: string): Promise<"released" | "yielding" | false> {
    if (state !== "held" || holderId !== personId) return false;
    if (inFlight > 0) { yielding = true; return "yielding"; }
    await release();
    return "released";
  }
  /** TIER-LEASE-03: only an owner or admin sets or clears a pin, and only on a lease that is held. */
  function setPin(by: Holder, value: boolean): boolean {
    if (!isOwnerOrAdmin(by) || state !== "held") return false;
    pinned = value; return true;
  }

  async function release(): Promise<void> {
    if (state !== "held" || inFlight > 0) return;
    yielding = false;
    state = "releasing";
    const run = deps.swapToStandard();
    transition = run;
    try { await run; } catch { pendingReturn = true; /* generators are not held forever; tick() retries the return */ }
    transition = null;
    state = "off";
    holderId = null;
    pinned = false;
    lastActivityAt = null;
  }

  /** Called on a short interval: releases between requests once the holder has been quiet for the limit. Never while a request is in flight. */
  async function tick(): Promise<boolean> {
    if (state === "off" && pendingReturn && !transition) {
      const run = deps.swapToStandard();
      transition = run;
      try { await run; pendingReturn = false; } catch { /* asked again on the next tick */ }
      transition = null;
      return false;
    }
    if (state !== "held" || inFlight > 0 || lastActivityAt === null) return false;
    if (yielding) { await release(); return true; }
    if (decision().action !== "release") return false;
    await release();
    return true;
  }

  /** A watchdog CRITICAL evicted the big model (T7 e): the lease re-opens by itself when memory is fine, so only the state is dropped here. */
  function evicted(): void {
    if (state !== "held") return;
    state = "off";
    holderId = null;
    pinned = false;
    yielding = false;
    inFlight = 0;
    lastActivityAt = null;
  }

  return { acquire, release, yieldLease, setPin, tick, touch, decision, evicted, requestStarted, noteToken, requestEnded, snapshot, holdsGenerators };
}

export type ChatLease = ReturnType<typeof createChatLease>;

let active: ChatLease | null = null;
/** The running lease registers itself so readers that cannot import the runtime (it imports them) can ask whether Max chat is up. */
export function registerActiveChatLease(lease: ChatLease | null): void { active = lease; }
/** True while the big chat model is leased: big generators wait, robot captioning and canary pictures stand aside. */
export const chatLeaseHeld = (): boolean => active?.snapshot().state === "held";
/** RESEARCH-TIER-01: whether this person holds the Max lease right now (the server never trusts the page's say-so alone). */
export const chatLeaseHeldBy = (personId: string): boolean => { const snap = active?.snapshot(); return snap?.state === "held" && snap.holderId === personId; };
