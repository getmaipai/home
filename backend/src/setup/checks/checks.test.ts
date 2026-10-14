import { describe, expect, test } from "bun:test";
import { isSupportedInstallPlatform } from "@/lib/installPreflight";
import { checkNvidiaSysmemFallback } from "./nvidiaSysmemFallback";

describe("setup check row helpers", () => {
  test("the shared installer platform rule accepts supported hosts and refuses Intel macOS", () => {
    expect(isSupportedInstallPlatform("darwin", "arm64")).toBe(true);
    expect(isSupportedInstallPlatform("linux", "x64")).toBe(true);
    expect(isSupportedInstallPlatform("darwin", "x64")).toBe(false);
    expect(isSupportedInstallPlatform("freebsd", "x64")).toBe(false);
  });

  test("NVIDIA check fixtures represent green, amber and idle", async () => {
    await expect(checkNvidiaSysmemFallback({ hasNvidiaGpu: async () => true, isSysmemFallbackEnabled: async () => false })).resolves.toEqual({ status: "green" });
    await expect(checkNvidiaSysmemFallback({ hasNvidiaGpu: async () => true, isSysmemFallbackEnabled: async () => true })).resolves.toMatchObject({ status: "amber" });
    await expect(checkNvidiaSysmemFallback({ hasNvidiaGpu: async () => { throw new Error("unreadable"); }, isSysmemFallbackEnabled: async () => false })).resolves.toEqual({ status: "idle" });
  });
});
