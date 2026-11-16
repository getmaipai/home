// TIER-BOOST-HOLD-01: a Boost job with no known peak is guessed, never refused, and a held job waits a bounded time, then runs at Standard.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fitForAdmission, resetFitHysteresisForTests, setProfileSource, type ProfileSource } from "../src/lib/jobs/admissionFit";
import { hardwareFromBudget } from "../src/lib/jobs/profileSource";
import { needGb } from "../src/lib/jobs/liveFit";
import type { ProfileRow } from "../src/lib/jobs/profileTable";
import { isolateQueueProvidersForTests, registerQueueProvider, releaseHouseholdQueue, resetFitMemoryForTests, resetTierStateForTests, setBudgetReader, setNoRoomRecheckForTests, setQuietConfigSource, DEFAULT_QUIET, type QueueJob } from "../src/lib/jobs/householdQueue";
import { waitedForRoomLine } from "../src/lib/fitWording";

const row = (tier: "boost" | "standard", lead: "video" | "picture" = "video"): ProfileRow => ({ lead, tier, cells: { chat: { state: "standard" }, [lead]: { state: tier } } });
const table = [row("boost"), row("standard"), row("boost", "picture"), row("standard", "picture")];
const source = (peakGb: ProfileSource["hw"]["peakGb"]): ProfileSource => ({ table, hw: { budgetGb: 80, marginGb: 2, peakGb, residentGb: { chat: { standard: 1 } } }, pins: {}, priorityWeight: {}, lowerWithoutAsking: {} });
const noBoostPeak = source({ video: { standard: 25 }, picture: { boost: 30, standard: 10 } });
// The working margin (2 GB) comes off what the Stack reads free.
const free = (roomGb: number) => async () => ({ freeMemoryBytes: (roomGb + 2) * 1e9, loaded: [] });
// Other queue tests leave providers registered; this file sees only its own.
let restoreProviders: () => void = () => undefined;
beforeEach(() => { restoreProviders = isolateQueueProvidersForTests(); });
afterEach(() => { restoreProviders(); setProfileSource(null); setBudgetReader(null); setQuietConfigSource(null); setNoRoomRecheckForTests(null); resetFitHysteresisForTests(); resetFitMemoryForTests(); resetTierStateForTests(); });

describe("a missing peak is a guess, not Infinity", () => {
  test("needGb uses the Standard peak plus resident cells, else the Boost cap, and an unknown resident counts 0", () => {
    expect(needGb(row("boost"), noBoostPeak.hw)).toBe(26);
    expect(needGb(row("boost"), { ...noBoostPeak.hw, peakGb: {} })).toBeCloseTo(0.85 * 78 + 1);
    expect(needGb(row("boost"), { ...noBoostPeak.hw, residentGb: {} })).toBe(25);
    expect(needGb(row("standard"), { ...noBoostPeak.hw, peakGb: {} })).toBe(Infinity); // only a Boost lead is guessed
  });
  test("(a) room 41 GB: run, basis cap_guess, no refusal", async () => {
    setProfileSource(noBoostPeak);
    const fit = await fitForAdmission({ jobClass: "video", tier: "boost" }, free(41));
    expect(fit?.outcome).toBe("run");
    expect(fit?.basis).toBe("cap_guess");
  });
  test("(b) room 10 GB: queue, never refuse", async () => {
    setProfileSource(noBoostPeak);
    const fit = await fitForAdmission({ jobClass: "video", tier: "boost" }, free(10));
    expect(fit?.outcome).toBe("queue");
    expect(fit?.basis).toBe("cap_guess");
  });
  test("a partial figure (unknown resident) never refuses either", async () => {
    setProfileSource({ ...noBoostPeak, hw: { ...noBoostPeak.hw, peakGb: { video: { boost: 30, standard: 30 } }, residentGb: {} } });
    const fit = await fitForAdmission({ jobClass: "video", tier: "boost" }, free(10));
    expect(fit?.outcome).toBe("queue");
    expect(fit?.basis).toBe("partial");
  });
  test("(d) a Boost picture with a known peak keeps today's outcomes", async () => {
    setProfileSource(noBoostPeak);
    const run = await fitForAdmission({ jobClass: "picture", tier: "boost" }, free(60));
    expect(run).toMatchObject({ outcome: "run", basis: "exact", needGb: 31 });
    const lowered = await fitForAdmission({ jobClass: "picture", tier: "boost" }, free(20));
    expect(lowered?.outcome).toBe("ask");
    expect(lowered?.leadTier).toBe("standard");
    const queued = await fitForAdmission({ jobClass: "picture", tier: "boost" }, free(5));
    expect(queued?.outcome).toBe("queue");
  });
});

describe("the Stack's budget reader (null slots, voice, fits_ever)", () => {
  const gib = 1_073_741_824;
  const base = { totalMemoryBytes: 64 * gib, capBytes: 60 * gib, freeMemoryBytes: 0, availablePercent: 0, pressure: "normal" as const, memoryReadingDegraded: false, margin_bytes: 2 * gib, loaded: [], queue: [] };
  test("a null-model Boost video slot gives a Boost video need by the guess rule; voice and stems are ignored", () => {
    const hw = hardwareFromBudget({ ...base, slots: [
      { category: "video", tier: "standard", model: "v", peak_bytes: 20 * gib, verified: true },
      { category: "video", tier: "boost", model: null, peak_bytes: null, verified: false },
      { category: "voice", tier: "standard", model: "x", peak_bytes: 3 * gib, verified: true },
      { category: "stems", tier: "standard", model: null, peak_bytes: null, verified: false },
    ] })!;
    expect(Object.keys(hw.peakGb)).toEqual(["video"]);
    expect(Object.keys(hw.residentGb)).toEqual(["video"]);
    expect(hw.peakGb.video).toEqual({ standard: 20 });
    expect(needGb(row("boost"), hw)).toBe(20);
  });
  test("fits_ever false on a level is not hidden by the guess: it refuses", async () => {
    const hw = hardwareFromBudget({ ...base, slots: [
      { category: "video", tier: "standard", model: "v", peak_bytes: 90 * gib, verified: true },
      { category: "video", tier: "boost", model: null, peak_bytes: null, verified: false, fits_ever: false },
    ] })!;
    expect(needGb(row("boost"), hw)).toBe(Infinity);
    setProfileSource({ ...noBoostPeak, hw: { ...hw, budgetGb: 80, residentGb: { chat: { standard: 1 } } } });
    const fit = await fitForAdmission({ jobClass: "video", tier: "boost" }, free(10));
    expect(fit?.outcome).toBe("refuse");
  });
  test("an old Stack answer (no new fields) behaves as before", () => {
    const hw = hardwareFromBudget({ ...base, slots: [{ category: "video", tier: "boost", model: "v", peak_bytes: 9 * gib, verified: true }] })!;
    expect(hw.peakGb.video).toEqual({ boost: 9 });
    expect(hw.neverFits).toBeUndefined();
  });
});

describe("the queue sends the job and bounds the wait", () => {
  const mk = (id: string): QueueJob => ({ id, personId: "p", jobClass: "video", state: "queued", createdAt: Date.now(), tier: "boost" });
  test("(a) with room the Boost job is sent as boost", async () => {
    setProfileSource(noBoostPeak); setBudgetReader(free(41));
    const j = mk("hold-a"); let released = 0; let lowered = false;
    const off = registerQueueProvider(() => [{ job: j, save: () => undefined, release: async () => { released += 1; }, lowerToStandard: () => { lowered = true; } }]);
    try { await releaseHouseholdQueue(); } finally { off(); }
    expect(released).toBe(1); expect(lowered).toBe(false); expect(j.tier).toBe("boost");
  });
  test("(b) without room it waits as tier_no_room and a re-check is scheduled", async () => {
    setProfileSource(noBoostPeak); setBudgetReader(free(10)); setNoRoomRecheckForTests(30);
    const j = mk("hold-b"); let released = 0;
    const off = registerQueueProvider(() => [{ job: j, save: () => undefined, release: async () => { released += 1; }, lowerToStandard: () => undefined }]);
    try { await releaseHouseholdQueue(); await new Promise((r) => setTimeout(r, 120)); } finally { off(); }
    expect(released).toBe(0); expect(j.riseReason).toBe("tier_no_room");
  });
  test("(c) held past quiet_max_wait the job is sent at Standard with the card line", async () => {
    setProfileSource(noBoostPeak); setBudgetReader(free(10)); setNoRoomRecheckForTests(30);
    setQuietConfigSource(() => ({ ...DEFAULT_QUIET, quietMaxWaitSeconds: 0.15 }));
    const j = mk("hold-c"); let released = 0; let note = "";
    const off = registerQueueProvider(() => [{ job: j, save: () => undefined, release: async () => { released += 1; }, lowerToStandard: (n) => { note = n; } }]);
    try { await releaseHouseholdQueue(); await new Promise((r) => setTimeout(r, 500)); } finally { off(); }
    expect(released).toBe(1); expect(j.tier).toBe("standard"); expect(note).toBe(waitedForRoomLine(0));
    expect(note).toBe("Waited 1 minute for room, made at Standard.");
    expect(waitedForRoomLine(12)).toBe("Waited 12 minutes for room, made at Standard.");
  });
});
