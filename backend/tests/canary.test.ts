// CANARY-01: hermetic tests for the health checks. Fakes everywhere; nothing here reaches a live service.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { listIssues } from "@/lib/issues";
import { CHECKS, WEATHER_PHRASE, wordMatch } from "@/lib/canary/checks";
import { HEALTH_ACTOR_ID, healthActor } from "@/lib/canary/identity";
import { __resetCanaryResultsForTests, failuresInARow, last } from "@/lib/canary/results";
import { __resetCanaryRunnerForTests, canaryStatus, canaryTick, MANUAL_DEBOUNCE_MS, runNow, runSuite } from "@/lib/canary/runner";
import { __resetCanaryScheduleForTests, dueChecks, emptySchedule, INTERVAL_MS, noteRun, schedule, searchAllowed, SEARCH_PER_DAY } from "@/lib/canary/schedule";
import { decodeWav } from "@/lib/canary/wav";
import { encodeWav } from "@/lib/sttSession";
import { gpuCompilerFault, roleHealth, __resetMakingHealthForTests } from "@/lib/roleHealth";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { CanaryDeps, ChatProbe } from "@/lib/canary/types";

const OK_PROBE: ChatProbe = { ok: true, text: "Hello!", toolCalls: [], toolErrors: [], cue: false, firstTokenMs: 120, totalMs: 900, error: null };
let clock = 1_800_000_000_000;
let calls: string[] = [];
let restarts = 0;
let restartRoles: string[] = [];
let budgetFree = true;
const budget = { allowed: () => budgetFree, note: () => { budgetFree = false; } };
const HUNG: ChatProbe = { ...OK_PROBE, ok: false, text: "", firstTokenMs: null, error: "timeout" };
const SLOW: ChatProbe = { ...OK_PROBE, ok: false, text: "", firstTokenMs: 90_000, error: "timeout" };

function deps(over: Partial<CanaryDeps> = {}): CanaryDeps {
  return {
    async chat(request) {
      calls.push(request.picture ? "picture" : request.spoken ? "spoken" : request.text);
      if (/weather/i.test(request.text)) return { ...OK_PROBE, toolCalls: ["weather"] };
      if (/down|outage|status page/i.test(request.text)) return { ...OK_PROBE, toolCalls: ["websearch"] };
      if (request.picture) return { ...OK_PROBE, text: "Red." };
      return OK_PROBE;
    },
    async embed() { calls.push("embed"); return { ok: true, dims: 8 }; },
    async loopback(phrase) { calls.push("loopback"); return { ok: true, heard: phrase }; },
    async image() { calls.push("image"); return { ok: true }; },
    async chatRole() { return { availability: "ready", reason: null }; },
    async visionReady() { return true; },
    async blocker() { return null; },
    turnActive: () => false,
    async requestRestart(_reason, role) { restarts += 1; restartRoles.push(role ?? "chat"); return true; },
    async gpuCompile() { return { ok: true, reason: null }; },
    searchTrouble: () => false,
    loadHigh: () => false,
    searchConfigured: () => true,
    restartBudget: budget,
    keepWarm: () => true,
    now: () => clock,
    random: () => 0.5,
    ...over,
  };
}

beforeEach(() => {
  resetDb();
  __resetCanaryResultsForTests();
  __resetCanaryScheduleForTests();
  __resetCanaryRunnerForTests();
  clock = 1_800_000_000_000;
  calls = [];
  restarts = 0;
  restartRoles = [];
  budgetFree = true;
});
afterEach(() => { __resetCanaryRunnerForTests(); });

const canaryIssues = () => listIssues().filter((i) => i.source === "canary");

describe("checks assert behaviour", () => {
  test("a chat that answers but never calls the weather tool fails with a plain cause", async () => {
    const d = deps({ chat: async () => OK_PROBE });
    const out = await runSuite(d, { reason: "manual", only: ["chat_tool_weather"] });
    expect(out[0]!.status).toBe("fail");
    expect(out[0]!.note).toContain("did not look up the weather");
  });

  test("search: no tool call fails, tool call plus answer passes, a failed search fails", async () => {
    const none = await runSuite(deps({ chat: async () => OK_PROBE }), { reason: "manual", only: ["chat_search_trigger"] });
    expect(none[0]!.note).toContain("did not search the web when asked");
    const ok = await runSuite(deps(), { reason: "manual", only: ["chat_search_trigger"] });
    expect(ok[0]!.status).toBe("pass");
    const blocked = await runSuite(deps({ chat: async () => ({ ...OK_PROBE, toolCalls: ["websearch"], toolErrors: ["websearch"] }) }), { reason: "manual", only: ["chat_search_trigger"] });
    expect(blocked[0]!.note).toContain("the search failed");
  });

  test("a package reply that arrives whole in the done value counts as the answer (the weather card)", async () => {
    // chatProbe fills text from the done value; the checks only see ChatProbe, so this proves the check side of it.
    const out = await runSuite(deps({ chat: async () => ({ ...OK_PROBE, toolCalls: ["weather"], text: "It is 4 degrees in Oslo." }) }), { reason: "manual", only: ["chat_tool_weather"] });
    expect(out[0]!.status).toBe("pass");
  });

  test("a spoken turn that only played a cue fails (the one-sec regression)", async () => {
    const out = await runSuite(deps({ chat: async () => ({ ...OK_PROBE, text: "", cue: true }) }), { reason: "manual", only: ["spoken_turn"] });
    expect(out[0]!.status).toBe("fail");
    expect(out[0]!.note).toContain("waiting phrase");
  });

  test("a dead engine fails chat_hello and skips the dependent checks", async () => {
    const d = deps({ chatRole: async () => ({ availability: "unavailable", reason: "failed_start" }) });
    const out = await runSuite(d, { reason: "manual", only: ["chat_hello", "chat_tool_weather", "spoken_turn"] });
    expect(out.map((r) => r.status)).toEqual(["fail", "skipped", "skipped"]);
    expect(calls).toEqual([]);
  });

  test("a slow engine (timeout) fails with the time-allowed cause", async () => {
    const out = await runSuite(deps({ chat: async () => ({ ...OK_PROBE, ok: false, text: "", error: "timeout" }) }), { reason: "manual", only: ["chat_hello"] });
    expect(out[0]!.note).toContain("did not answer within the time allowed");
  });

  test("picture check passes on a colour word and skips for a model that reads no pictures", async () => {
    expect((await runSuite(deps(), { reason: "manual", only: ["chat_picture_read"] }))[0]!.status).toBe("pass");
    expect((await runSuite(deps({ visionReady: async () => false }), { reason: "manual", only: ["chat_picture_read"] }))[0]!.status).toBe("skipped");
  });

  test("loopback needs 60 percent of the words back", async () => {
    expect(wordMatch("The kitchen light is on", "the kitchen lights on")).toBe(true);
    expect(wordMatch("The kitchen light is on", "banana split")).toBe(false);
    const out = await runSuite(deps({ loopback: async () => ({ ok: true, heard: "banana" }) }), { reason: "manual", only: ["stt_tts_loopback"] });
    expect(out[0]!.status).toBe("fail");
  });

  test("the WAV reader round-trips the Home encoder", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.25]);
    const wav = decodeWav(new Uint8Array(encodeWav(samples, 16000)));
    expect(wav?.sampleRate).toBe(16000);
    expect(wav?.samples.length).toBe(4);
    expect(wav!.samples[1]!).toBeCloseTo(0.5, 2);
  });
});

describe("results and Repairs", () => {
  test("one failure raises nothing; two in a row raise one item; a pass clears it", async () => {
    let bad = true;
    const d = deps({ chat: async () => (bad ? { ...OK_PROBE, text: "" } : OK_PROBE) });
    await runSuite(d, { reason: "manual", only: ["chat_hello"] });
    expect(canaryIssues()).toHaveLength(0);
    clock += 31_000;
    await runSuite(d, { reason: "manual", only: ["chat_hello"] });
    expect(failuresInARow("chat_hello")).toBe(2);
    expect(canaryIssues()).toHaveLength(1);
    expect(canaryIssues()[0]!.title).toBe("Chat is not answering");
    await runSuite(d, { reason: "manual", only: ["chat_hello"] });
    expect(canaryIssues()).toHaveLength(1); // the same row, never a second
    bad = false;
    await runSuite(d, { reason: "manual", only: ["chat_hello"] });
    expect(canaryIssues()).toHaveLength(0);
  });

  test("history keeps the last 50 and the status groups show pass or fail", async () => {
    for (let i = 0; i < 55; i++) await runSuite(deps(), { reason: "manual", only: ["embed"] });
    expect(canaryStatus().checks.find((c) => c.id === "embed")!.state).toBe("pass");
    const { history } = await import("@/lib/canary/results");
    expect(history("embed")).toHaveLength(50);
    await runSuite(deps({ chat: async () => OK_PROBE }), { reason: "manual", only: ["chat_tool_weather"] });
    const groups = canaryStatus().groups;
    expect(groups.find((g) => g.group === "tools")!.state).toBe("fail");
    expect(groups.find((g) => g.group === "search")!.state).toBe("unknown");
  });

});

describe("restarts only for a dead or hung engine", () => {
  const hellos = async (d: CanaryDeps, n: number) => { for (let i = 0; i < n; i++) { await runSuite(d, { reason: "manual", only: ["chat_hello"] }); clock += 31_000; } };

  test("a slow engine (a token arrived, the deadline passed) or a wrong answer never restarts", async () => {
    await hellos(deps({ chat: async () => SLOW }), 5);
    await hellos(deps({ chat: async () => ({ ...OK_PROBE, text: "" }) }), 5);
    expect(restarts).toBe(0);
    expect(canaryIssues()).toHaveLength(1); // still told to the admin, just not restarted
  });

  test("a dead engine (its role is not ready) asks for exactly one restart", async () => {
    await hellos(deps({ chatRole: async () => ({ availability: "unavailable", reason: "failed_start" }) }), 4);
    expect(restarts).toBe(1);
  });

  test("three hellos in a row with no token at all ask for one restart; two do not", async () => {
    await hellos(deps({ chat: async () => HUNG }), 2);
    expect(restarts).toBe(0);
    await hellos(deps({ chat: async () => HUNG }), 3);
    expect(restarts).toBe(1);
  });

  test("never under load, with the memory low or a blocker, or twice inside 30 minutes", async () => {
    const dead = { chatRole: async () => ({ availability: "unavailable" as const, reason: "failed_start" }) };
    await hellos(deps({ ...dead, loadHigh: () => true }), 4);
    await hellos(deps({ ...dead, blocker: async () => "This computer is low on memory." }), 4);
    expect(restarts).toBe(0);
    budgetFree = false; // one already went inside the window
    __resetCanaryResultsForTests();
    await hellos(deps(dead), 4);
    expect(restarts).toBe(0);
    budgetFree = true;
    __resetCanaryResultsForTests();
    await hellos(deps(dead), 4);
    expect(restarts).toBe(1);
  });

  test("the budget is remembered across restarts: one per 30 minutes", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { fileRestartBudget, RESTART_WINDOW_MS } = await import("@/lib/canary/restartBudget");
    const path = join(mkdtempSync(join(tmpdir(), "canary-")), "r.json");
    let t = 1_000_000_000_000;
    const first = fileRestartBudget(path, () => t);
    expect(first.allowed()).toBe(true);
    first.note();
    const afterRestart = fileRestartBudget(path, () => t + 60_000); // a new object, as after a Home restart
    expect(afterRestart.allowed()).toBe(false);
    t += RESTART_WINDOW_MS + 1;
    expect(fileRestartBudget(path, () => t).allowed()).toBe(true);
  });

  test("an unconfigured web search is skipped, not failed", async () => {
    const out = await runSuite(deps({ searchConfigured: () => false }), { reason: "manual", only: ["chat_search_trigger"] });
    expect(out[0]!.status).toBe("skipped");
    expect(out[0]!.note).toContain("not set up");
    expect(canaryIssues()).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  test("the weather prompt names a place", () => {
    expect(WEATHER_PHRASE).toContain("Hartford");
  });
});

describe("schedule", () => {
  test("light checks every 5 and 10 minutes, the rest every 30, search at most 3 a day", () => {
    const st = emptySchedule();
    const t0 = 1_800_000_000_000;
    for (const id of ["chat_hello", "embed", "chat_tool_weather", "spoken_turn", "stt_tts_loopback", "chat_picture_read", "image_tiny", "gpu_metal"] as const) noteRun(st, id, t0, 0.5);
    st.nextSearchAt = t0 + 99 * 3_600_000;
    expect(dueChecks(t0 + 6 * 60_000, st, { keepWarm: true })).toEqual(["embed"]);
    expect(dueChecks(t0 + 11 * 60_000, st, { keepWarm: true })).toEqual(["chat_hello", "embed"]);
    expect(dueChecks(t0 + 16 * 60_000, st, { keepWarm: true })).toContain("gpu_metal");
    expect(dueChecks(t0 + 31 * 60_000, st, { keepWarm: true })).toContain("stt_tts_loopback");
    expect(INTERVAL_MS.chat_hello).toBe(10 * 60_000);
  });

  test("the search check is jittered 6 to 10 hours apart, capped at 3 a day, and quiet after a block", () => {
    const st = emptySchedule();
    const t0 = 1_800_000_000_000;
    noteRun(st, "chat_search_trigger", t0, 0);
    expect(st.nextSearchAt - t0).toBe(6 * 3_600_000);
    noteRun(st, "chat_search_trigger", t0 + 7 * 3_600_000, 1);
    expect(st.nextSearchAt - (t0 + 7 * 3_600_000)).toBe(10 * 3_600_000);
    expect(searchAllowed(st, t0 + 8 * 3_600_000)).toBe(false);
    st.nextSearchAt = 0;
    noteRun(st, "chat_search_trigger", t0 + 14 * 3_600_000, 0.5);
    st.nextSearchAt = 0;
    expect(st.searchRuns.length).toBe(SEARCH_PER_DAY);
    expect(searchAllowed(st, t0 + 15 * 3_600_000)).toBe(false);
    expect(searchAllowed(st, t0 + 31 * 3_600_000)).toBe(true);
    st.searchQuietUntil = t0 + 40 * 3_600_000;
    expect(searchAllowed(st, t0 + 31 * 3_600_000)).toBe(false);
  });

  test("Keep the AI warm off leaves only the daily picture check and the graphics compiler check (which wakes nothing) on a timer", () => {
    expect(dueChecks(1_800_000_000_000, emptySchedule(), { keepWarm: false })).toEqual(["gpu_metal", "image_tiny"]);
  });

  test("a search block (tool error) silences the search canary for 24 hours", async () => {
    await runSuite(deps({ chat: async () => ({ ...OK_PROBE, toolCalls: ["websearch"], toolErrors: ["websearch"] }) }), { reason: "manual", only: ["chat_search_trigger"] });
    expect(searchAllowed(schedule, clock + 23 * 3_600_000)).toBe(false);
  });
});

describe("when checks must not run", () => {
  test("scheduled and post-start runs do nothing while an install, job, update or low memory holds the machine", async () => {
    const d = deps({ blocker: async () => "An install is running." });
    expect(await runSuite(d, { reason: "scheduled" })).toEqual([]);
    expect(await runSuite(d, { reason: "post_start" })).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("a manual run during a block reports each check as skipped with the reason and calls nothing", async () => {
    const out = await runSuite(deps({ blocker: async () => "This computer is low on memory." }), { reason: "manual" });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.status === "skipped" && r.note === "This computer is low on memory.")).toBe(true);
    expect(calls).toEqual([]);
  });

  test("no scheduled check while a person is mid-conversation; the post-start suite still runs", async () => {
    const d = deps({ turnActive: () => true });
    __resetCanaryRunnerForTests();
    const first = await canaryTick(d);
    expect(first.length).toBeGreaterThan(0); // post-start suite
    clock += 11 * 60_000;
    expect(await canaryTick(d)).toEqual([]);
    clock += 60_000;
    expect(await canaryTick(deps())).not.toEqual([]);
  });

  test("a new Stack chat generation queues one post-start suite, with chat_hello first", async () => {
    const { __setStackClientForTests } = await import("@/lib/stackEngine");
    let generation = "chat-start-1";
    __setStackClientForTests({
      roles: async () => ({ roles: [{ id: "chat", state: { state: "ready", since: generation } }] }),
    } as never);
    try {
      await runSuite(deps(), { reason: "manual", only: ["image_tiny"] });
      await canaryTick(deps()); // consume Home's initial post-start suite
      calls = [];
      expect(await canaryTick(deps())).toEqual([]);

      generation = "chat-start-2";
      const restarted = await canaryTick(deps());
      expect(restarted.map((result) => result.id)[0]).toBe("chat_hello");
      expect(restarted.length).toBeGreaterThan(1);
      expect(calls[0]).toBe("hi");

      calls = [];
      expect(await canaryTick(deps())).toEqual([]);
      expect(calls).toEqual([]);
    } finally {
      __setStackClientForTests(null);
    }
  });

  test("the post-start suite runs everything but the picture check, and the search check only when keep-warm and quota allow", async () => {
    const out = await runSuite(deps(), { reason: "post_start" });
    expect(out.map((r) => r.id)).toContain("chat_search_trigger");
    expect(out.map((r) => r.id)).not.toContain("image_tiny");
    calls = [];
    const off = await runSuite(deps({ keepWarm: () => false }), { reason: "heal" });
    expect(off.map((r) => r.id)).not.toContain("chat_search_trigger");
  });

  test("a search service that reports trouble skips the search canary", async () => {
    const out = await runSuite(deps({ searchTrouble: () => true }), { reason: "manual", only: ["chat_search_trigger"] });
    expect(out[0]!.status).toBe("skipped");
    expect(calls).toEqual([]);
  });

  test("Run checks now is debounced and leaves the search canary out unless chosen", async () => {
    const first = await runNow(deps());
    expect(first.ok && first.results.map((r) => r.id)).not.toContain("chat_search_trigger");
    expect((await runNow(deps())).ok).toBe(false);
    clock += MANUAL_DEBOUNCE_MS + 1;
    const withSearch = await runNow(deps(), { includeSearch: true });
    expect(withSearch.ok && withSearch.results.map((r) => r.id)).toContain("chat_search_trigger");
  });

  test("a hello far slower than usual pauses scheduled checks for 15 minutes", async () => {
    let n = 0;
    const d = deps({ now: () => clock, chat: async () => { clock += n++ < 6 ? 1_000 : 10_000; return OK_PROBE; } });
    for (let i = 0; i < 7; i++) { await runSuite(d, { reason: "manual", only: ["chat_hello"] }); clock += 31_000; }
    expect(schedule.slowUntil).toBeGreaterThan(clock);
    expect(dueChecks(clock, schedule, { keepWarm: true })).toEqual([]);
  });
});

describe("the one restart", () => {
  test("it goes to the Stack's supervised self-heal route, never the manual engine route; a refusal or an older Stack means no restart", async () => {
    const { stackRestart } = await import("@/lib/canary/probes");
    const { __setStackClientForTests } = await import("@/lib/stackEngine");
    const asked: string[] = [];
    const manual: string[] = [];
    const client = (accepted: boolean) => ({
      requestSelfHealRestart: async (role: string, reason: string) => { asked.push(`${role}:${reason}`); return { accepted, why: null }; },
      engineAction: async (name: string) => { manual.push(name); return {}; },
    }) as never;
    __setStackClientForTests(client(true));
    expect(await stackRestart("test")).toBe(true);
    __setStackClientForTests(client(false));
    expect(await stackRestart("test")).toBe(false);
    __setStackClientForTests({ engineAction: async (name: string) => { manual.push(name); return {}; } } as never); // an older Stack
    expect(await stackRestart("test")).toBe(false);
    __setStackClientForTests({ requestSelfHealRestart: async () => { throw new Error("404"); } } as never);
    expect(await stackRestart("test")).toBe(false);
    expect(asked).toEqual(["chat:test", "chat:test"]);
    expect(manual).toEqual([]);
    __setStackClientForTests(null);
  });
});

describe("identity", () => {
  test("the health actor is an adult and is not a stored person", async () => {
    const actor = healthActor();
    expect(actor.role).toBe("adult");
    const { people } = await import("@/db/schema");
    expect(db.select().from(people).all().some((p) => p.id === HEALTH_ACTOR_ID)).toBe(false);
  });

  test("every check has a plain name, a timeout and a Repairs title", () => {
    for (const c of CHECKS) { expect(c.name.length).toBeGreaterThan(3); expect(c.timeoutMs).toBeGreaterThan(0); expect(c.title.length).toBeGreaterThan(3); }
    expect(last("chat_hello")).toBeNull();
  });
});

describe("canary in coding mode", () => {
  test("the picture check is skipped, not failed, while the Max chat lease is held", async () => {
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    const { CHECK_BY_ID } = await import("@/lib/canary/checks");
    const { registerActiveChatLease } = await import("@/lib/chatLease");
    registerActiveChatLease({ snapshot: () => ({ state: "held" }) } as never);
    let asked = false;
    const out = await CHECK_BY_ID.get("image_tiny")!.run({ image: async () => { asked = true; return { ok: false }; } } as never, {} as never);
    registerActiveChatLease(null);
    expect(out.kind).toBe("skip"); expect(asked).toBe(false);
  });
});

describe("GPU-HEALTH-01: the graphics compiler canary", () => {
  const BAD = { ok: false, reason: "The Mac's graphics compiler is not responding." };
  const stackRoles = (chatReady = true) => __setStackClientForTests({
    roles: async () => ({ roles: [{ id: "chat", state: { state: chatReady ? "ready" : "offline" } }, { id: "image", state: { state: "installed" } }, { id: "video", state: { state: "loaded" } }] }),
    memory: async () => ({ watchdog: { level: "normal", generation_paused: false } }),
    getCodingMode: async () => ({ mode: "normal", target: "normal", state: "stable" }),
  } as never);
  beforeEach(() => { setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770"); __resetMakingHealthForTests(); stackRoles(); });
  afterEach(() => { __resetStackEngineForTests(); __resetMakingHealthForTests(); });

  test("a failing compile restarts only chat, image and video through the Stack's restart path, once, and the second failure raises the plain Repairs item", async () => {
    const d = deps({ gpuCompile: async () => BAD });
    await runSuite(d, { reason: "manual", only: ["gpu_metal"] });
    expect(restartRoles).toEqual(["chat", "image", "video"]);
    expect(canaryIssues()).toHaveLength(0);
    clock += 60_000; budgetFree = true;
    await runSuite(d, { reason: "manual", only: ["gpu_metal"] });
    expect(restartRoles).toHaveLength(3);
    const [item] = canaryIssues();
    expect(item!.title).toBe("Pictures, video and chat are paused");
    expect(item!.detail).toBe("Pictures, video and chat are paused because this Mac's graphics compiler is not responding. Restart the Mac when nobody is using it.");
  });

  test("two failures disable picture and video with the cause; chat only when its own hello also fails; a pass clears all of it", async () => {
    const bad = deps({ gpuCompile: async () => BAD });
    await runSuite(bad, { reason: "manual", only: ["gpu_metal"] });
    expect(gpuCompilerFault()).toBe(false);
    expect(await roleHealth("image")).toEqual({ availability: "ready", reason: null });
    await runSuite(bad, { reason: "manual", only: ["gpu_metal"] });
    expect(gpuCompilerFault()).toBe(true);
    expect(await roleHealth("image")).toMatchObject({ availability: "unavailable", cause: "gpu" });
    expect(await roleHealth("video")).toMatchObject({ availability: "unavailable", cause: "gpu" });
    expect(await roleHealth("chat")).toMatchObject({ availability: "ready" });
    await runSuite(deps({ chat: async () => HUNG }), { reason: "manual", only: ["chat_hello"] });
    expect(await roleHealth("chat")).toMatchObject({ availability: "unavailable", cause: "gpu" });
    await runSuite(deps(), { reason: "manual", only: ["gpu_metal"] });
    expect(gpuCompilerFault()).toBe(false);
    expect(await roleHealth("image")).toEqual({ availability: "ready", reason: null });
    expect(canaryIssues()).toHaveLength(0);
  });

  test("a Stack that cannot be asked skips the check and raises nothing", async () => {
    const out = await runSuite(deps({ gpuCompile: async () => null }), { reason: "manual", only: ["gpu_metal"] });
    expect(out[0]!.status).toBe("skipped");
    expect(restartRoles).toEqual([]);
  });

  test("the check is scheduled even with keep-warm off", () => {
    expect(dueChecks(clock, emptySchedule(), { keepWarm: false })).toContain("gpu_metal");
  });
});
