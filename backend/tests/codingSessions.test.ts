// CODE-AGENT-01 (first slice) and CODE-TIER-03: the session store, the tier a session keeps, and each turn as a household job. Fakes for the agent,
// the sandbox and the Max lease's swap; no Stack, no model.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { codingSessions, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newPersonId } from "@/lib/id";
import { createGrant, listGrants, revokeGrant } from "@/lib/grants";
import { invalidatePass } from "@/lib/filter/passCache";
import { setHouseholdSettingValue, writeLayerRow } from "@/lib/settings";
import { __setMissingCodingPieceForTests } from "@/lib/stackCodingPieces";
import { createChatLease, registerActiveChatLease } from "@/lib/chatLease";
import { isolateQueueProvidersForTests, registerQueueProvider } from "@/lib/jobs/householdQueue";
import { CodingSessionError, createCodingSession, getCodingSession, listCodingSessions, listCodingSessionsForAdmin, settleSessionsAtStartup, setSessionTier } from "@/lib/codingSessions";
import { codingQueueProvider, __setSessionCapForTests, __resetCodingTurnsForTests, __setCodingRetryMsForTests, deleteCodingSession, offersUseStandard, setCodingRuntime, stopCodingSession, submitTurn, turnFinished, turnQueueLine, turnState, useStandardForThisMessage } from "@/lib/codingTurns";
import { resetDb } from "./reset-db";
import { fakeAgent, fakeSandbox } from "./codingFakes";
import type { PersonRow } from "@/types";

const ENV = "cenv-abcdef12";
const input = (over: object = {}) => ({ title: "Fix the thermostat bug", repo: { kind: "none" as const, base_branch: "main", work_branch: "code/fix" }, environment_id: ENV, ...over });
function person(role: "owner" | "adult" | "teen" | "child" = "adult"): PersonRow {
  const id = newPersonId(); const at = new Date().toISOString();
  return db.insert(people).values({ id, displayName: "Willow", role, avatarSeed: id, source: "hub", createdAt: at, updatedAt: at, hlc: nextHlc() }).returning().get() as PersonRow;
}
const owner = () => person("owner");
function grantMax(holder: PersonRow, by: PersonRow) {
  const made = createGrant({ id: by.id, role: "owner" }, { person: holder.id, action: "tier.max:coding", effect: "allow", acknowledged_at: new Date().toISOString(), acknowledged_by_person_id: by.id });
  expect(made.ok).toBe(true); invalidatePass(holder.id);
}

let restoreProviders: () => void = () => undefined;
let lease: ReturnType<typeof createChatLease>;
let swaps: string[]; let leaseReady: boolean; let windowOpen: boolean;
let agent: ReturnType<typeof fakeAgent>; let sandbox: ReturnType<typeof fakeSandbox>;
beforeEach(() => {
  resetDb(); restoreProviders = isolateQueueProvidersForTests(); __resetCodingTurnsForTests(); __setCodingRetryMsForTests(20);
  setHouseholdSettingValue("coding.enabled", true); setHouseholdSettingValue("coding.adults_by_default", true); __setMissingCodingPieceForTests(null);
  // The Boost and Max coding slots ship off until the bench justifies them (spec default); these tests switch them on.
  for (const tier of ["boost", "max"]) setHouseholdSettingValue(`engines.coding.tier.${tier}`, { model: "recommended", options: {} });
  swaps = []; leaseReady = true; windowOpen = false;
  lease = createChatLease({ now: Date.now, ready: async () => leaseReady, windowOpen: () => windowOpen, swapToBig: async () => { swaps.push("big"); }, swapToStandard: async () => { swaps.push("standard"); } });
  registerActiveChatLease(lease);
  agent = fakeAgent(); sandbox = fakeSandbox();
  setCodingRuntime({ agent: agent.agent, sandbox: sandbox.sandbox, lease: () => lease });
  registerQueueProvider(codingQueueProvider);
});
afterEach(() => { restoreProviders(); __resetCodingTurnsForTests(); registerActiveChatLease(null); });
const settled = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 5)); };

describe("sessions: create, list, get, stop, delete", () => {
  test("create stores the spec record, list and get read it back, and another person sees nothing", () => {
    const a = owner(); const b = person();
    const made = createCodingSession(a, input());
    expect(made).toMatchObject({ person_id: a.id, state: "idle", tier: "standard", mode: "ask", network: { policy: "none", hosts: [] }, usage: { input_tokens: 0, output_tokens: 0 } });
    expect(made.id).toMatch(/^csess-[a-z0-9]{6,}$/);
    expect(listCodingSessions(a).map((s) => s.id)).toEqual([made.id]);
    expect(getCodingSession(a, made.id)?.title).toBe("Fix the thermostat bug");
    expect(getCodingSession(b, made.id)).toBeNull(); expect(listCodingSessions(b)).toEqual([]);
  });
  test("a person without coding access, or with coding off, is refused with a next step", () => {
    const a = person(); setHouseholdSettingValue("coding.enabled", false);
    const err = (() => { try { createCodingSession(a, input()); } catch (e) { return e as CodingSessionError; } })();
    expect(err).toBeInstanceOf(CodingSessionError); expect(err!.message).toContain("Settings");
    setHouseholdSettingValue("coding.enabled", true);
    expect(() => createCodingSession(person("child"), input())).toThrow(CodingSessionError);
  });
  test("a git repository needs the person's own active connection", () => {
    const a = owner();
    expect(() => createCodingSession(a, input({ repo: { kind: "github", connection_id: "gitc-nope000001", full_name: "x/y", base_branch: "main", work_branch: "w" } }))).toThrow(CodingSessionError);
  });
  test("delete moves the record to the trash, destroys the sandbox and hides it", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    expect(await deleteCodingSession(a, s.id)).toBe(true);
    expect(sandbox.events).toContain(`destroy:${s.id}`); expect(getCodingSession(a, s.id)).toBeNull(); expect(listCodingSessions(a)).toEqual([]);
    expect(await deleteCodingSession(a, s.id)).toBe(false);
  });
  test("the admin list carries ids, state and tier only (rule 6a)", () => {
    const a = owner(); createCodingSession(a, input());
    const [row] = listCodingSessionsForAdmin();
    expect(Object.keys(row!).sort()).toEqual(["created_at", "id", "last_activity_at", "person_id", "state", "tier"]);
    expect(JSON.stringify(row)).not.toContain("thermostat");
  });
});

describe("the tier a session keeps", () => {
  test("it survives a restart: the record holds Max, a stuck state reads idle again, and the next session starts on the last tier", () => {
    const a = owner(); const s = createCodingSession(a, input({ tier: "max" }));
    expect(s.tier).toBe("max");
    __resetCodingTurnsForTests(); // the in-memory side is gone
    db.update(codingSessions).set({ state: "working" }).where(eq(codingSessions.id, s.id)).run();
    expect(settleSessionsAtStartup()).toBe(1);
    expect(getCodingSession(a, s.id)).toMatchObject({ tier: "max", state: "idle" });
    expect(createCodingSession(a, input({ title: "Next" })).tier).toBe("max");
  });
  test("a switch writes at once and a tier the person may not run is refused, not lowered", () => {
    const a = person(); const s = createCodingSession(a, input());
    expect(() => setSessionTier(a, s.id, "max")).toThrow(CodingSessionError);
    expect(getCodingSession(a, s.id)!.tier).toBe("standard");
    const boss = owner(); const t = createCodingSession(boss, input());
    expect(setSessionTier(boss, t.id, "max").tier).toBe("max");
  });
  test("a removed grant clamps the next turn and corrects the stored record", async () => {
    const boss = owner(); const a = person(); grantMax(a, boss);
    const s = createCodingSession(a, input({ tier: "max" }));
    expect(s.tier).toBe("max");
    const grant = listGrants(a.id).find((g) => g.action === "tier.max:coding")!;
    expect(revokeGrant(grant.id).ok).toBe(true); invalidatePass(a.id);
    const sent = submitTurn(a, s.id, "hello");
    expect(sent.tier).not.toBe("max");
    expect(getCodingSession(a, s.id)!.tier).toBe(sent.tier);
    await settled(); expect(agent.calls[0]!.tier).toBe(sent.tier); expect(swaps).toEqual([]); // no lease for a lowered turn
    agent.finishAll(); await turnFinished(sent.turn_id);
  });
  test("a switched-off Boost slot lowers a Boost session to Standard and says so in the record", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "boost" }));
    setHouseholdSettingValue("engines.coding.tier.boost", { model: "off", options: {} });
    const sent = submitTurn(boss, s.id, "go");
    expect(sent.tier).toBe("standard"); expect(getCodingSession(boss, s.id)!.tier).toBe("standard");
    await settled(); agent.finishAll(); await turnFinished(sent.turn_id);
  });
});

describe("a turn is a household job", () => {
  test("it enters the queue as category coding with ids only, runs, and writes provenance and usage", async () => {
    const boss = owner(); const s = createCodingSession(boss, input());
    const sent = submitTurn(boss, s.id, "secret message about the thermostat");
    await settled();
    expect(turnState(sent.turn_id)).toBe("running");
    const job = codingQueueProvider().find((entry) => entry.job.id === sent.turn_id)!.job;
    expect(job).toMatchObject({ category: "coding", jobClass: "other", personId: boss.id, tier: "standard", state: "running" });
    expect(JSON.stringify(job)).not.toContain("thermostat");
    expect(getCodingSession(boss, s.id)!.state).toBe("working");
    expect(agent.calls).toEqual([{ sessionId: s.id, turnId: sent.turn_id, tier: "standard", message: "secret message about the thermostat" }]);
    agent.finishAll(); await turnFinished(sent.turn_id);
    expect(getCodingSession(boss, s.id)).toMatchObject({ state: "idle", model_id: "coding-model-1", usage: { input_tokens: 10, output_tokens: 5 } });
    expect(sandbox.events).toContain(`start:${s.id}`);
  });
  test("a second message while one is working is refused with a plain line", async () => {
    const boss = owner(); const s = createCodingSession(boss, input());
    const sent = submitTurn(boss, s.id, "one");
    expect(() => submitTurn(boss, s.id, "two")).toThrow(/still working/);
    stopCodingSession(boss, s.id); await turnFinished(sent.turn_id);
  });
  test("a failing agent ends the turn and the session reads failed; no error text reaches the log", async () => {
    agent = fakeAgent({ fail: true }); setCodingRuntime({ agent: agent.agent, sandbox: sandbox.sandbox, lease: () => lease });
    const boss = owner(); const s = createCodingSession(boss, input());
    const sent = submitTurn(boss, s.id, "go"); await settled(); agent.finishAll(); await turnFinished(sent.turn_id);
    expect(turnState(sent.turn_id)).toBe("failed"); expect(getCodingSession(boss, s.id)!.state).toBe("failed");
  });
  test("stop cancels a queued turn and aborts a running one; the tier stays", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" }));
    const sent = submitTurn(boss, s.id, "go"); await settled();
    expect(stopCodingSession(boss, s.id)).toBe(true); await turnFinished(sent.turn_id);
    expect(turnState(sent.turn_id)).toBe("cancelled"); expect(getCodingSession(boss, s.id)).toMatchObject({ state: "idle", tier: "max" });
  });
});

describe("admission: the two session caps are queue reasons", () => {
  test("over the household cap the turn waits with coding.max_sessions, then starts when one finishes", async () => {
    __setSessionCapForTests(1);
    const a = owner(); const b = person(); const sa = createCodingSession(a, input()); const sb = createCodingSession(b, input());
    const t1 = submitTurn(a, sa.id, "one"); await settled();
    const t2 = submitTurn(b, sb.id, "two"); await settled();
    expect(turnState(t1.turn_id)).toBe("running"); expect(turnState(t2.turn_id)).toBe("queued");
    expect(turnQueueLine(b, t2.turn_id)).toContain("Too many code sessions");
    expect(getCodingSession(b, sb.id)!.state).toBe("queued");
    agent.finishAll(); await turnFinished(t1.turn_id); await settled();
    expect(turnState(t2.turn_id)).toBe("running");
    agent.finishAll(); await turnFinished(t2.turn_id);
  });
  test("a person's own lower cap holds only that person's second session", async () => {
    __setSessionCapForTests(3);
    const a = owner(); const b = person(); writeLayerRow(a.id, "coding.person.max_sessions", "1");
    const s1 = createCodingSession(a, input()); const s2 = createCodingSession(a, input({ title: "Two" })); const sb = createCodingSession(b, input());
    const t1 = submitTurn(a, s1.id, "x"); await settled();
    const t2 = submitTurn(a, s2.id, "y"); await settled();
    const t3 = submitTurn(b, sb.id, "z"); await settled();
    expect(turnState(t2.turn_id)).toBe("queued"); expect(turnQueueLine(a, t2.turn_id)).toContain("most code sessions");
    expect(turnState(t3.turn_id)).toBe("running");
    stopCodingSession(a, s1.id); stopCodingSession(a, s2.id); stopCodingSession(b, sb.id);
    await Promise.all([t1, t2, t3].map((t) => turnFinished(t.turn_id)));
  });
});

describe("Max takes the lease", () => {
  test("a Max turn takes the lease, holds it in flight, and the tier stays Max after the lease is released", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" }));
    const sent = submitTurn(boss, s.id, "go"); await settled();
    expect(swaps).toEqual(["big"]); expect(lease.snapshot()).toMatchObject({ state: "held", holderId: boss.id, inFlight: 1 });
    expect(agent.calls[0]!.tier).toBe("max");
    agent.finishAll(); await turnFinished(sent.turn_id);
    expect(lease.snapshot().inFlight).toBe(0);
    await lease.release(); expect(swaps).toEqual(["big", "standard"]);
    expect(getCodingSession(boss, s.id)!.tier).toBe("max");
  });
  test("a refused lease keeps the turn waiting with the lease's reason and a Max window refusal reads as max_window", async () => {
    windowOpen = true;
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" }));
    const sent = submitTurn(boss, s.id, "go"); await settled();
    expect(turnState(sent.turn_id)).toBe("queued"); expect(agent.calls).toEqual([]);
    expect(turnQueueLine(boss, sent.turn_id)).toContain("Max job");
    expect(offersUseStandard(sent.turn_id)).toBe(true);
    windowOpen = false; await new Promise((r) => setTimeout(r, 80)); await settled();
    expect(turnState(sent.turn_id)).toBe("running"); // the retry took the lease once it was free
    agent.finishAll(); await turnFinished(sent.turn_id);
  });
  test("another person's Max chat holds the turn with max_chat; Use Standard for this message runs it at Standard and leaves the session on Max", async () => {
    const boss = owner(); const other = owner();
    expect((await lease.acquire(other)).ok).toBe(true);
    const s = createCodingSession(boss, input({ tier: "max" }));
    const sent = submitTurn(boss, s.id, "go"); await settled();
    expect(turnState(sent.turn_id)).toBe("queued"); expect(turnQueueLine(boss, sent.turn_id)).toContain("Max chat");
    expect(useStandardForThisMessage(boss, sent.turn_id)).toBe(true); await settled();
    expect(agent.calls[0]!.tier).toBe("standard"); expect(getCodingSession(boss, s.id)!.tier).toBe("max");
    expect(offersUseStandard(sent.turn_id)).toBe(false);
    agent.finishAll(); await turnFinished(sent.turn_id);
    expect(useStandardForThisMessage(boss, sent.turn_id)).toBe(false);
  });
  test("a swap that fails leaves the turn waiting, and Standard is offered", async () => {
    leaseReady = false;
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" }));
    const sent = submitTurn(boss, s.id, "go"); await settled();
    expect(turnState(sent.turn_id)).toBe("queued"); expect(offersUseStandard(sent.turn_id)).toBe(true);
    stopCodingSession(boss, s.id); await turnFinished(sent.turn_id);
  });
  test("a follow-up Max turn by the lease holder is not held by their own lease", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" }));
    const t1 = submitTurn(boss, s.id, "one"); await settled(); agent.finishAll(); await turnFinished(t1.turn_id);
    const t2 = submitTurn(boss, s.id, "two"); await settled();
    expect(turnState(t2.turn_id)).toBe("running"); expect(swaps).toEqual(["big"]);
    agent.finishAll(); await turnFinished(t2.turn_id);
  });
});
