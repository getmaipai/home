// CODE-NOTIFY-01: the three Code notifications, the `coding` concern the composer line reads, `coding.paused`, the Status row's counts line and the Repairs item.
import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { codingSessions } from "@/db/schema";
import { listPending } from "@/lib/notifications";
import { codingPausedByAdmin } from "@/lib/codingPause";
import { codingNotice } from "@/lib/failureCopy";
import { __resetMakingHealthForTests, codingConcern } from "@/lib/roleHealth";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { codingActivityLine } from "@/lib/statusApps";
import { syncCodingHealthIssue } from "@/lib/codingHealthIssue";
import { listIssues } from "@/lib/issues";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetExpiryWarningsForTests, countActiveSessions, createCodingSession, markSessionDeleted, notifyExpiringWorkspaces } from "@/lib/codingSessions";
import { answerHostRequest, pendingRequestsFor } from "@/lib/codingBridge";
import { sendMessage, submitTurn, turnFinished } from "@/lib/codingTurns";
import { input, owner, settled, startRig } from "./codingRig";

let rig: ReturnType<typeof startRig>;
afterEach(() => { rig?.restore(); __resetMakingHealthForTests(); __resetStackEngineForTests(); __resetExpiryWarningsForTests(); });
const types = (p: Parameters<typeof listPending>[0]) => listPending(p).map((n) => n.typeId);

describe("notifications", () => {
  test("a held request tells its owner once per ask; the line names no session, repository or request", async () => {
    rig = startRig({ script: async (host) => { await host.permit({ effect: "file_write", detail: { path: "secret/a.ts" } }); } });
    const a = owner(); const s = createCodingSession(a, input({ mode: "ask", title: "Private plan" }));
    const sent = submitTurn(a, s.id, "go"); await settled();
    const pending = listPending(a).filter((n) => n.typeId === "coding.needs_you");
    expect(pending).toHaveLength(1); expect(pending[0]!.text).not.toMatch(/Private plan|secret|a\.ts/);
    answerHostRequest(a, s.id, pendingRequestsFor(a.id, s.id)[0]!.request_id, "allow"); await settled();
    rig.agent.finishAll(); await turnFinished(sent.turn_id);
  });
  test("finishing the work tells the owner; a message typed ahead holds the ping until the last one is done", async () => {
    rig = startRig();
    const a = owner(); const s = createCodingSession(a, input());
    const first = submitTurn(a, s.id, "one"); await settled();
    sendMessage(a, s.id, "two"); // joins the message queue
    rig.agent.finishAll(); await turnFinished(first.turn_id); await settled();
    expect(types(a)).not.toContain("coding.session_done");
    rig.agent.finishAll(); await settled(); await new Promise((r) => setTimeout(r, 20)); await settled();
    expect(types(a).filter((t) => t === "coding.session_done")).toHaveLength(1);
  });
  test("a failed turn does not say it finished", async () => {
    rig = startRig({ fail: true });
    const a = owner(); const s = createCodingSession(a, input());
    const sent = submitTurn(a, s.id, "go"); await settled(); rig.agent.finishAll(); await turnFinished(sent.turn_id); await settled();
    expect(types(a)).not.toContain("coding.session_done");
  });
  test("a trashed session with three days or fewer left warns its owner once", () => {
    rig = startRig();
    const a = owner(); const s = createCodingSession(a, input()); markSessionDeleted(a, s.id);
    expect(notifyExpiringWorkspaces()).toBe(0); // 30 days left
    db.update(codingSessions).set({ trashUntil: new Date(Date.now() + 2 * 86_400_000).toISOString() }).where(eq(codingSessions.id, s.id)).run();
    expect(notifyExpiringWorkspaces()).toBe(1); expect(notifyExpiringWorkspaces()).toBe(0);
  });
});

const roles = (coding: object | undefined, state = "ready") => ({ roles: async () => ({ roles: [{ id: "coding", state: { state }, ...(coding ? { coding } : {}) }] }), getCodingMode: async () => ({ memory: { plan_bytes: 20 * 1_073_741_824, budget_bytes: 0 } }) } as never);

describe("the coding concern", () => {
  test("paused beside chat's pause: an admin's pause reads first and has its own line", async () => {
    setHouseholdSettingValue("coding.paused", true);
    expect(codingPausedByAdmin()).toBe(true);
    const concern = await codingConcern();
    expect(concern).toMatchObject({ availability: "unavailable", cause: "paused_by_admin" });
    expect(codingNotice(concern.cause!)).toContain("paused");
    setHouseholdSettingValue("coding.paused", false);
  });
  test("not installed, offline, loading, busy, idle and unloaded read from the Stack's coding role", async () => {
    __setStackClientForTests(roles(undefined, "notInstalled")); expect((await codingConcern()).cause).toBe("not_installed");
    for (const [coding, state, want] of [[{ state: "offline" }, "offline", { availability: "unavailable", cause: "offline" }], [{ state: "loading" }, "installed", { availability: "starting", cause: "restarting" }],
      [{ state: "busy" }, "loaded", { availability: "ready", model: "busy" }], [{ state: "ready" }, "ready", { availability: "ready", model: "idle" }], [{ state: "installed" }, "installed", { availability: "ready", model: "unloaded" }]] as const) {
      __resetMakingHealthForTests(); __setStackClientForTests(roles(coding, state)); expect(await codingConcern()).toMatchObject(want);
    }
  });
  test("a Stack that does not answer reads as getting ready, never as a failure", async () => {
    __setStackClientForTests({ roles: async () => { throw new Error("down"); } } as never);
    expect(await codingConcern()).toMatchObject({ availability: "starting", cause: "restarting" });
  });
});

describe("Status and Repairs", () => {
  test("the Code row line is counts and states only", async () => {
    rig = startRig();
    const a = owner(); const s = createCodingSession(a, input()); submitTurn(a, s.id, "secret task"); await settled();
    expect(countActiveSessions()).toBe(1);
    const line = codingActivityLine(2, { model: "busy", memory_bytes: 20 * 1_073_741_824 });
    expect(line).toBe("2 sessions working; the coding model is busy; it plans to use 20 GB of memory.");
    expect(codingActivityLine(1, { model: "unloaded", memory_bytes: null })).toBe("1 session working; the coding model is not loaded.");
    expect(line).not.toMatch(/secret|Fix the/);
    rig.agent.finishAll();
  });
  test("an offline coding engine raises one Repairs item while Coding is on, and it clears when the engine answers", async () => {
    rig = startRig();
    await syncCodingHealthIssue({ availability: "unavailable", cause: "offline", model: "unloaded", memory_bytes: null });
    expect(listIssues().filter((i) => i.source === "coding" && i.key === "engine_offline")).toHaveLength(1);
    await syncCodingHealthIssue({ availability: "ready", model: "idle", memory_bytes: null });
    expect(listIssues().filter((i) => i.source === "coding" && i.key === "engine_offline")).toHaveLength(0);
  });
});
