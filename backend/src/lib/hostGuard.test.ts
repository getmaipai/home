import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostGuardStatusFromJson, hostGuardView } from "@/lib/hostGuard";

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
