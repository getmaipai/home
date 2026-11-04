import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHostGuardTuning } from "@/lib/hostGuardTuning";

const oldDir = process.env.MAIPAI_HOST_GUARD_STATE_DIR;
let dir: string;
afterEach(() => { if (oldDir === undefined) delete process.env.MAIPAI_HOST_GUARD_STATE_DIR; else process.env.MAIPAI_HOST_GUARD_STATE_DIR = oldDir; if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("host guard tuning writer", () => {
  test("writes values clamped to daemon limits", () => {
    dir = mkdtempSync(join(tmpdir(), "guard-tuning-"));
    process.env.MAIPAI_HOST_GUARD_STATE_DIR = dir;
    writeFileSync(join(dir, "tuning.json"), "{}");
    const values: Record<string, unknown> = { "host.guard.mode": "live", "host.guard.hard_minutes": 100, "host.guard.metal_minutes": 1, "host.guard.max_reboots_per_12h": 9 };
    writeHostGuardTuning((key) => values[key], "darwin");
    expect(JSON.parse(readFileSync(join(dir, "tuning.json"), "utf8"))).toEqual({ mode: "live", hard_minutes: 30, metal_minutes: 5, max_reboots_per_12h: 3 });
  });
  test("missing file, another platform and an invalid mode are silent", () => {
    dir = mkdtempSync(join(tmpdir(), "guard-tuning-"));
    process.env.MAIPAI_HOST_GUARD_STATE_DIR = dir;
    expect(() => writeHostGuardTuning(() => "live", "darwin")).not.toThrow();
    expect(() => writeHostGuardTuning(() => "live", "linux")).not.toThrow();
    const path = join(dir, "tuning.json"); mkdirSync(dir, { recursive: true }); writeFileSync(path, "keep");
    const values: Record<string, unknown> = { "host.guard.mode": "unsafe" };
    expect(() => writeHostGuardTuning((key) => values[key], "darwin")).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe("keep");
  });
});
