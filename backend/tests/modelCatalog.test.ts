import { describe, expect, test } from "bun:test";
import { CATALOG, fitsWithin, kvCacheBytes, weightsBytes, recommend } from "@/lib/modelCatalog";
import type { HardwareInfo } from "@/lib/hardware";

const GB = 1_000_000_000;

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

const qwen3_8b = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!;

describe("weightsBytes", () => {
  test("Qwen3 8B at Q4_K_M lands around 4.5-5GB, matching real GGUF file sizes", () => {
    const bytes = weightsBytes(qwen3_8b.sizing as never);
    expect(bytes).toBeGreaterThan(4.3 * GB);
    expect(bytes).toBeLessThan(5.2 * GB);
  });
});

describe("kvCacheBytes", () => {
  test("uses num_kv_heads (GQA), not total attention heads", () => {
    // Qwen3 8B: 36 layers, 8 KV heads, head_dim 128. 8k context, q8 (1 byte/elem).
    const bytes = kvCacheBytes(qwen3_8b.sizing as never, 8192, true);
    expect(bytes).toBe(2 * 36 * 8 * 128 * 8192 * 1);
  });

  test("f16 KV cache is double q8", () => {
    const q8 = kvCacheBytes(qwen3_8b.sizing as never, 8192, true);
    const f16 = kvCacheBytes(qwen3_8b.sizing as never, 8192, false);
    expect(f16).toBe(q8 * 2);
  });
});

describe("fitsWithin", () => {
  test("Qwen3 8B fits an 8GB card at 8k context", () => {
    const fit = fitsWithin(qwen3_8b, 8 * GB, 8192);
    expect(fit.fits).toBe(true);
    expect(fit.contextUsed).toBe(8192);
  });

  test("Qwen3 8B does not fit a 2GB card", () => {
    const fit = fitsWithin(qwen3_8b, 2 * GB, 8192);
    expect(fit.fits).toBe(false);
  });

  test("context length is clamped to the model's own max_context", () => {
    const fit = fitsWithin(qwen3_8b, 24 * GB, 999_999);
    expect(fit.contextUsed).toBe(qwen3_8b.sizing.kind === "transformer_gguf" ? qwen3_8b.sizing.max_context : undefined);
  });

  test("diffusion sizing ignores contextLength entirely", () => {
    const flux = CATALOG.find((m) => m.id === "flux2-klein-4b")!;
    const fit = fitsWithin(flux, 8 * GB, 999_999);
    expect(fit.contextUsed).toBeUndefined();
    expect(fit.fits).toBe(true);
  });
});

describe("recommend", () => {
  test("Apple Silicon M4 Pro (24GB unified): Qwen3 8B fits", () => {
    const fits = recommend("chat", hw({ isAppleSilicon: true, unifiedMemoryGb: 24 }));
    expect(fits[0]?.model.id).toBe("qwen3-8b-instruct-q4-k-m");
    expect(fits[0]?.fits).toBe(true);
  });

  test("a single 8GB CUDA card (the MSI's built-in 2070 Super without the eGPU docked): still fits", () => {
    const fits = recommend(
      "chat",
      hw({ cudaDevices: [{ index: 0, name: "RTX 2070 Super", vramBytes: 8 * GB }] }),
    );
    expect(fits[0]?.fits).toBe(true);
  });

  test("CPU-only box: nothing fits, but the catalog is still returned for the wizard to show as unavailable", () => {
    const fits = recommend("chat", hw({}));
    expect(fits.length).toBeGreaterThan(0);
    expect(fits.every((f) => !f.fits)).toBe(true);
  });

  test("image role returns both researched picks even though neither is implemented yet", () => {
    const fits = recommend("image", hw({ isAppleSilicon: true, unifiedMemoryGb: 24 }));
    const ids = fits.map((f) => f.model.id).sort();
    expect(ids).toEqual(["flux2-klein-4b", "juggernaut-xl-ragnarok"]);
    expect(fits.every((f) => !f.model.implemented)).toBe(true);
  });

  test("fitting entries sort before non-fitting ones", () => {
    const fits = recommend(
      "chat",
      hw({ cudaDevices: [{ index: 0, name: "tiny", vramBytes: 1 * GB }] }),
    );
    for (let i = 1; i < fits.length; i++) {
      expect(!fits[i - 1]!.fits && fits[i]!.fits).toBe(false);
    }
  });
});
