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
