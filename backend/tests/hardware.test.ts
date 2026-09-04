import { describe, expect, test, beforeEach } from "bun:test";
import {
  detectHardware,
  primaryBudgetBytes,
  __resetHardwareCacheForTests,
  type HardwareInfo,
} from "@/lib/hardware";

beforeEach(__resetHardwareCacheForTests);

function hw(overrides: Partial<HardwareInfo>): HardwareInfo {
  return {
    platform: "linux",
    arch: "x64",
    totalRamGb: 32,
    cpuCount: 8,
    isAppleSilicon: false,
    unifiedMemoryGb: 0,
    cudaDevices: [],
    ...overrides,
  };
}

describe("detectHardware", () => {
  test("resolves real values on this machine, never throws", async () => {
    const info = await detectHardware();
    expect(info.totalRamGb).toBeGreaterThan(0);
    expect(info.cpuCount).toBeGreaterThan(0);
    expect(Array.isArray(info.cudaDevices)).toBe(true);
    // Mutually exclusive: a box is either Apple Silicon (no CUDA probe run)
    // or possibly-CUDA, never both.
    if (info.isAppleSilicon) expect(info.cudaDevices).toEqual([]);
  });

  test("caches within its TTL: a page load firing several calls doesn't spawn nvidia-smi/probe repeatedly", async () => {
    const first = await detectHardware();
    const second = await detectHardware();
    expect(second).toBe(first);
    __resetHardwareCacheForTests();
    const third = await detectHardware();
    expect(third).not.toBe(first);
    expect(third).toEqual(first);
  });
});

describe("primaryBudgetBytes", () => {
  test("Apple Silicon: unified memory in bytes", () => {
    expect(primaryBudgetBytes(hw({ isAppleSilicon: true, unifiedMemoryGb: 24 }))).toBe(
      24 * 1_073_741_824,
    );
  });

  test("CPU-only box (no CUDA, not Apple Silicon): zero, no automatic pick possible", () => {
    expect(primaryBudgetBytes(hw({}))).toBe(0);
  });

  test("single CUDA device: that device's VRAM", () => {
    expect(
      primaryBudgetBytes(
        hw({ cudaDevices: [{ index: 0, name: "RTX 3070", vramBytes: 8_589_934_592 }] }),
      ),
    ).toBe(8_589_934_592);
  });

  test("multiple CUDA devices: the biggest single card's free VRAM, not the sum", () => {
    expect(
      primaryBudgetBytes(
        hw({
          cudaDevices: [
            { index: 0, name: "RTX 2070 Super", vramBytes: 8_589_934_592 },
            { index: 1, name: "RTX 3070", vramBytes: 8_589_934_592 },
          ],
        }),
      ),
    ).toBe(8_589_934_592);
  });

  test("a card already carrying another workload's VRAM usage: only the free portion counts", () => {
    expect(
      primaryBudgetBytes(
        hw({
          cudaDevices: [
            // Already has ~2GB used by something else: only ~6GB is free.
            { index: 0, name: "RTX 3070", vramBytes: 8_589_934_592, usedVramBytes: 2_147_483_648 },
          ],
        }),
      ),
    ).toBe(8_589_934_592 - 2_147_483_648);
  });
});
