import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TRANSITION_SECONDS, __resetTransitionsForTests, beginTransition, estimateSeconds, observeModeChange, recordTransition, transitionNotice, waitPhrase } from "@/lib/chatTransitions";
import { collectHealth } from "@/lib/healthSnapshot";
import { __setRoleHealthForTests } from "@/lib/roleHealth";

let file = "";
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), "transitions-")), "t.json"); __resetTransitionsForTests(file); });
afterEach(() => { __resetTransitionsForTests(null); __setRoleHealthForTests({}); });

describe("chat transition times", () => {
  test("no history gives the measured default, then the median of recent runs", () => {
    expect(estimateSeconds("enter_reduced")).toBe(DEFAULT_TRANSITION_SECONDS.enter_reduced);
    for (const ms of [14_000, 30_000, 18_000]) recordTransition("enter_reduced", ms);
    expect(estimateSeconds("enter_reduced")).toBe(18);
  });
  test("history survives a restart, nonsense is dropped, only the last 7 count", () => {
    recordTransition("leave_reduced", 0);
    recordTransition("leave_reduced", Number.NaN);
    expect(estimateSeconds("leave_reduced")).toBe(DEFAULT_TRANSITION_SECONDS.leave_reduced);
    for (let i = 0; i < 9; i += 1) recordTransition("leave_reduced", i < 2 ? 90_000 : 10_000);
    __resetTransitionsForTests(file);
    expect(estimateSeconds("leave_reduced")).toBe(10);
  });
  test("the wait rounds to 5 seconds and says a minute past 50", () => {
    expect(waitPhrase(16)).toBe("15 seconds");
    expect(waitPhrase(9)).toBe("10 seconds");
    expect(waitPhrase(1)).toBe("5 seconds");
    expect(waitPhrase(50)).toBe("50 seconds");
    expect(waitPhrase(51)).toBe("a minute");
  });
  test("every line is one short sentence pair, no em dash, and switches to running-long after 1.5x", () => {
    const fresh = transitionNotice("enter_reduced", 1000);
    expect(fresh.adult).toBe("One moment. Back in about 15 seconds.");
    expect(transitionNotice("mode_change", 0).adult).toBe("Getting ready. Back in about a minute.");
    expect(transitionNotice("enter_reduced", 24_000).adult).toBe("One moment. Back in about 15 seconds.");
    expect(transitionNotice("enter_reduced", 24_100).adult).toBe("Taking longer than usual. Still working.");
    for (const n of [fresh, transitionNotice("mode_change", 0)]) for (const line of [n.adult, n.teen, n.child]) { expect(line.length).toBeLessThanOrEqual(45); expect(line).not.toContain("—"); }
  });
  test("a coding-mode change is timed by watching it start and stop", () => {
    expect(observeModeChange(true, 1_000)).toBe(0);
    expect(observeModeChange(true, 31_000)).toBe(30_000);
    expect(observeModeChange(false, 41_000)).toBeNull();
    expect(estimateSeconds("mode_change")).toBe(40);
  });
  test("the health row shows the switching line while a Reduced swap runs, with the measured time", async () => {
    recordTransition("enter_reduced", 61_000);
    beginTransition("enter_reduced", Date.now() - 3000);
    __setRoleHealthForTests({ chat: { availability: "starting", reason: null, cause: "reduced_swap" } });
    const { engines } = await collectHealth();
    expect(engines.chat.notice?.adult).toBe("One moment. Back in about a minute.");
    expect(engines.chat.notice?.child).toBe("One moment. Back in about a minute.");
  });
});
