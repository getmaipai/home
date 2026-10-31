import { describe, expect, test } from "bun:test";
import { createChatLease, DEFAULT_LEASE } from "../src/lib/chatLease";
import { admit, type QueueJob, type TierState } from "../src/lib/jobs/householdQueue";

const owner = { id: "owner", role: "owner" } as const;
const child = { id: "kid", role: "child" } as const;
const teen = { id: "teen", role: "teen" } as const;

function rig(over: { ready?: boolean; failBig?: boolean } = {}) {
  let clock = 1_000_000;
  const calls: string[] = [];
  const lease = createChatLease({
    now: () => clock,
    ready: async () => over.ready ?? true,
    swapToBig: async () => { calls.push("big"); if (over.failBig) throw new Error("post-load check failed"); },
    swapToStandard: async () => { calls.push("standard"); },
  });
  return { lease, calls, advance: (ms: number) => { clock += ms; } };
}

describe("Max chat lease", () => {
  test("an admin takes it, the swap runs once, and generators are held", async () => {
    const { lease, calls } = rig();
    expect(lease.holdsGenerators()).toBe(false);
    expect(await lease.acquire(owner)).toEqual({ ok: true, state: "held" });
    expect(calls).toEqual(["big"]);
    expect(lease.holdsGenerators()).toBe(true);
    expect(await lease.acquire(owner)).toEqual({ ok: true, state: "held" });
    expect(calls).toEqual(["big"]);
  });

  test("a child and a teen never hold Max chat, and nothing is swapped", async () => {
    const { lease, calls } = rig();
    expect(await lease.acquire(child)).toEqual({ ok: false, refusal: "not_a_holder" });
    expect(await lease.acquire(teen)).toEqual({ ok: false, refusal: "not_a_holder" });
    expect(calls).toEqual([]);
    expect(lease.snapshot().state).toBe("off");
  });

  test("an unready machine is refused before any swap", async () => {
    const { lease, calls } = rig({ ready: false });
    expect(await lease.acquire(owner)).toEqual({ ok: false, refusal: "not_ready" });
    expect(calls).toEqual([]);
  });

  test("a failed swap leaves the lease off and generators free", async () => {
    const { lease } = rig({ failBig: true });
    expect(await lease.acquire(owner)).toEqual({ ok: false, refusal: "swap_failed" });
    expect(lease.snapshot().state).toBe("off");
    expect(lease.holdsGenerators()).toBe(false);
  });

  test("a second person is told the Stack is busy while the lease is held", async () => {
    const { lease } = rig();
    await lease.acquire(owner);
    expect(await lease.acquire({ id: "other", role: "admin" })).toEqual({ ok: false, refusal: "stack_busy" });
  });

  test("idle release after 30 minutes, counted from the last token", async () => {
    const { lease, calls, advance } = rig();
    await lease.acquire(owner);
    advance(DEFAULT_LEASE.idleMs - 1000);
    lease.noteToken();
    advance(DEFAULT_LEASE.idleMs - 1000);
    expect(await lease.tick()).toBe(false);
    expect(lease.snapshot().releasesInSeconds).toBe(1);
    advance(1000);
    expect(await lease.tick()).toBe(true);
    expect(calls).toEqual(["big", "standard"]);
    expect(lease.snapshot().state).toBe("off");
    expect(lease.holdsGenerators()).toBe(false);
  });

  test("a request in flight keeps the lease however long the timer says", async () => {
    const { lease, calls, advance } = rig();
    await lease.acquire(owner);
    lease.requestStarted();
    advance(DEFAULT_LEASE.idleMs * 3);
    expect(await lease.tick()).toBe(false);
    expect(lease.snapshot().releasesInSeconds).toBeNull();
    lease.requestEnded();
    expect(await lease.tick()).toBe(false);
    advance(DEFAULT_LEASE.idleMs);
    expect(await lease.tick()).toBe(true);
    expect(calls).toEqual(["big", "standard"]);
  });

  test("a pinned lease lasts 4 hours of quiet, and only an admin can pin", async () => {
    const { lease, advance } = rig();
    await lease.acquire(owner, { pinned: true });
    expect(lease.snapshot().pinned).toBe(true);
    advance(DEFAULT_LEASE.idleMs * 2);
    expect(await lease.tick()).toBe(false);
    advance(DEFAULT_LEASE.pinCapMs);
    expect(await lease.tick()).toBe(true);
  });

  test("a watchdog eviction drops the lease so generators are not held", async () => {
    const { lease } = rig();
    await lease.acquire(owner);
    lease.evicted();
    expect(lease.snapshot().state).toBe("off");
    expect(lease.holdsGenerators()).toBe(false);
  });
});

describe("max_chat admission hold", () => {
  const now = 1_000_000;
  const job = (id: string, tier: QueueJob["tier"], jobClass: QueueJob["jobClass"] = "video"): QueueJob => ({
    id, personId: id, jobClass, createdAt: now - 1000, state: "queued", tier, requeues: 0, estimateSeconds: null, position: 0, riseReason: null,
  } as unknown as QueueJob);
  const base: TierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: null };

  test("Boost and Max wait with max_chat; Standard still starts", () => {
    const result = admit([job("b", "boost"), job("m", "max"), job("s", "standard", "picture")], now, { ...base, chatLeaseHeld: true });
    expect(result.start).toEqual(["s"]);
    expect(result.holds).toEqual({ b: "max_chat", m: "max_chat" });
  });

  test("without a lease nothing is held for chat", () => {
    expect(admit([job("b", "boost")], now, base).holds).toEqual({});
  });
});
