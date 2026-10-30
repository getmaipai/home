import { describe, expect, test } from "bun:test";
import { db } from "../src/db";
import { notificationDeliveries } from "../src/db/schema";
import { resetFitMemoryForTests, requestTier, resetTierStateForTests, setBudgetReader, trackChatLease, DEFAULT_QUIET, chatActivity, decideDownshift, mayRestoreNow, noteChatInFlight, noteChatTurn, quietSecondsFor, resetChatActivityForTests, admit, order, recordUsage, usageLastHour, requeueAfterCritical, registerQueueProvider, releaseHouseholdQueue, stillRunningMinutes, writePositions, type QueueJob, type TierState } from "../src/lib/jobs/householdQueue";
import { DEFAULT_POLICY } from "../src/lib/jobs/jobScore";
import { setProfileSource, type ProfileSource } from "../src/lib/jobs/admissionFit";
import type { ProfileRow } from "../src/lib/jobs/profileTable";

const now = Date.parse("2026-10-25T12:00:00.000Z");
const emptyTierState: TierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: null };
function job(id: string, personId: string, jobClass: QueueJob["jobClass"], createdAt: number, extra: Partial<QueueJob> = {}): QueueJob {
  return { id, personId, jobClass, state: "queued", createdAt, ...extra };
}

describe("household queue", () => {
  test("fit admission gates Max release, persists counts, and leaves Standard unchanged", async () => {
    const maxRow: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "standard" }, video: { state: "max" }, picture: { state: "max" }, voice: { state: "standard" } } };
    const boostRow: ProfileRow = { ...maxRow, tier: "boost", cells: { ...maxRow.cells, video: { state: "boost" } } };
    const base = { budgetGb: 80, marginGb: 2, peakGb: { video: { max: 60, boost: 45, standard: 35 } }, residentGb: { chat: { standard: 1 }, picture: { boost: 2, standard: 5 }, voice: { standard: 1 } } };
    const configured: ProfileSource = { table: [maxRow, boostRow], hw: base, pins: {}, priorityWeight: { picture: 1 }, lowerWithoutAsking: { video: true } };
    const run = async (tier: "max" | "standard", free: number) => {
      const j = job(`j-${tier}-${free}`, `p-${tier}-${free}`, "video", now, { tier });
      let calls = 0; let applied: NonNullable<QueueJob["fit"]> | undefined;
      let released = 0;
      const remove = registerQueueProvider(() => [{ job: j, save: () => undefined, applyFit: (fit) => { applied = fit; }, release: async () => { released += 1; } }]);
      setBudgetReader(async () => { calls += 1; return { freeMemoryBytes: free * 1e9, loaded: [] }; });
      try { await releaseHouseholdQueue(); return { j, calls, applied, released }; }
      finally { remove(); }
    };
    resetTierStateForTests(); setProfileSource(configured);
    try {
      const fitting = await run("max", 62);
      expect(fitting.released).toBe(1);
      expect(fitting.applied?.outcome).toBe("run");
      expect(fitting.applied?.profile).toEqual({ lowered: 1, queued: 0, off: 0, closed_apps: 0, closed_bytes: 0 });
      expect(Object.keys(fitting.applied!.profile).sort()).toEqual(["closed_apps", "closed_bytes", "lowered", "off", "queued"]);
      const askSource = { ...configured, lowerWithoutAsking: {} };
      setProfileSource(askSource);
      const asking = await run("max", 50);
      expect(asking.released).toBe(0); expect(asking.applied?.outcome).toBe("ask");
      expect(asking.applied?.profile.lowered).toBe(1);
      const queueSource: ProfileSource = { ...configured, hw: { ...base, budgetGb: 80, peakGb: { video: { max: 60, boost: 60, standard: 25 } }, residentGb: { ...base.residentGb, picture: { boost: 2, standard: 1, reduced: 0 } } }, table: [maxRow, { ...boostRow, cells: { ...boostRow.cells, picture: { state: "standard" } } }] };
      setProfileSource(queueSource);
      const queued = await run("max", 30);
      expect(queued.released).toBe(0); expect(queued.applied?.outcome).toBe("queue");
      setProfileSource(configured);
      const standard = await run("standard", 1);
      expect(standard.released).toBe(1); expect(standard.calls).toBe(0); expect(standard.applied).toBeUndefined();
      setProfileSource(null);
      const unconfigured = await run("max", 1);
      expect(unconfigured.released).toBe(1);
    } finally { setProfileSource(null); setBudgetReader(null); resetTierStateForTests(); }
  });
  test("a waiting ask is saved once, not on every release pass, and does not block its kind or the fairness memory", async () => {
    resetTierStateForTests(); resetFitMemoryForTests();
    const maxRow: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "standard" }, video: { state: "max" }, voice: { state: "standard" } } };
    const boostRow: ProfileRow = { ...maxRow, tier: "boost", cells: { ...maxRow.cells, video: { state: "boost" } } };
    const hw = { budgetGb: 80, marginGb: 2, peakGb: { video: { max: 60, boost: 45 } }, residentGb: { chat: { standard: 1 }, voice: { standard: 1 } } };
    setProfileSource({ table: [maxRow, boostRow], hw, pins: {}, priorityWeight: {}, lowerWithoutAsking: {} });
    setBudgetReader(async () => ({ freeMemoryBytes: 50e9, loaded: [] }));
    const waiting = job("ask-1", "Z", "video", now, { tier: "max" });
    let saves = 0;
    const remove = registerQueueProvider(() => [{ job: waiting, save: () => undefined, applyFit: () => { saves += 1; }, release: async () => undefined }]);
    try {
      await releaseHouseholdQueue(); await releaseHouseholdQueue();
      expect(saves).toBe(1);
    } finally { remove(); setProfileSource(null); setBudgetReader(null); resetTierStateForTests(); resetFitMemoryForTests(); }
  });
  test("orders by score and uses oldest-waiting round robin only for ties", () => {
    const jobs = [job("a1", "A", "picture", now - 4000), job("a2", "A", "picture", now - 3000), job("a3", "A", "picture", now - 2000), job("b1", "B", "picture", now - 1000)];
    expect(order(jobs, now)).toEqual([{ id: "a1", position: 1 }, { id: "a2", position: 2 }, { id: "a3", position: 3 }, { id: "b1", position: 4 }]);
  });

  test("releases Stack submissions in score order, one unstarted job per kind", async () => {
    const entries = [
      { job: job("a1", "A", "picture", now - 4000), waiting: false },
      { job: job("a2", "A", "picture", now - 3000), waiting: false },
      { job: job("a3", "A", "picture", now - 2000), waiting: false },
      { job: job("b1", "B", "picture", now - 1000), waiting: false },
    ];
    const submitted: string[] = [];
    const remove = registerQueueProvider(() => entries.map((entry) => ({
      job: entry.job,
      stackWaiting: entry.waiting,
      release: entry.job.state === "queued" && !entry.waiting ? async () => { entry.waiting = true; submitted.push(entry.job.id); } : undefined,
      save: () => undefined,
    })));
    try {
      await releaseHouseholdQueue();
      entries[0]!.job.state = "running";
      entries[0]!.waiting = false;
      await releaseHouseholdQueue();
      entries[0]!.job.state = "done";
      entries[3]!.job.state = "running";
      entries[3]!.waiting = false;
      await releaseHouseholdQueue();
      entries[1]!.job.state = "done";
      entries[1]!.waiting = false;
      entries[3]!.job.state = "done";
      await releaseHouseholdQueue();
      expect(submitted).toEqual(["a1", "b1", "a2", "a3"]);
    } finally { remove(); }
  });

  test("a cancelled held job is never released to Stack", async () => {
    const held = job("held", "A", "video", now - 1000);
    held.state = "cancelled";
    let submits = 0;
    const remove = registerQueueProvider(() => [{ job: held, save: () => undefined,
      release: held.state === "queued" ? async () => { submits += 1; } : undefined }]);
    try { await releaseHouseholdQueue(); expect(submits).toBe(0); }
    finally { remove(); }
  });

  test("smooth aging moves a video toward the next class weight", () => {
    const picture = job("picture", "A", "picture", now - 1000);
    const video = job("video", "B", "video", now - 10 * 60_000 + 1);
    expect(order([picture, video], now).map((item) => item.id)).toEqual(["picture", "video"]);
    video.createdAt = now - 10 * 60_000;
    expect(order([picture, video], now).map((item) => item.id)).toEqual(["picture", "video"]);
  });

  test("ages a Max video smoothly without jumping the picture score", () => {
    const picture = job("picture", "A", "picture", now - 1000);
    const maxVideo = job("max-video", "B", "video", now - 10 * 60_000, { tier: "max" });
    expect(order([picture, maxVideo], now).map((item) => item.id)).toEqual(["picture", "max-video"]);
  });

  test("T1 permits only one running Boost or Max job, leaving Standard unaffected", () => {
    const runningBoost = job("rb", "A", "other", now, { tier: "boost", state: "running" });
    const queuedBoost = job("qb", "B", "picture", now, { tier: "boost" });
    const standard = job("s", "C", "video", now, { tier: "standard" });
    expect(admit([runningBoost, queuedBoost, standard], now, emptyTierState)).toEqual({ start: ["s"], holds: { qb: "heavy_slot" } });
  });

  test("T2 drains running work for the first Max and holds admissions behind it", () => {
    const running = job("run", "A", "other", now, { state: "running" });
    const max = job("max", "B", "video", now, { tier: "max" });
    const after = job("after", "C", "other", now + 1);
    expect(admit([running, max, after], now, emptyTierState)).toEqual({ start: [], holds: { max: "max_drain", after: "max_drain" } });
  });

  test("T3 open Max window holds every other queued job", () => {
    const max = job("max", "A", "video", now, { state: "running", tier: "max" });
    const standard = job("standard", "B", "picture", now);
    expect(admit([max, standard], now, { ...emptyTierState, windowOpenFor: "max" })).toEqual({ start: [], holds: { standard: "max_window" } });
  });

  test("T4a Max does not jump queued jobs ahead of it", () => {
    const ahead = job("ahead", "A", "picture", now);
    const max = job("max", "B", "video", now, { tier: "max" });
    expect(admit([ahead, max], now, emptyTierState)).toEqual({ start: ["ahead"], holds: { max: "max_drain" } });
    const behind = job("behind", "C", "other", now + 1);
    expect(admit([ahead, max, behind], now + 1, emptyTierState)).toEqual({ start: ["ahead"], holds: { max: "max_drain", behind: "max_drain" } });
  });

  test("T4b waits for other people's first queued non-Max jobs before another Max", () => {
    const max = job("max", "A", "video", now, { tier: "max" });
    const nonMax = job("other-job", "B", "picture", now + 1);
    const state: TierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: "A" };
    expect(admit([max, nonMax], now, state)).toEqual({ start: ["other-job"], holds: { max: "fairness_wait" } });
  });

  test("over-estimate running Max work does not cancel or alter other admissions", () => {
    const max = job("max", "A", "other", now, { state: "running", tier: "max", remainingSeconds: 601 });
    const standard = job("standard", "B", "picture", now);
    expect(stillRunningMinutes(max)).toBe(11);
    expect(admit([max, standard], now, emptyTierState)).toEqual({ start: ["standard"], holds: {} });
    expect(max.state).toBe("running");
  });

  test("T5 requeues twice before low-memory failure", () => {
    expect(requeueAfterCritical({ requeues: 0 })).toBe("requeue_head");
    expect(requeueAfterCritical({ requeues: 1 })).toBe("requeue_head");
    expect(requeueAfterCritical({ requeues: 2 })).toBe("fail_low_memory");
  });

  test("still running estimate is only shown for running jobs past their estimate", () => {
    expect(stillRunningMinutes(job("queued", "A", "picture", now, { remainingSeconds: 61 }))).toBeNull();
    expect(stillRunningMinutes(job("running", "A", "picture", now, { state: "running", remainingSeconds: 60 }))).toBe(1);
    expect(stillRunningMinutes(job("no-estimate", "A", "picture", now, { state: "running" }))).toBeNull();
  });

  test("backfills a fitting picture beside a paused clip", () => {
    const clip = job("clip", "A", "video", now - 11 * 60_000, { resourcePaused: true, remainingSeconds: 50 });
    const fitting = job("fitting", "B", "picture", now - 1000, { backfillFits: true, typicalSeconds: 20 });
    const tooLarge = job("large", "C", "picture", now - 500, { backfillFits: false, typicalSeconds: 90 });
    expect(order([clip, fitting], now).map((item) => item.id)).toEqual(["fitting", "clip"]);
    expect(order([clip, tooLarge], now).map((item) => item.id)).toEqual(["large", "clip"]);
  });

  test("score ties interleave people based on the oldest waiting job", () => {
    const jobs = Array.from({ length: 20 }, (_, index) => job(`a${index}`, "A", "picture", now - 20_000 + index))
      .concat(job("b1", "B", "picture", now - 1000));
    expect(order(jobs, now)[1]).toEqual({ id: "a1", position: 2 });
  });

  test("class score lets a first picture or video pass a heavy user's repeated videos", () => {
    const jobs = Array.from({ length: 6 }, (_, i) => job(`heavy-${i}`, "Heavy Name", "video", now - 6000 + i))
      .concat(job("new-picture", "New Person", "picture", now), job("new-video", "New Person", "video", now));
    expect(order(jobs, now, { "Heavy Name": DEFAULT_POLICY.fairShareMax * 5 }).map((item) => item.id)[0]).toBe("new-picture");
    expect(order(jobs.filter((item) => item.id !== "new-picture"), now, { "Heavy Name": 100 }).map((item) => item.id)[0]).toBe("new-video");
  });

  test("same-score ties use the oldest waiting person", () => {
    const jobs = [job("new", "B", "video", now - 1000), job("old", "A", "video", now - 2000)];
    expect(order(jobs, now).map((item) => item.id)).toEqual(["old", "new"]);
  });

  test("music aging reaches the video weight gap exactly, and can be delayed", () => {
    const music = job("music", "M", "other", now - 10 * 60_000, { category: "music" });
    const video = job("video", "V", "video", now);
    expect(order([video, music], now).map((item) => item.id)).toEqual(["music", "video"]);
    expect(order([video, { ...music, createdAt: now - 9 * 60_000 }], now).map((item) => item.id)).toEqual(["video", "music"]);
  });

  test("head requeues stay first and capped children are excluded", () => {
    const regular = job("regular", "A", "picture", now - 1000);
    const head = job("head", "B", "other", now, { headOfClass: true });
    const capped = job("capped", "C", "picture", now, { childDailyCapReached: true });
    expect(order([regular, head, capped], now).map((item) => item.id)).toEqual(["head", "regular"]);
  });

  test("usage ledger drops credits older than an hour", () => {
    recordUsage("ledger-person", 12, now - 3_600_001);
    recordUsage("ledger-person", 5, now - 1000);
    expect(usageLastHour(now)["ledger-person"]).toBe(5);
  });

  test("explains a number that rises when another person's first job joins the class", () => {
    const jobs = [job("a1", "A", "picture", now - 3000), job("a2", "A", "picture", now - 2000), job("a3", "A", "picture", now - 1000)];
    writePositions(jobs, now, () => undefined);
    const other = job("b1", "B", "picture", now);
    writePositions([...jobs, other], now, () => undefined);
    expect(jobs[1]!.position).toBe(2);
    expect(jobs[1]!.riseReason).toBeNull();
  });

  test("explains score overtakes using the deciding generic reason", () => {
    const classJobs = [job("v", "video-person", "video", now - 3000, { position: 1 }), job("m", "music-person", "other", now - 2000, { category: "music", position: 2 })];
    const picture = job("p", "picture-person", "picture", now, { position: 2 });
    writePositions([...classJobs, picture], now, () => undefined);
    expect(classJobs[0]!.riseReason).toBe("class");

    recordUsage("Known Person", 600, now);
    recordUsage("Other Known", 300, now);
    const fairJobs = [job("used", "Known Person", "video", now - 3000, { position: 1 }), job("plain", "Other Known", "video", now - 2000, { position: 2 })];
    const lessUsed = job("fresh", "Fresh Name", "video", now, { position: 3 });
    writePositions([...fairJobs, lessUsed], now, () => undefined);
    expect(fairJobs[0]!.riseReason).toBe("fair_share");
  });

  test("writes live positions and a rise reason, then drops positions when the head starts", () => {
    const jobs = [job("v1", "A", "video", now - 3000), job("v2", "B", "video", now - 2000), job("v3", "C", "video", now - 1000)];
    writePositions(jobs, now, (item) => undefined);
    expect(jobs.map((item) => item.position)).toEqual([1, 2, 3]);
    const picture = job("p1", "D", "picture", now);
    writePositions([...jobs, picture], now, (item) => undefined);
    expect(jobs[1]!.position).toBe(3);
    expect(jobs[1]!.riseReason).toBe("class");
    jobs[0]!.state = "running";
    writePositions([...jobs, picture], now, (item) => undefined);
    expect(jobs.slice(1).map((item) => item.position)).toEqual([2, 3]);
    expect(jobs[0]!.position).toBeNull();
  });

  test("only invokes the job store hook and never a notification hook", () => {
    const writes: string[] = [];
    const notificationsBefore = db.select({ id: notificationDeliveries.id }).from(notificationDeliveries).all();
    writePositions([job("one", "A", "picture", now)], now, (item) => writes.push(item.id));
    expect(writes).toEqual(["one"]);
    expect(db.select({ id: notificationDeliveries.id }).from(notificationDeliveries).all()).toEqual(notificationsBefore);
  });

  describe("quiet window and cooldown", () => {
    const base = { requestedAt: now, restoredAt: null, reducedNow: false, lastJobEndedAt: null };
    const decide = (at: number, extra: Partial<Parameters<typeof decideDownshift>[0]> = {}) =>
      decideDownshift({ now: at, requesterId: "R", config: DEFAULT_QUIET, activity: chatActivity(), state: base, atTurnBoundary: false, ...extra });
    test("a second person chatting at second 50 delays, at second 61 it proceeds", () => {
      resetChatActivityForTests();
      noteChatTurn("S", now);
      expect(decide(now + 50_000)).toMatchObject({ action: "wait", reason: "quiet_wait" });
      expect(decide(now + 61_000)).toMatchObject({ action: "go" });
    });
    test("the requester's own turn does not block, an in-flight turn does", () => {
      resetChatActivityForTests();
      noteChatTurn("R", now);
      expect(decide(now + 1000).action).toBe("go");
      noteChatInFlight(1);
      expect(decide(now + 1000).action).toBe("wait");
      noteChatInFlight(-1);
      expect(chatActivity().inFlight).toBe(0);
    });
    test("after quiet_max_wait it goes only at a turn boundary, never when set to never", () => {
      resetChatActivityForTests();
      noteChatTurn("S", now + 599_000);
      expect(decide(now + 600_000)).toMatchObject({ action: "wait", reason: "turn_boundary" });
      expect(decide(now + 600_000, { atTurnBoundary: true })).toMatchObject({ action: "go" });
      const never = { ...DEFAULT_QUIET, quietMaxWaitSeconds: "never" as const };
      noteChatTurn("S", now + 5_990_000);
      expect(decide(now + 6_000_000, { config: never, atTurnBoundary: true })).toMatchObject({ action: "wait", reason: "quiet_wait" });
    });
    test("cooldown blocks a re-lower for 300 s except a chained job", () => {
      resetChatActivityForTests();
      const state = { ...base, restoredAt: now };
      expect(decide(now + 299_000, { state })).toMatchObject({ action: "wait", reason: "cooldown" });
      expect(decide(now + 301_000, { state }).action).toBe("go");
      const chained = { requestedAt: now, restoredAt: null, reducedNow: true, lastJobEndedAt: now };
      expect(decide(now + 100_000, { state: chained, chainedWindow: true })).toEqual({ action: "go", reason: null, waitedSeconds: 100 });
    });
    test("quiet seconds clamp to 20, only chat has a window, restore needs a turn boundary", () => {
      resetChatActivityForTests();
      noteChatTurn("S", now);
      expect(decide(now + 19_000, { config: { ...DEFAULT_QUIET, quietSeconds: 5 } }).action).toBe("wait");
      expect(decide(now + 21_000, { config: { ...DEFAULT_QUIET, quietSeconds: 5 } }).action).toBe("go");
      expect(quietSecondsFor("chat", { ...DEFAULT_QUIET, quietSeconds: 5 })).toBe(20);
      expect(quietSecondsFor("video", DEFAULT_QUIET)).toBe(0);
      expect(mayRestoreNow({ reducedNow: true }, false)).toBe(false);
      expect(mayRestoreNow({ reducedNow: true }, true)).toBe(true);
    });
  });

  describe("tier wiring", () => {
    test("requestTier reads boost and max, everything else is standard", () => {
      expect(requestTier({ tier: "max" })).toBe("max");
      expect(requestTier({ tier: "boost" })).toBe("boost");
      expect(requestTier({ tier: "gold" })).toBe("standard");
      expect(requestTier(null)).toBe("standard");
    });

    test("trackChatLease counts the turn in flight and releases it once", () => {
      resetChatActivityForTests();
      let releases = 0;
      const lease = trackChatLease("P", { release: () => { releases += 1; } }, now);
      expect(chatActivity().inFlight).toBe(1);
      expect(chatActivity().lastTurnAtByPerson.P).toBe(now);
      lease.release(); lease.release();
      expect(chatActivity().inFlight).toBe(0);
      expect(releases).toBe(2);
    });

    test("releaseHouseholdQueue holds a Max job while another job runs and sends it once the household is idle", async () => {
      resetTierStateForTests();
      const running = job("run", "A", "picture", now - 5000, { state: "running" });
      const max = job("max", "B", "video", now - 4000, { tier: "max" });
      const behind = job("behind", "C", "picture", now - 3000);
      const submitted: string[] = [];
      const entries = [running, max, behind].map((j) => ({ job: j, sent: false }));
      const remove = registerQueueProvider(() => entries.map((e) => ({ job: e.job, stackWaiting: false,
        release: e.job.state === "queued" && !e.sent ? async () => { e.sent = true; submitted.push(e.job.id); } : undefined, save: () => undefined })));
      try {
        await releaseHouseholdQueue();
        expect(submitted).toEqual([]);
        running.state = "done";
        await releaseHouseholdQueue();
        expect(submitted).toEqual(["max"]);
      } finally { remove(); resetTierStateForTests(); }
    });
  });
});
