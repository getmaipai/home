// TIER-LEASE-02 and TIER-LEASE-03 (queue side): remaining time on every job record, held_coding and paused acted on, Boost holds counted, Pause kept across a restart.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { codingMessages, codingSessions } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { createCodingSession, getCodingSession, settleSessionsAtStartup } from "@/lib/codingSessions";
import { codingQueueProvider, codingRemainingSeconds, CODING_TYPICAL_SECONDS, expirePausedSessions, pauseSession, resumeSession, sendMessage, submitTurn, turnFinished } from "@/lib/codingTurns";
import { admit, leaseQueueSignals, refreshHouseholdQueue, registerQueueProvider, resetTierStateForTests, writePositions, type QueueJob } from "@/lib/jobs/householdQueue";
import { jobQueueCopy } from "@/lib/jobQueueCopy";
import { decide } from "@/lib/tierLease/policy";
import { input, owner, settled, startRig } from "./codingRig";

const now = 1_000_000_000_000;
const job = (id: string, personId: string, jobClass: QueueJob["jobClass"], extra: Partial<QueueJob> = {}): QueueJob => ({ id, personId, jobClass, state: "queued", createdAt: now, ...extra });
const emptyTierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: null, chatLeaseHeld: false } as never;

describe("remaining time and the held_coding reason (pure queue)", () => {
  test("a running coding job reports time left, never below the floor", () => {
    expect(codingRemainingSeconds(now, now)).toBe(CODING_TYPICAL_SECONDS);
    expect(codingRemainingSeconds(now, now + 50_000)).toBe(CODING_TYPICAL_SECONDS - 50);
    expect(codingRemainingSeconds(now, now + 10 * 60_000)).toBe(30);
  });
  test("a queued picture behind a running Max coding turn is held as held_coding and gets a number", () => {
    const coding = job("code", "A", "other", { state: "running", tier: "max", category: "coding", typicalSeconds: 120, remainingSeconds: 90 });
    const picture = job("pic", "B", "picture", { typicalSeconds: 20 });
    expect(admit([coding, picture], now, { windowOpenFor: "code", startedSinceMax: [], lastMaxPersonId: null, chatLeaseHeld: false } as never)).toEqual({ start: [], holds: { pic: "held_coding" } });
    const jobs = [coding, picture];
    // the picture is the first waiter: the wait is the coding job's remaining time
    writePositions(jobs, now, () => undefined);
    expect(picture.estimateSeconds).toBe(90);
    const ahead = job("ahead", "C", "picture", { typicalSeconds: 40, createdAt: now - 5000 });
    writePositions([coding, ahead, picture], now, () => undefined);
    expect(picture.estimateSeconds).toBe(130);
  });
  test("a running job with no measured remaining time falls back to its typical time (here 120 s, and no typical time for the queued job before it)", () => {
    const running = job("run", "A", "other", { state: "running", tier: "max", category: "coding", typicalSeconds: 120 });
    const waiting = job("w", "B", "picture", { createdAt: now + 1 });
    writePositions([running, waiting], now, () => undefined);
    expect(waiting.estimateSeconds).toBe(120);
  });
  test("a Boost behind a running Boost coding turn is held as held_coding; behind a non-coding Boost it stays heavy_slot", () => {
    const codingBoost = job("cb", "A", "other", { state: "running", tier: "boost", category: "coding" });
    const qb = job("qb", "B", "picture", { tier: "boost" });
    expect(admit([codingBoost, qb], now, emptyTierState).holds).toEqual({ qb: "held_coding" });
    const pictureBoost = job("pb", "A", "picture", { state: "running", tier: "boost" });
    expect(admit([pictureBoost, qb], now, emptyTierState).holds).toEqual({ qb: "heavy_slot" });
  });
  test("the words carry the number and no person", () => {
    expect(jobQueueCopy("queued", "held_coding", 1, 120, "adult")).toBe("A coding job is running; this starts after it (about 2 minutes).");
    expect(jobQueueCopy("queued", "held_coding", 1, null, "adult")).toBe("A coding job is running; this starts after it.");
    expect(jobQueueCopy("queued", "held_coding", 1, 120, "child")).not.toMatch(/\d/);
  });
});

describe("a real coding turn in the household queue", () => {
  let rig: ReturnType<typeof startRig>;
  beforeEach(() => { resetTierStateForTests(); rig = startRig(); });
  afterEach(() => rig.restore());

  test("the running turn carries remainingSeconds; a picture behind it is counted as a waiter by kind only", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" }));
    const sent = submitTurn(boss, s.id, "go"); await settled();
    const running = codingQueueProvider().map((e) => e.job).find((j) => j.state === "running")!;
    expect(running.remainingSeconds).toBeGreaterThan(0);
    const queuedPicture: QueueJob = job("pic", "other-person", "picture", { riseReason: "held_coding" });
    registerQueueProvider(() => [{ job: queuedPicture, save: () => undefined }]);
    refreshHouseholdQueue();
    const signals = leaseQueueSignals(boss.id);
    expect(signals.waiters).toEqual({ count: 1, kinds: ["picture"] });
    expect(JSON.stringify(signals)).not.toContain("other-person");
    rig.agent.finishAll(); await turnFinished(sent.turn_id);
  });
});

describe("Pause and Resume", () => {
  let rig: ReturnType<typeof startRig>;
  beforeEach(() => { resetTierStateForTests(); rig = startRig(); });
  afterEach(() => rig.restore());

  test("pause during a turn never cuts it off: the turn finishes, then the session holds as paused, queued messages kept in the transcript", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" }));
    const sent = submitTurn(boss, s.id, "first"); await settled();
    sendMessage(boss, s.id, "typed while working");
    expect(pauseSession(boss, s.id)).toBe("pausing");
    expect(getCodingSession(boss, s.id)!.state).not.toBe("paused");
    rig.agent.finishAll(); await turnFinished(sent.turn_id); await settled();
    expect(getCodingSession(boss, s.id)!.state).toBe("paused");
    const texts = db.select().from(codingMessages).where(eq(codingMessages.sessionId, s.id)).all().map((m) => JSON.stringify(m.parts));
    expect(texts.some((t) => t.includes("typed while working"))).toBe(true);
    // paused is a queue record that holds nothing and does not keep the lease
    const paused = codingQueueProvider().map((e) => e.job).filter((j) => j.state === "paused");
    expect(paused).toHaveLength(1);
    expect(leaseQueueSignals(boss.id).pausedJobs).toBe(1);
    expect(leaseQueueSignals(boss.id).holderJobs).toBe(0);
  });
  test("a restart loses nothing: the paused state, transcript and tier are still there", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" }));
    expect(pauseSession(boss, s.id)).toBe("paused");
    settleSessionsAtStartup();
    expect(getCodingSession(boss, s.id)).toMatchObject({ state: "paused", tier: "max" });
  });
  test("resume is a queue job: a new queued turn, never a preemption", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "standard" }));
    pauseSession(boss, s.id);
    const resumed = resumeSession(boss, s.id)!;
    expect(resumed.turn_id).toBeTruthy();
    expect(getCodingSession(boss, s.id)!.state).not.toBe("paused");
    await settled(); rig.agent.finishAll(); await turnFinished(resumed.turn_id);
    expect(resumeSession(boss, s.id)).toBeNull(); // not paused any more
  });
  test("a pause ends by a setting: after the limit the session is idle again", () => {
    const boss = owner(); const s = createCodingSession(boss, input());
    pauseSession(boss, s.id);
    const at = Date.parse(db.select().from(codingSessions).where(eq(codingSessions.id, s.id)).get()!.lastActivityAt);
    expect(expirePausedSessions(at + 59 * 60_000)).toBe(0);
    expect(expirePausedSessions(at + 61 * 60_000)).toBe(1);
    expect(getCodingSession(boss, s.id)!.state).toBe("idle");
  });
  test("with the paused job gone, a waiting picture frees the lease at once (policy)", () => {
    const facts = { now, lastEngagedAt: now - 60_000, inFlight: 0, pinned: false };
    expect(decide("coding", { ...facts, signals: { holderJobs: 0, waiters: { count: 1, kinds: ["picture"] }, pausedJobs: 1 } }).action).toBe("release");
  });
});
