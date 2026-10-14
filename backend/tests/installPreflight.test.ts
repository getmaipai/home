import { describe, expect, test } from "bun:test";
import { checkInstallPreflight, type InstallPreflightOptions } from "../src/lib/installPreflight";

const fixed = (patch: Partial<InstallPreflightOptions> = {}): InstallPreflightOptions => ({
  platform: "linux",
  releaseHost: "github.com",
  port: 3000,
  freeBytes: () => 8_000_000_000,
  memoryBytes: () => ({ free: 4_000_000_000, total: 16_000_000_000 }),
  systemVersion: () => "Linux test",
  lockInfo: () => null,
  portBusy: async () => false,
  reachReleaseHost: async () => true,
  now: () => new Date("2026-10-14T12:00:00.000Z"),
  ...patch,
});

const outcome = async (patch: Partial<InstallPreflightOptions>) => {
  const rows = await checkInstallPreflight(fixed(patch));
  return Object.fromEntries(rows.map((row) => [row.code.split(".")[1], row.severity]));
};

describe("checkInstallPreflight", () => {
  test("returns six health-item-shaped rows in stable order", async () => {
    const rows = await checkInstallPreflight(fixed());
    expect(rows.map((row) => row.code)).toEqual([
      "install.disk.ok", "install.memory.ok", "install.system.ok", "install.instance.ok", "install.port.ok", "install.release.reachable",
    ]);
    for (const row of rows) {
      expect(row).toHaveProperty("severity");
      expect(row).toHaveProperty("id", row.code);
      expect(row).toHaveProperty("message", row.text);
      expect(row).toHaveProperty("title");
      expect(row).toHaveProperty("text");
      expect(row).toHaveProperty("since", "2026-10-14T12:00:00.000Z");
      expect(row).toHaveProperty("cause");
      if (row.severity) expect(row).toHaveProperty("fix");
    }
  });

  test.each([
    ["disk", { freeBytes: () => 8_000_000_000 }, null],
    ["disk", { freeBytes: () => 1_000_000_000 }, "error"],
    ["disk", { freeBytes: () => null }, "warning"],
    ["memory", { memoryBytes: () => ({ free: 4_000_000_000, total: 16_000_000_000 }) }, null],
    ["memory", { memoryBytes: () => ({ free: 4_000_000_000, total: 2_000_000_000 }) }, "error"],
    ["memory", { memoryBytes: () => ({ free: 100_000_000, total: 16_000_000_000 }) }, "warning"],
    ["system", { platform: "linux" }, null],
    ["system", { platform: "aix" }, "error"],
    ["system", { platform: "darwin" }, null],
    ["system", { platform: "darwin", architecture: "x64" }, "error"],
    ["instance", { lockInfo: () => null }, null],
    ["instance", { lockInfo: () => ({ pid: 42 }) }, "error"],
    ["instance", { lockInfo: () => ({ pid: 42, port: 3000 }) }, "error"],
    ["port", { portBusy: async () => false }, null],
    ["port", { portBusy: async () => true }, "warning"],
    ["port", { portBusy: async () => false, port: 8770 }, null],
    ["release", { reachReleaseHost: async () => true }, null],
    ["release", { reachReleaseHost: async () => false }, "warning"],
    ["release", { reachReleaseHost: async () => true, releaseHost: "github.com" }, null],
  ] as Array<[string, Partial<InstallPreflightOptions>, string | null]>)("%s check supports pass/warning/blocker fixtures", async (name, patch, expected) => {
    const result = await outcome(patch);
    expect(result[name]).toBe(expected);
    const rows = await checkInstallPreflight(fixed(patch));
    const affected = rows.find((row) => row.code.split(".")[1] === name)!;
    if (expected) {
      expect(affected.fix?.label.length).toBeGreaterThan(0);
      expect(affected.text.length).toBeGreaterThan(0);
    }
  });

  test("uses only the named public release host and never issues a request for another host", async () => {
    const seen: string[] = [];
    await checkInstallPreflight(fixed({ reachReleaseHost: async (host) => { seen.push(host); return true; } }));
    expect(seen).toEqual(["github.com"]);
  });
});
