import { describe, expect, test } from "bun:test";
import {
  checkNvidiaSysmemFallback,
  NVIDIA_SYSMEM_FALLBACK_AMBER_COPY,
  type NvidiaSysmemFallbackReader,
} from "@/setup/checks/nvidiaSysmemFallback";

function fixture(hasNvidiaGpu: boolean, isSysmemFallbackEnabled: boolean): NvidiaSysmemFallbackReader {
  return {
    hasNvidiaGpu: async () => hasNvidiaGpu,
    isSysmemFallbackEnabled: async () => isSysmemFallbackEnabled,
  };
}

describe("NVIDIA system-memory fallback setup check", () => {
  test("reports amber with the prescribed fix when fallback is on", async () => {
    await expect(checkNvidiaSysmemFallback(fixture(true, true))).resolves.toEqual({
      status: "amber",
      message: NVIDIA_SYSMEM_FALLBACK_AMBER_COPY,
    });
  });

  test("reports green when an NVIDIA GPU has fallback off", async () => {
    await expect(checkNvidiaSysmemFallback(fixture(true, false))).resolves.toEqual({ status: "green" });
  });

  test("reports idle when no NVIDIA GPU is present", async () => {
    const reader = fixture(false, true);
    await expect(checkNvidiaSysmemFallback(reader)).resolves.toEqual({ status: "idle" });
  });

  test("reports idle and never throws when a system reader fails", async () => {
    const reader: NvidiaSysmemFallbackReader = {
      hasNvidiaGpu: async () => {
        throw new Error("fixture reader failure");
      },
      isSysmemFallbackEnabled: async () => true,
    };
    await expect(checkNvidiaSysmemFallback(reader)).resolves.toEqual({ status: "idle" });
  });
});
