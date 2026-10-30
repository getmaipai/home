import { afterEach, beforeEach, expect, test } from "bun:test";
import { fitForAdmission, setProfileSource } from "../src/lib/jobs/admissionFit";
import { closableApps, closeForJob, closedAppsLines, pickSmallestSet, reopenForJob, resetCloseAppsForTests, type CloseHelper, type CloseSettings } from "../src/lib/jobs/closeApps";
import { appliedProfile } from "../src/lib/jobs/liveFit";
import type { HelperApp } from "../src/lib/appHelperClient";
import type { ProfileRow } from "../src/lib/jobs/profileTable";

const GB = 1e9;
const app = (bundleId: string, gb: number, extra: Partial<HelperApp> = {}): HelperApp => ({ bundleId, name: bundleId.split(".").pop()!, bytes: gb * GB, frontmost: false, ...extra });
const settings: CloseSettings = { mode: "automatic", always: ["x.Safari", "x.Music", "x.Mail", "x.Terminal"], never: ["x.Terminal"], reopen: true, noReopen: [] };
const now = Date.parse("2026-10-30T12:00:00Z");

function fakeHelper(apps: HelperApp[], outcomes: Record<string, "quit" | "still_running"> = {}) {
  const calls: string[] = []; const reopened: string[] = [];
  const helper: CloseHelper = {
    list: async () => ({ installed: true, apps }),
    quit: async (id) => { calls.push(id); return outcomes[id] ?? "quit"; },
    reopen: async (id) => { reopened.push(id); return true; },
  };
  return { helper, calls, reopened };
}

beforeEach(() => resetCloseAppsForTests());
afterEach(() => setProfileSource(null));

test("only listed apps that are not Never, not in front and not used in the last two minutes are closable, biggest first", () => {
  const apps = [app("x.Safari", 9), app("x.Music", 3), app("x.Mail", 1, { frontmost: true }), app("x.Terminal", 8), app("x.Other", 20)];
  expect(closableApps(apps, settings, now).map((item) => item.bundleId)).toEqual(["x.Safari", "x.Music"]);
  // Mail was in front a minute ago: still skipped when it is no longer frontmost.
  expect(closableApps([app("x.Mail", 1)], settings, now + 60_000)).toEqual([]);
  expect(closableApps([app("x.Mail", 1)], settings, now + 3 * 60_000).map((item) => item.bundleId)).toEqual(["x.Mail"]);
});

test("the smallest set covers the shortfall; a shortfall the list cannot cover closes nothing", () => {
  const candidates = [app("a", 9), app("b", 3), app("c", 1)];
  expect(pickSmallestSet(candidates, 8 * GB)?.map((item) => item.bundleId)).toEqual(["a"]);
  expect(pickSmallestSet(candidates, 10 * GB)?.map((item) => item.bundleId)).toEqual(["a", "b"]);
  expect(pickSmallestSet(candidates, 14 * GB)).toBeNull();
});

test("a refusing app is left open and reported; closed apps reopen once the job ends", async () => {
  const { helper, calls, reopened } = fakeHelper([app("x.Safari", 9), app("x.Music", 3)], { "x.Safari": "still_running" });
  const result = await closeForJob("job-1", "video", 10, settings, helper, now);
  expect(calls).toEqual(["x.Safari", "x.Music"]);
  expect(result).toEqual({ closedApps: 1, closedBytes: 3 * GB });
  expect(closedAppsLines()).toEqual(["Closed Music to make room (about 3 GB). They reopen when the video is done.", "Safari asked to save, so it was left open."]);
  await reopenForJob("job-1", { ...settings, noReopen: [] }, helper);
  expect(reopened).toEqual(["x.Music"]);
  expect(closedAppsLines()[0]).toBe("Closed Music (about 3 GB) for the video. Reopened Music.");
});

test("an app on the no-reopen list stays closed, and mode off closes nothing", async () => {
  const { helper, calls, reopened } = fakeHelper([app("x.Safari", 9)]);
  expect(await closeForJob("job-off", "video", 5, { ...settings, mode: "off" }, helper, now)).toEqual({ closedApps: 0, closedBytes: 0 });
  expect(calls).toEqual([]);
  await closeForJob("job-2", "video", 5, settings, helper, now);
  await reopenForJob("job-2", { ...settings, noReopen: ["x.Safari"] }, helper);
  expect(reopened).toEqual([]);
});

test("the ladder closes listed apps before lowering chat, and the job record holds counts and bytes only", async () => {
  const row: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "standard" }, video: { state: "max" } } };
  setProfileSource({ table: [row], hw: { budgetGb: 100, marginGb: 2, peakGb: { video: { max: 60 } }, residentGb: { chat: { standard: 20, reduced: 5 } } }, pins: {}, priorityWeight: {}, lowerWithoutAsking: { chat: true }, close: settings });
  const { helper, calls } = fakeHelper([app("x.Safari", 9), app("x.Other", 30)]);
  let free = 72; // 80 needed
  const budget = async () => ({ freeMemoryBytes: free * GB, loaded: [] });
  const quitting: CloseHelper = { ...helper, quit: async (id) => { calls.push(id); free += 9; return "quit"; } };
  const fit = await fitForAdmission({ id: "job-3", jobClass: "video", tier: "max" }, budget, quitting);
  expect(calls).toEqual(["x.Safari"]);
  expect(fit?.outcome).toBe("run");
  expect(fit?.lowered).toEqual([]);
  expect(appliedProfile(fit!)).toEqual({ lowered: 0, queued: 0, off: 0, closed_apps: 1, closed_bytes: 9 * GB });
  expect(JSON.stringify(appliedProfile(fit!))).not.toContain("Safari");
});

test("when closing cannot cover the shortfall, nothing is closed and chat is lowered as before", async () => {
  const row: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "standard" }, video: { state: "max" } } };
  setProfileSource({ table: [row], hw: { budgetGb: 100, marginGb: 2, peakGb: { video: { max: 60 } }, residentGb: { chat: { standard: 20, reduced: 5 } } }, pins: {}, priorityWeight: {}, lowerWithoutAsking: { chat: true }, close: settings });
  const { helper, calls } = fakeHelper([app("x.Safari", 2)]);
  const fit = await fitForAdmission({ id: "job-4", jobClass: "video", tier: "max" }, async () => ({ freeMemoryBytes: 70 * GB, loaded: [] }), helper);
  expect(calls).toEqual([]);
  expect(fit?.lowered).toEqual(["chat"]);
});
