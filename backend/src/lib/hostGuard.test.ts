import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostGuardMemoryFromJson, hostGuardStatusFromJson, hostGuardView, withHostGuardMemory } from "@/lib/hostGuard";

const base = { version: 1, owner: "sage", checked_at: 1_800_000_000, mode: "live", lookup: "ok", spawn: "ok", metal: "ok", hard_fails: 0, metal_fails: 0, uptime_s: 1000, note: "healthy" };
test("host guard view explains healthy, watching, each failure, stale, off, dry and not installed states", () => {
  expect(hostGuardView(base as never)).toMatchObject({ state: "ok", text: expect.stringContaining("working") });
  expect(hostGuardView({ ...base, spawn: "skipped" } as never)).toMatchObject({ state: "watching", text: expect.stringContaining("waiting") });
  expect(hostGuardView({ ...base, lookup: "fail" } as never).text).toContain("account");
  expect(hostGuardView({ ...base, spawn: "fail" } as never).text).toContain("service");
  expect(hostGuardView({ ...base, metal: "fail" } as never).text).toContain("graphics");
  expect(hostGuardView(null).text).toContain("recently");
  expect(hostGuardView({ ...base, mode: "off" } as never).text).toContain("turned off");
  expect(hostGuardView({ ...base, mode: "dry" } as never).text).toContain("cannot restart");
  expect(hostGuardStatusFromJson({ ...base, version: 2 })).toBeNull();
  expect(hostGuardStatusFromJson({ ...base, checked_at: 1 }, Date.now())).toBeNull();
});

test("HOST-GUARD-07: the admin row adds the memory line only under pressure, paused dev work or a recent repair", () => {
  const now = 1_800_000_000_000; const at = now / 1000;
  const memory = { version: 1, checked_at: at, pressure: 2, dev_shed: false, notice: "", summary: "Memory pressure level 2 for 30 min; biggest: fseventsd 66.0 GB", last_restart_at: 0, last_restart_result: "" };
  const view = hostGuardView(base as never);
  expect(withHostGuardMemory(view, hostGuardMemoryFromJson(memory, now), now).text).toContain("biggest: fseventsd 66.0 GB.");
  expect(withHostGuardMemory(view, hostGuardMemoryFromJson({ ...memory, pressure: 1 }, now), now)).toEqual(view);
  expect(withHostGuardMemory(view, hostGuardMemoryFromJson({ ...memory, pressure: 1, last_restart_at: at - 600, last_restart_result: "ok" }, now), now).text).toContain("restarted the Mac's file-event service 10 min ago (ok)");
  expect(hostGuardMemoryFromJson({ ...memory, checked_at: at - 400 }, now)).toBeNull();
  expect(hostGuardMemoryFromJson({ ...memory, version: 2 }, now)).toBeNull();
});

test("DEV-REAPER-01: the admin row says unused development servers were stopped in the last hour, and only then", async () => {
  const { withDevReaper } = await import("./hostGuard");
  const now = 1_800_000_000_000; const at = now / 1000;
  const view = hostGuardView(base as never);
  expect(withDevReaper(view, null, now)).toEqual(view);
  expect(withDevReaper(view, { version: 1, ts: at, waiting: 0, stopped: [{ ts: at - 7200, worktree: "/w" }] }, now)).toEqual(view);
  const one = withDevReaper(view, { version: 1, ts: at, waiting: 0, stopped: [{ ts: at - 60, worktree: "/w" }] }, now).text;
  expect(one).toContain("1 unused development server was stopped in the last hour");
  expect(withDevReaper(view, { version: 1, ts: at, waiting: 0, stopped: [{ ts: at - 60, worktree: "/a" }, { ts: at - 90, worktree: "/b" }] }, now).text).toContain("2 unused development servers were stopped");
  expect(one).not.toMatch(/memory|RAM/i);
});

test("DEV-CHECKOUT-01: the admin row names the holder, purpose, since when and who is next, shows a manual timer, and drops a stale holder", async () => {
  const { withDevLease } = await import("./hostGuard");
  const now = 1_800_000_000_000; const at = now / 1000;
  const view = hostGuardView(base as never);
  const held = { session: "speed-loop", kind: "video", whole: false, since: at - 300, beat: at - 30, what: "LTX clip bench" };
  expect(withDevLease(view, null, now)).toEqual(view);
  const row = withDevLease(view, { version: 1, ts: at, idle_s: 600, waiting: 2, next: { session: "prewarm-fix" }, held: [held] }, now).text;
  expect(row).toContain("checked out by speed-loop (LTX clip bench) since"); expect(row).toContain("Next in line: prewarm-fix and 1 more."); expect(row).toContain("after 10 idle minutes");
  expect(row).not.toMatch(/memory|RAM|\?/i);
  expect(withDevLease(view, { version: 1, ts: at, idle_s: 600, waiting: 0, held: [{ ...held, beat: at - 3000 }] }, now)).toEqual(view);
  const manual = withDevLease(view, { version: 1, ts: at, idle_s: 600, waiting: 0, held: [{ ...held, kind: "manual", what: undefined, beat: at - 5000, manual_until: at + 1500 }] }, now).text;
  expect(manual).toContain("(a hand test)"); expect(manual).toContain("returns in 25 min");
  expect(withDevLease(view, { version: 1, ts: at, idle_s: 600, waiting: 0, held: [{ ...held, manual_until: at - 5 }] }, now)).toEqual(view);
});
