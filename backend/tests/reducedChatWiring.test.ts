// TIER-WIRE-02/03/04: the queue really asks the Stack to swap chat to Reduced (a fake Stack over HTTP, not a stubbed swap), asks it to
// leave at a turn boundary, the composer line follows the Stack's own `reduced_chat`, and a Stack that fails or cannot do it leaves chat
// normal with no line.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createStackClient } from "@/lib/stack/client";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { collectHealth, __resetChatPauseTrackingForTests } from "@/lib/healthSnapshot";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { reducedChatState, resetReducedTruthForTests, setReducedChat } from "@/lib/reducedChat";
import { noteChatInFlight, registerQueueProvider, releaseHouseholdQueue, resetActivePlanForTests, isolateQueueProvidersForTests, resetChatActivityForTests, resetDownshiftForTests, resetFitMemoryForTests, resetTierStateForTests, setBudgetReader, activeProfileLine, type QueueJob } from "@/lib/jobs/householdQueue";
import { setProfileSource } from "@/lib/jobs/admissionFit";
import type { ProfileRow } from "@/lib/jobs/profileTable";

type Mode = "ok" | "waiting" | "missing" | "failing";
let server: ReturnType<typeof Bun.serve>;
let mode: Mode;
let reduced: boolean;
let calls: boolean[];
let restoreProviders: () => void = () => undefined;

beforeEach(() => {
  restoreProviders = isolateQueueProvidersForTests();
  mode = "ok"; reduced = false; calls = [];
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/stack/v1/memory") return Response.json({ reduced_chat: reduced });
      if (path === "/stack/v1/tiers/reduced") {
        if (mode === "missing") return new Response("not found", { status: 404 });
        const { on } = (await req.json()) as { on: boolean };
        calls.push(on);
        if (mode === "failing") return Response.json({ ok: false, reason: "no_room", reduced }, { status: 503 });
        if (mode === "waiting") return Response.json({ ok: false, waiting: true, reduced }, { status: 202 });
        reduced = on;
        return Response.json({ ok: true, swap_ms: 900, reduced });
      }
      return new Response("not found", { status: 404 });
    },
  });
  __setStackClientForTests(createStackClient({ baseUrl: `http://127.0.0.1:${server.port}` }));
  resetChatActivityForTests(); resetDownshiftForTests(); resetTierStateForTests(); resetFitMemoryForTests(); resetActivePlanForTests(); resetReducedTruthForTests();
  const row: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "reduced" }, video: { state: "max" } } };
  setProfileSource({ table: [row], hw: { budgetGb: 80, marginGb: 2, peakGb: { video: { max: 40 } }, residentGb: { chat: { reduced: 5 } } }, pins: {}, priorityWeight: {}, lowerWithoutAsking: {} });
  setBudgetReader(async () => ({ freeMemoryBytes: 70e9, loaded: [] }));
});
afterEach(() => {
  restoreProviders();
  server.stop(true);
  __setStackClientForTests(null); setProfileSource(null); setBudgetReader(null); setReducedChat(null); __setRoleHealthForTests({});
  resetChatActivityForTests(); resetDownshiftForTests(); resetTierStateForTests(); resetActivePlanForTests(); resetReducedTruthForTests();
});

function maxJob(id: string): { job: QueueJob; remove: () => void } {
  const job: QueueJob = { id, personId: `p-${id}`, jobClass: "video", state: "queued", createdAt: Date.now(), tier: "max" };
  const remove = registerQueueProvider(() => [{ job, save: () => undefined, applyFit: () => undefined, release: async () => { job.state = "running"; job.remainingSeconds = 600; } }]);
  return { job, remove };
}
// AUDIT-PERF-01 caches the snapshot for 2 s; this test reads the line right after each Stack change, so it drops the cache first.
const chatNotice = async () => { __resetChatPauseTrackingForTests(); return (await collectHealth()).engines.chat; };

describe("Reduced chat reaches the Stack", () => {
  test("a Max job asks the Stack to enter, the line shows from the Stack's truth, and at the turn boundary the Stack is asked to leave", async () => {
    const { job, remove } = maxJob("max-1");
    try {
      await releaseHouseholdQueue();
      expect(calls).toEqual([true]);
      expect(job.state).toBe("running");
      await releaseHouseholdQueue();
      expect(calls).toEqual([true]);
      expect(reducedChatState()).not.toBeNull();
      const chat = await chatNotice();
      expect(chat.availability).toBe("ready");
      expect(chat.cause).toBe("tier_reduced");
      expect(chat.notice?.adult).toContain("Chat is simpler");

      // The Max job ends while a chat turn is in flight: the restore waits for the boundary.
      job.state = "done" as QueueJob["state"];
      noteChatInFlight(1);
      await releaseHouseholdQueue();
      expect(calls).toEqual([true]);
      expect(reduced).toBe(true);
      noteChatInFlight(-1);
      await releaseHouseholdQueue();
      expect(calls).toEqual([true, false]);
      expect(reduced).toBe(false);
      expect(reducedChatState()).toBeNull();
      resetReducedTruthForTests(); __resetChatPauseTrackingForTests();
      expect((await chatNotice()).notice?.adult ?? "").not.toContain("simpler");
    } finally { remove(); }
  });

  test("the line follows the Stack: Home's flag alone shows nothing", async () => {
    setReducedChat({ minutesLeft: 5 });
    expect((await chatNotice()).cause).not.toBe("tier_reduced");
    reduced = true; resetReducedTruthForTests(); __resetChatPauseTrackingForTests();
    expect((await chatNotice()).cause).toBe("tier_reduced");
  });

  test("a Stack that answers 202 (a turn in flight) holds the Max job at the quiet wait and sets no flag", async () => {
    mode = "waiting";
    const { job, remove } = maxJob("max-2");
    try {
      await releaseHouseholdQueue();
      expect(job.state).toBe("queued");
      expect(job.riseReason).toBe("quiet_wait");
      expect(reducedChatState()).toBeNull();
    } finally { remove(); }
  });

  test("a Stack that fails the swap leaves chat normal with no line, and the plan does not claim Reduced", async () => {
    mode = "failing";
    const { job, remove } = maxJob("max-3");
    try {
      await releaseHouseholdQueue();
      expect(calls).toEqual([true]);
      expect(reducedChatState()).toBeNull();
      expect(job.state).toBe("running");
      const chat = await chatNotice();
      expect(chat.cause).not.toBe("tier_reduced");
      expect(chat.notice?.adult ?? "").not.toContain("simpler");
      expect(await activeProfileLine()).toBe("Video: Max");
    } finally { remove(); }
  });

  test("an older Stack without the route (404) is not failed: no flag, the job runs", async () => {
    mode = "missing";
    const { job, remove } = maxJob("max-4");
    try {
      await releaseHouseholdQueue();
      expect(reducedChatState()).toBeNull();
      expect(job.state).toBe("running");
      expect((await chatNotice()).notice?.adult ?? "").not.toContain("simpler");
    } finally { remove(); }
  });
});
