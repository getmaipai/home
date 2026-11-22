import { describe, expect, test } from "bun:test";
import { createChatLease, DEFAULT_LEASE } from "../src/lib/chatLease";
import { decide, ENGAGED_PROTECTION_MS, LEASE_REGISTRY, leaseKeyForCategory, mayRenew, mayTake, NO_QUEUE_SIGNALS, type LeaseQueueSignals } from "../src/lib/tierLease/policy";
import { leaseQueueSignals, registerQueueProvider, isolateQueueProvidersForTests, releaseHouseholdQueue, type QueueJob } from "../src/lib/jobs/householdQueue";

const owner = { id: "owner", role: "owner" } as const;
const other = { id: "other", role: "admin" } as const;
const waiting = (count = 1, kinds = ["picture"]): LeaseQueueSignals => ({ holderJobs: 0, waiters: { count, kinds } });

function rig(initial: LeaseQueueSignals = NO_QUEUE_SIGNALS) {
  let clock = 1_000_000;
  let signals = initial;
  const calls: string[] = [];
  const lease = createChatLease({
    now: () => clock,
    ready: async () => true,
    swapToBig: async () => { calls.push("big"); },
    swapToStandard: async () => { calls.push("standard"); },
    signals: () => signals,
  });
  return { lease, calls, advance: (ms: number) => { clock += ms; }, set: (next: LeaseQueueSignals) => { signals = next; } };
}

describe("tier lease policy (pure)", () => {
  const base = { now: 1_000_000, lastEngagedAt: 1_000_000, inFlight: 0, pinned: false, signals: NO_QUEUE_SIGNALS };
  test("holds while the holder has a job, whatever the quiet time", () => {
    expect(decide("coding", { ...base, now: base.now + 99 * 60_000, signals: { ...NO_QUEUE_SIGNALS, holderJobs: 1 } })).toEqual({ action: "hold", reason: "holder_job" });
    expect(decide("chat", { ...base, now: base.now + 99 * 60_000, inFlight: 1 })).toEqual({ action: "hold", reason: "in_flight" });
  });
  test("long grace with nobody waiting, per key", () => {
    expect(decide("chat", { ...base, now: base.now + LEASE_REGISTRY.chat.graceMs - 1 }).action).toBe("hold");
    expect(decide("chat", { ...base, now: base.now + LEASE_REGISTRY.chat.graceMs })).toEqual({ action: "release", reason: "idle" });
    expect(decide("coding", { ...base, now: base.now + 9 * 60_000 }).action).toBe("hold");
    expect(decide("coding", { ...base, now: base.now + 10 * 60_000 }).action).toBe("release");
  });
  test("zero grace once a job waits, but a key pressed in the last 10 s is finished first", () => {
    expect(decide("coding", { ...base, signals: waiting(), now: base.now + ENGAGED_PROTECTION_MS - 1 })).toEqual({ action: "hold", reason: "protected" });
    expect(decide("coding", { ...base, signals: waiting(), now: base.now + ENGAGED_PROTECTION_MS })).toEqual({ action: "release", reason: "waiter" });
  });
  test("a pinned lease keeps its cap whoever waits", () => {
    expect(decide("chat", { ...base, pinned: true, signals: waiting(), now: base.now + 3 * 60 * 60_000 }).action).toBe("hold");
    expect(decide("chat", { ...base, pinned: true, signals: waiting(), now: base.now + LEASE_REGISTRY.chat.pinCapMs })).toEqual({ action: "release", reason: "pin_cap" });
  });
  test("helpers", () => {
    expect(mayRenew("a", "a")).toBe(true);
    expect(mayRenew("a", "b")).toBe(false);
    expect(mayRenew("a", undefined)).toBe(true);
    expect(mayTake({ ...NO_QUEUE_SIGNALS, heavyRunningElsewhere: true })).toBe(false);
    expect(leaseKeyForCategory("coding")).toBe("coding");
    expect(leaseKeyForCategory("chat")).toBe("chat");
  });
});

describe("tier lease driver", () => {
  test("held through the long grace when nobody waits, released after it", async () => {
    const { lease, calls, advance } = rig();
    await lease.acquire(owner);
    advance(DEFAULT_LEASE.idleMs - 1000);
    expect(await lease.tick()).toBe(false);
    advance(1000);
    expect(await lease.tick()).toBe(true);
    expect(calls).toEqual(["big", "standard"]);
  });

  test("an idle holder is released at once when a job waits, after the 10 s protection", async () => {
    const { lease, calls, advance, set } = rig();
    await lease.acquire(owner);
    advance(2000);
    set(waiting());
    expect(await lease.tick()).toBe(false);
    expect(lease.snapshot().releasesInSeconds).toBe(8);
    expect(lease.snapshot().waiters).toEqual({ count: 1, kinds: ["picture"] });
    advance(8000);
    expect(await lease.tick()).toBe(true);
    expect(calls).toEqual(["big", "standard"]);
  });

  test("a running request or a holder job is never cut off, even with a waiter", async () => {
    const { lease, advance, set } = rig();
    await lease.acquire(owner);
    lease.requestStarted(owner.id);
    set(waiting());
    advance(60 * 60_000);
    expect(await lease.tick()).toBe(false);
    lease.requestEnded(owner.id);
    set({ ...waiting(), holderJobs: 1 });
    advance(60 * 60_000);
    expect(await lease.tick()).toBe(false);
    set(waiting());
    expect(await lease.tick()).toBe(true);
  });

  test("only the holder renews: another person's turn does not restart the grace, the holder's does", async () => {
    const { lease, advance } = rig();
    await lease.acquire(owner);
    advance(DEFAULT_LEASE.idleMs - 1000);
    lease.requestStarted(other.id);
    lease.requestEnded(other.id);
    lease.noteToken(other.id);
    expect(lease.touch(other.id)).toBe(false);
    advance(1000);
    expect(lease.snapshot().releasesInSeconds).toBe(0);
    expect(lease.touch(owner.id)).toBe(true);
    expect(lease.snapshot().releasesInSeconds).toBe(DEFAULT_LEASE.idleMs / 1000);
    advance(DEFAULT_LEASE.idleMs - 1000);
    lease.requestStarted(owner.id);
    lease.requestEnded(owner.id);
    expect(lease.snapshot().releasesInSeconds).toBe(DEFAULT_LEASE.idleMs / 1000);
  });

  test("a wake is a take: it waits while another person's heavy job runs and never preempts the holder", async () => {
    const { lease, calls, advance, set } = rig();
    await lease.acquire(owner);
    expect(await lease.acquire(other)).toEqual({ ok: false, refusal: "stack_busy" });
    advance(DEFAULT_LEASE.idleMs);
    await lease.tick();
    set({ ...NO_QUEUE_SIGNALS, heavyRunningElsewhere: true });
    expect(await lease.acquire(owner)).toEqual({ ok: false, refusal: "stack_busy" });
    expect(calls).toEqual(["big", "standard"]);
    set(NO_QUEUE_SIGNALS);
    expect(await lease.acquire(owner)).toEqual({ ok: true, state: "held" });
    expect(calls).toEqual(["big", "standard", "big"]);
  });

  test("a pinned lease keeps its 4 hour cap with a waiter, and the coding key has its own grace", async () => {
    const { lease, advance, set } = rig();
    await lease.acquire(owner, { pinned: true });
    set(waiting());
    advance(3 * 60 * 60_000);
    expect(await lease.tick()).toBe(false);
    advance(DEFAULT_LEASE.pinCapMs);
    expect(await lease.tick()).toBe(true);

    const coding = rig();
    await coding.lease.acquire(owner, { category: "coding" });
    expect(coding.lease.snapshot().key).toBe("coding");
    coding.advance(9 * 60_000);
    expect(await coding.lease.tick()).toBe(false);
    coding.advance(60_000);
    expect(await coding.lease.tick()).toBe(true);
  });
});

describe("queue signals", () => {
  test("holder jobs, waiters and heavy jobs elsewhere come out as counts and kinds", async () => {
    const restore = isolateQueueProvidersForTests();
    const mk = (job: Partial<QueueJob> & { id: string }): { job: QueueJob; save: () => void } => ({ job: { personId: "p", jobClass: "picture", state: "queued", createdAt: 1, ...job } as QueueJob, save: () => undefined });
    const entries = [
      mk({ id: "a", state: "running", tier: "max", ownsChatLease: true, personId: "owner", jobClass: "other" }),
      mk({ id: "b", state: "queued", tier: "boost", riseReason: "max_chat", category: "image" as never }),
      mk({ id: "c", state: "running", tier: "boost", personId: "someone" }),
    ];
    const off = registerQueueProvider(() => entries as never);
    await releaseHouseholdQueue();
    const signals = leaseQueueSignals("owner");
    expect(signals.holderJobs).toBe(1);
    expect(signals.heavyRunningElsewhere).toBe(true);
    expect(JSON.stringify(signals)).not.toContain("someone");
    off(); restore();
  });
});
