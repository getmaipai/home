import { describe, expect, test } from "bun:test";
import { autotuneContextSize, resolveLaunchFlags, launchFlagsToArgs } from "@/lib/engineAutotune";
import { CATALOG } from "@/lib/modelCatalog";
import type { HardwareInfo } from "@/lib/hardware";

const GB = 1_000_000_000;
const qwen3_8b = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!;

function hw(overrides: Partial<HardwareInfo>): HardwareInfo {
  return {
    platform: "darwin",
    arch: "arm64",
    totalRamGb: 24,
    cpuCount: 8,
    isAppleSilicon: true,
    unifiedMemoryGb: 24,
    cudaDevices: [],
    ...overrides,
  };
}

describe("autotuneContextSize", () => {
  test("picks the model's own max_context when the budget is generous", () => {
    expect(autotuneContextSize(qwen3_8b.sizing as never, 24 * GB, true)).toBe(
      qwen3_8b.sizing.kind === "transformer_gguf" ? qwen3_8b.sizing.max_context : 0,
    );
  });

  test("shrinks the context to fit a tight budget", () => {
    const ctx = autotuneContextSize(qwen3_8b.sizing as never, 6 * GB, true);
    expect(ctx).toBeLessThan(qwen3_8b.sizing.kind === "transformer_gguf" ? qwen3_8b.sizing.max_context : 0);
    expect(ctx).toBeGreaterThanOrEqual(2048);
  });

  test("full-precision KV cache needs more room than quantized, at the same budget", () => {
    const quantized = autotuneContextSize(qwen3_8b.sizing as never, 7 * GB, true);
    const full = autotuneContextSize(qwen3_8b.sizing as never, 7 * GB, false);
    expect(full).toBeLessThanOrEqual(quantized);
  });
});

describe("resolveLaunchFlags", () => {
  test("defaults: quantized KV cache, flash attention on, full GPU offload when a budget exists", () => {
    const flags = resolveLaunchFlags(qwen3_8b, hw({}));
    expect(flags.kvCacheQuantized).toBe(true);
    expect(flags.flashAttention).toBe("on");
    expect(flags.gpuLayers).toBe("all");
  });

  test("CPU-only box (no budget) offloads nothing to GPU", () => {
    const flags = resolveLaunchFlags(qwen3_8b, hw({ isAppleSilicon: false, unifiedMemoryGb: 0, cudaDevices: [] }));
    expect(flags.gpuLayers).toBe(0);
  });

  test("an explicit context override wins over auto-tuning, clamped to the model's max_context", () => {
    const flags = resolveLaunchFlags(qwen3_8b, hw({}), { contextSize: 999_999 });
    expect(flags.contextSize).toBe(qwen3_8b.sizing.kind === "transformer_gguf" ? qwen3_8b.sizing.max_context : 0);
  });

  test("kvCache: 'full' turns off quantization and lets flash attention default to auto", () => {
    const flags = resolveLaunchFlags(qwen3_8b, hw({}), { kvCache: "full" });
    expect(flags.kvCacheQuantized).toBe(false);
    expect(flags.flashAttention).toBe("auto");
  });

  test("an explicit flash-attention override wins even with quantized KV cache", () => {
    const flags = resolveLaunchFlags(qwen3_8b, hw({}), { flashAttention: "off" });
    expect(flags.flashAttention).toBe("off");
  });

  test("throws for a non-transformer_gguf model (llama-server never launches a diffusion entry)", () => {
    const flux = CATALOG.find((m) => m.id === "flux2-klein-4b")!;
    expect(() => resolveLaunchFlags(flux, hw({}))).toThrow();
  });
});

describe("launchFlagsToArgs", () => {
  test("thinking mode is off by default at the server level", () => {
    const flags = resolveLaunchFlags(qwen3_8b, hw({}));
    const args = launchFlagsToArgs(flags);
    expect(args).toContain("--reasoning");
    expect(args[args.indexOf("--reasoning") + 1]).toBe("off");
  });

  test("quantized KV cache adds -ctk/-ctv q8_0; full precision adds neither", () => {
    const quantized = launchFlagsToArgs(resolveLaunchFlags(qwen3_8b, hw({})));
    expect(quantized).toContain("-ctk");
    const full = launchFlagsToArgs(resolveLaunchFlags(qwen3_8b, hw({}), { kvCache: "full" }));
    expect(full).not.toContain("-ctk");
  });
});
