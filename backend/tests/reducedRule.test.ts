// TIER-REDUCED-01: a `chat: reduced` profile cell is permission, not a command. Home asks the Stack for Reduced chat only on a real shortfall,
// after the quiet window, and never while "Let big jobs simplify chat" (`engines.chat.tier.reduced`) is off. A fake Stack over HTTP records the calls.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createStackClient } from "@/lib/stack/client";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { __resetChatPauseTrackingForTests, collectHealth } from "@/lib/healthSnapshot";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { reducedChatState, resetReducedTruthForTests, setReducedChat } from "@/lib/reducedChat";
import { setHouseholdSettingValue } from "@/lib/settings";
import { MAX_NEEDS_REDUCED_OFF_LINE } from "@/lib/tiers";
import { noteChatInFlight, registerQueueProvider, releaseHouseholdQueue, resetActivePlanForTests, isolateQueueProvidersForTests, resetChatActivityForTests, resetDownshiftForTests, resetFitMemoryForTests, resetTierStateForTests, setBudgetReader, activeProfileLine, type QueueJob } from "@/lib/jobs/householdQueue";
import { setProfileSource } from "@/lib/jobs/admissionFit";
import type { ProfileRow } from "@/lib/jobs/profileTable";

let server: ReturnType<typeof Bun.serve>;
let reduced: boolean;
let calls: boolean[];
let restoreProviders: () => void = () => undefined;
const setSwitch = (on: boolean) => { setHouseholdSettingValue("engines.chat.tier.reduced", { model: on ? "recommended" : "off", options: {}, who: "everyone" }); };
const setFreeGb = (free: number) => setBudgetReader(async () => ({ freeMemoryBytes: free * 1e9, loaded: [] }));
// Peak 40 GB, margin 2: 70 GB free is no shortfall; 32 GB free is a 10 GB shortfall that chat's Reduced swap (20 -> 5 GB) covers.
const NO_SHORTFALL = 70; const SHORTFALL_10 = 32;

beforeEach(() => {
  restoreProviders = isolateQueueProvidersForTests();
  reduced = false; calls = [];
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/stack/v1/memory") return Response.json({ reduced_chat: reduced });
      if (path === "/stack/v1/tiers/reduced") { const { on } = (await req.json()) as { on: boolean }; calls.push(on); reduced = on; return Response.json({ ok: true, swap_ms: 900, reduced }); }
      return new Response("not found", { status: 404 });
    },
  });
  __setStackClientForTests(createStackClient({ baseUrl: `http://127.0.0.1:${server.port}` }));
  resetChatActivityForTests(); resetDownshiftForTests(); resetTierStateForTests(); resetFitMemoryForTests(); resetActivePlanForTests(); resetReducedTruthForTests();
  const row: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "reduced" }, video: { state: "max" } } };
  setProfileSource({ table: [row], hw: { budgetGb: 80, marginGb: 2, peakGb: { video: { max: 40 } }, residentGb: { chat: { reduced: 5, standard: 20 } } }, pins: {}, priorityWeight: {}, lowerWithoutAsking: {} });
  setSwitch(true); setFreeGb(NO_SHORTFALL);
});
afterEach(() => {
  restoreProviders(); server.stop(true);
  __setStackClientForTests(null); setProfileSource(null); setBudgetReader(null); setReducedChat(null); __setRoleHealthForTests({}); setSwitch(false);
  resetChatActivityForTests(); resetDownshiftForTests(); resetTierStateForTests(); resetActivePlanForTests(); resetReducedTruthForTests();
});

function maxJob(id: string): { job: QueueJob; remove: () => void } {
  const job: QueueJob = { id, personId: `p-${id}`, jobClass: "video", state: "queued", createdAt: Date.now(), tier: "max" };
  const remove = registerQueueProvider(() => [{ job, save: () => undefined, applyFit: () => undefined, release: async () => { job.state = "running"; job.remainingSeconds = 600; } }]);
  return { job, remove };
}
const chatNotice = async () => { __resetChatPauseTrackingForTests(); return (await collectHealth()).engines.chat; };

describe("a chat: reduced cell is permission", () => {
  test("(a) no shortfall: no enter call, no chat cell in the plan, no line under the chat input", async () => {
    const { job, remove } = maxJob("a");
    try {
      await releaseHouseholdQueue();
      expect(job.state).toBe("running");
      expect(calls).toEqual([]);
      expect(await activeProfileLine()).toBe("Video: Max");
      expect(reducedChatState()).toBeNull();
      expect((await chatNotice()).notice?.adult ?? "").not.toContain("simpler");
    } finally { remove(); }
  });

  test("(b) a 10 GB shortfall: enter is called, but only after the quiet window", async () => {
    setFreeGb(SHORTFALL_10);
    const { job, remove } = maxJob("b");
    try {
      noteChatInFlight(1);
      await releaseHouseholdQueue();
      expect(calls).toEqual([]);
      expect(job.state).toBe("queued");
      noteChatInFlight(-1);
      await releaseHouseholdQueue();
      expect(calls).toEqual([true]);
      expect(job.state).toBe("running");
      await releaseHouseholdQueue();
      expect(calls).toEqual([true]);
      expect(reducedChatState()).not.toBeNull();
    } finally { remove(); }
  });

  test("(c) switch off with a shortfall: no enter call, the job is made at Boost with the new line", async () => {
    setSwitch(false); setFreeGb(SHORTFALL_10);
    const { job, remove } = maxJob("c");
    try {
      await releaseHouseholdQueue();
      expect(calls).toEqual([]);
      expect(job.tier).toBe("boost");
      expect(job.tierNote).toBe(MAX_NEEDS_REDUCED_OFF_LINE);
      expect(MAX_NEEDS_REDUCED_OFF_LINE).toBe("Max would need to simplify chat, which is switched off, so this one is made at Boost.");
      expect(job.state).toBe("running");
      expect(reducedChatState()).toBeNull();
    } finally { remove(); }
  });

  test("(d) switch off, no shortfall: Max runs normally", async () => {
    setSwitch(false);
    const { job, remove } = maxJob("d");
    try {
      await releaseHouseholdQueue();
      expect(calls).toEqual([]);
      expect(job.tier).toBe("max");
      expect(job.tierNote).toBeUndefined();
      expect(job.state).toBe("running");
    } finally { remove(); }
  });

  test("(e) switch off: a Reduced the Stack entered by itself is left, never renewed", async () => {
    setSwitch(false);
    const { job, remove } = maxJob("e");
    try {
      await releaseHouseholdQueue();
      expect(job.state).toBe("running");
      reduced = true; resetReducedTruthForTests(); // the Stack's own governor swapped chat
      await releaseHouseholdQueue();
      expect(calls).toEqual([false]);
      expect(reduced).toBe(false);
    } finally { remove(); }
  });

  test("(e2) the switch turned off while Home's own Reduced runs: the renew loop leaves instead of renewing", async () => {
    setFreeGb(SHORTFALL_10);
    const { job, remove } = maxJob("e2");
    try {
      await releaseHouseholdQueue();
      expect(calls).toEqual([true]);
      setSwitch(false);
      await releaseHouseholdQueue();
      expect(calls).toEqual([true, false]);
      expect(job.state).toBe("running");
    } finally { remove(); }
  });
});
