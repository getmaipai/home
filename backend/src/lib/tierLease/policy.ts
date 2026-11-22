// TIER-LEASE-01: the one sticky-tier lease policy (docs/design/tier-lease-2026-11-22.md sections 2, 3 and 6). Pure functions over a few signals, so
// every feature that degrades others (Max and Boost coding, Max chat, later video) shares one definition. The engine swap lives in the driver
// (lib/chatLease.ts); the driver asks this file whether to hold or release and whether a take may go ahead.
// Rule 6a: signals carry counts and kinds only, never a person id next to activity.

/** The leases that exist. Chat and coding share one engine today, so they are two keys over the same machine; media keys arrive with TIER-LEASE-06. */
export type LeaseKey = "chat" | "coding";

export interface LeaseKeyConfig {
  /** How long the lease stays up with nobody waiting and no job of the holder's, counted from the holder's last action. */
  graceMs: number;
  /** A pinned lease (admin waiver) ends after this long without the holder's action, whoever waits. */
  pinCapMs: number;
}

/** A key pressed this recently is finished first: the one protection when the lease would be released at once for a waiter. */
export const ENGAGED_PROTECTION_MS = 10_000;

export type LeaseRegistry = Readonly<Record<LeaseKey, LeaseKeyConfig>>;
export const LEASE_REGISTRY: LeaseRegistry = {
  // Chat keeps the 3 minute grace of the Max chat lease (owner, 2026-11-01).
  chat: { graceMs: 3 * 60_000, pinCapMs: 4 * 60 * 60_000 },
  // Coding default of the design (section 2): 10 minutes.
  coding: { graceMs: 10 * 60_000, pinCapMs: 4 * 60 * 60_000 },
};

export function isLeaseKey(value: unknown): value is LeaseKey { return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEASE_REGISTRY, value); }
/** The lease key for a tier category; anything that is not coding is chat. */
export function leaseKeyForCategory(category: string | undefined): LeaseKey { return category === "coding" ? "coding" : "chat"; }

/** What the household queue says about one lease: counts and kinds only. */
export interface LeaseQueueSignals {
  /** Jobs of the holder running or queued on this lease. */
  holderJobs: number;
  /** Jobs the lease holds back (queued, waiting for it), as a count and the kinds they are. */
  waiters: { count: number; kinds: string[] };
  /** Another person's heavy job is running: a take would have to preempt it, so it waits. */
  heavyRunningElsewhere?: boolean;
}
export const NO_QUEUE_SIGNALS: LeaseQueueSignals = { holderJobs: 0, waiters: { count: 0, kinds: [] } };

export interface LeaseFacts {
  now: number;
  /** The holder's last action (a turn, a token, a key pressed, a renewal). Null when nothing was recorded. */
  lastEngagedAt: number | null;
  /** Requests on the leased tier still running. Never cut off. */
  inFlight: number;
  pinned: boolean;
  signals: LeaseQueueSignals;
}

export type HoldReason = "in_flight" | "holder_job" | "pinned" | "protected" | "grace" | "no_activity_recorded";
export type ReleaseReason = "waiter" | "idle" | "pin_cap";
export type LeaseDecision = { action: "hold"; reason: HoldReason } | { action: "release"; reason: ReleaseReason };

/** Milliseconds of quiet the lease may sit through right now: the pin cap, the long grace, or zero once a job waits for it. */
export function graceMsFor(key: LeaseKey, facts: Pick<LeaseFacts, "pinned" | "signals">, registry: LeaseRegistry = LEASE_REGISTRY): number {
  const config = registry[key];
  if (facts.pinned) return config.pinCapMs;
  return facts.signals.waiters.count > 0 ? 0 : config.graceMs;
}

/** Hold or release, evaluated between jobs. A lease with a request in flight or a job of the holder's is never released. */
export function decide(key: LeaseKey, facts: LeaseFacts, registry: LeaseRegistry = LEASE_REGISTRY): LeaseDecision {
  if (facts.inFlight > 0) return { action: "hold", reason: "in_flight" };
  if (facts.signals.holderJobs > 0) return { action: "hold", reason: "holder_job" };
  if (facts.lastEngagedAt === null) return { action: "hold", reason: "no_activity_recorded" };
  const quiet = facts.now - facts.lastEngagedAt;
  if (facts.pinned) return quiet < registry[key].pinCapMs ? { action: "hold", reason: "pinned" } : { action: "release", reason: "pin_cap" };
  if (facts.signals.waiters.count > 0) {
    return quiet < ENGAGED_PROTECTION_MS ? { action: "hold", reason: "protected" } : { action: "release", reason: "waiter" };
  }
  return quiet < registry[key].graceMs ? { action: "hold", reason: "grace" } : { action: "release", reason: "idle" };
}

/** Seconds until `decide` would release, or null when it will not release by time alone (a job runs or is held). */
export function releasesInSeconds(key: LeaseKey, facts: LeaseFacts, registry: LeaseRegistry = LEASE_REGISTRY): number | null {
  if (facts.inFlight > 0 || facts.signals.holderJobs > 0 || facts.lastEngagedAt === null) return null;
  const limit = facts.pinned ? registry[key].pinCapMs : facts.signals.waiters.count > 0 ? ENGAGED_PROTECTION_MS : registry[key].graceMs;
  return Math.max(0, Math.ceil((facts.lastEngagedAt + limit - facts.now) / 1000));
}

/** Only the holder renews a lease. An action with no person named is the driver's own (a request it started for the holder). */
export function mayRenew(holderId: string | null, actorId: string | undefined): boolean { return actorId === undefined || (holderId !== null && actorId === holderId); }

/** Every take is a queue job and never preempts: it waits while another person's heavy job runs. */
export function mayTake(signals: LeaseQueueSignals): boolean { return signals.heavyRunningElsewhere !== true; }
