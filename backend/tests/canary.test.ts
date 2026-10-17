// CANARY-01: hermetic tests for the health checks. Fakes everywhere; nothing here reaches a live service.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { listIssues } from "@/lib/issues";
import { CHECKS, wordMatch } from "@/lib/canary/checks";
import { HEALTH_ACTOR_ID, healthActor } from "@/lib/canary/identity";
import { __resetCanaryResultsForTests, failuresInARow, last } from "@/lib/canary/results";
import { __resetCanaryRunnerForTests, canaryStatus, canaryTick, MANUAL_DEBOUNCE_MS, runNow, runSuite } from "@/lib/canary/runner";
import { __resetCanaryScheduleForTests, dueChecks, emptySchedule, INTERVAL_MS, noteRun, schedule, searchAllowed, SEARCH_PER_DAY } from "@/lib/canary/schedule";
import { decodeWav } from "@/lib/canary/wav";
import { encodeWav } from "@/lib/sttSession";
import type { CanaryDeps, ChatProbe } from "@/lib/canary/types";

const OK_PROBE: ChatProbe = { ok: true, text: "Hello!", toolCalls: [], toolErrors: [], cue: false, firstTokenMs: 120, totalMs: 900, error: null };
let clock = 1_800_000_000_000;
let calls: string[] = [];
let restarts = 0;

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
    async requestRestart() { restarts += 1; return true; },
    searchTrouble: () => false,
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

  test("a live chat that fails twice asks the Stack for ONE restart per incident", async () => {
    const d = deps({ chat: async () => ({ ...OK_PROBE, text: "" }) });
    for (let i = 0; i < 4; i++) await runSuite(d, { reason: "manual", only: ["chat_hello"] });
    expect(restarts).toBe(1);
  });

  test("a dead process does not ask for a restart (the Stack's own self-heal owns that)", async () => {
    const d = deps({ chatRole: async () => ({ availability: "unavailable", reason: "failed_start" }) });
    for (let i = 0; i < 3; i++) await runSuite(d, { reason: "manual", only: ["chat_hello"] });
    expect(restarts).toBe(0);
    expect(canaryIssues()).toHaveLength(1);
  });
});

describe("schedule", () => {
  test("light checks every 5 and 10 minutes, the rest every 30, search at most 3 a day", () => {
    const st = emptySchedule();
    const t0 = 1_800_000_000_000;
    for (const id of ["chat_hello", "embed", "chat_tool_weather", "spoken_turn", "stt_tts_loopback", "chat_picture_read", "image_tiny"] as const) noteRun(st, id, t0, 0.5);
    st.nextSearchAt = t0 + 99 * 3_600_000;
    expect(dueChecks(t0 + 6 * 60_000, st, { keepWarm: true })).toEqual(["embed"]);
    expect(dueChecks(t0 + 11 * 60_000, st, { keepWarm: true })).toEqual(["chat_hello", "embed"]);
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

  test("Keep the AI warm off leaves only the daily picture check on a timer", () => {
    expect(dueChecks(1_800_000_000_000, emptySchedule(), { keepWarm: false })).toEqual(["image_tiny"]);
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
  test("a restart goes to the Stack's engine route for the chat engine named by its setting, or by the model when the setting is automatic", async () => {
    const { stackRestart } = await import("@/lib/canary/probes");
    const { __setStackClientForTests } = await import("@/lib/stackEngine");
    const restarted: string[] = [];
    const client = (setting: string, modelId: string) => ({
      settings: async () => ({ sections: [], settings: [{ key: "stack.engines.chat.engine", value: setting, default: "auto" }] }),
      roles: async () => ({ roles: [{ id: "chat", model: { id: modelId } }] }),
      engineAction: async (name: string, action: string) => { restarted.push(`${name}:${action}`); return { ok: true }; },
    }) as never;
    __setStackClientForTests(client("llama-server", "x"));
    expect(await stackRestart("test")).toBe(true);
    __setStackClientForTests(client("auto", "muse-glimmer-30b-mlx-4bit"));
    expect(await stackRestart("test")).toBe(true);
    __setStackClientForTests(client("auto", "some-gguf"));
    expect(await stackRestart("test")).toBe(true);
    expect(restarted).toEqual(["llama-server:restart", "omlx:restart", "llama-server:restart"]);
    __setStackClientForTests({ settings: async () => { throw new Error("down"); } } as never);
    expect(await stackRestart("test")).toBe(false);
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
