import { describe, expect, test } from "bun:test";
import { CATALOG, fitsWithin, kvCacheBytes, weightsBytes, recommend, thinkingModeFor } from "@/lib/modelCatalog";
import { resolveTurnBudget } from "@/lib/turnMachine/budget";
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
    osVersion: "test",
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

describe("TOOL-OFFER-01: recall remains explicitly off", () => {
  test("no chat model's derived offer set contains recall", () => {
    for (const model of CATALOG) {
      if (model.role !== "chat" || !model.turn_budget) continue;
      expect(resolveTurnBudget(model.id, "adult").tools_offered).not.toContain("recall");
    }
  });
});

// STACK-MUSE-01 (owner's rule 2026-10-16): the chat pin above 24 GB is
// Muse Glimmer 30B; Home mirrors the Stack's two pins so it knows their
// thinking mode and turn budget.
describe("Muse Glimmer 30B (STACK-MUSE-01)", () => {
  const pins = [
    {
      id: "muse-glimmer-30b-q4-k-xl",
      file: "Muse-Glimmer-30B-KQuant-Dynamic-Q4_K_XL.gguf",
      sha256: "ac7023d6a4c704eb9af54ab53e476a66b7f5b6c0ef2fc4a8dde5253c291a6c38",
      bytes: 19_653_960_832,
    },
    {
      id: "muse-glimmer-30b-q4-k-m",
      file: "Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf",
      sha256: "4cc57c0f51040a226e5a72cc47b7613f7772950e460a665f7083de89f183f60e",
      bytes: 16_756_683_904,
    },
  ];

  test("both pins are catalogued with the Stack's revision, sha256 and bytes", () => {
    for (const pin of pins) {
      const model = CATALOG.find((m) => m.id === pin.id);
      expect(model).toBeDefined();
      expect(model?.role).toBe("chat");
      expect(model?.download?.url).toBe(
        `https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF/resolve/70bf1b61ac09f91b24d39038091b41c582bc5d7a/${pin.file}`,
      );
      expect(model?.download?.sha256).toBe(pin.sha256);
      expect(model?.download?.approx_bytes).toBe(pin.bytes);
    }
  });

  test("the sizing reproduces each pinned file's size within 1%", () => {
    for (const pin of pins) {
      const model = CATALOG.find((m) => m.id === pin.id)!;
      const bytes = weightsBytes(model.sizing as never);
      expect(Math.abs(bytes - pin.bytes) / pin.bytes).toBeLessThan(0.01);
    }
  });

  test("Muse always reasons: thinking mode is 'always', and its budget resolves for an adult", () => {
    for (const pin of pins) {
      expect(thinkingModeFor(pin.id)).toBe("always");
      const budget = resolveTurnBudget(pin.id, "adult");
      expect(budget.deadlines_ms.model).toBe(30000);
      expect(budget.deadlines_ms.total).toBe(60000);
    }
    expect(thinkingModeFor("qwen3-8b-instruct-q4-k-m")).toBe("switchable");
  });

  test("the Studio (128 GB unified) fits both Muse files; a 24 GB Mac still ranks the 8B first", () => {
    // Which file a machine actually runs is the Stack's tier binding
    // (p16 keeps the 8B, p32 the Q4_K_M, p64 and p128 the Q4_K_XL); Home's
    // fit check only has to agree that the Studio can hold either.
    const studio = recommend("chat", hw({ isAppleSilicon: true, unifiedMemoryGb: 128 }));
    for (const pin of pins) expect(studio.find((f) => f.model.id === pin.id)?.fits).toBe(true);
    const laptop = recommend("chat", hw({ isAppleSilicon: true, unifiedMemoryGb: 24 }));
    expect(laptop[0]?.model.id).toBe("qwen3-8b-instruct-q4-k-m");
  });
});

describe("Muse Glimmer 30B reads pictures (VISION-03a)", () => {
  test("both Muse records mirror the Stack's projector pin", () => {
    for (const id of ["muse-glimmer-30b-q4-k-xl", "muse-glimmer-30b-q4-k-m"]) {
      const record = CATALOG.find((model) => model.id === id)!;
      expect(record.tags).toContain("reads-pictures");
      expect(record.image_input?.projector).toMatchObject({
        file: "mmproj-Muse-Glimmer-30B-Q4_K_M.gguf",
        download: { sha256: "f48b452316f9b213758e8659444029b961a24a07f99a1abb2a9f88b06f7c00c6", approx_bytes: 1_400_328_928 },
      });
      expect(record.image_input?.projector.download.url).toContain(record.download!.url.split("/resolve/")[1]!.split("/")[0]!);
    }
  });
});

// MODEL-SWITCH-01: Qwen3.6-35B-A3B mirrors the Stack's optional pin.
describe("Qwen3.6 35B A3B (MODEL-SWITCH-01)", () => {
  const id = "qwen3-6-35b-a3b-ud-q4-k-xl";
  const sha256 = "707a55a8a4397ecde44de0c499d3e68c1ad1d240d1da65826b4949d1043f4450";

  test("it is catalogued with the Stack's revision, sha256, bytes and projector", () => {
    const model = CATALOG.find((m) => m.id === id)!;
    expect(model.role).toBe("chat");
    expect(model.download).toEqual({
      url: "https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/a483e9e6cbd595906af30beda3187c2663a1118c/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
      sha256,
      approx_bytes: 22_360_456_160,
    });
    expect(model.image_input?.projector.download.sha256).toBe("8971ee4f331ff0a4c609374f32984b3d4e6dc086c0aa35f1d637fad1829e887f");
    expect(model.image_input?.projector.download.url).toContain("/resolve/a483e9e6cbd595906af30beda3187c2663a1118c/");
    expect(Math.abs(weightsBytes(model.sizing as never) - 22_360_456_160) / 22_360_456_160).toBeLessThan(0.01);
  });

  test("thinking can be switched off: the mode is 'switchable' and a minor's budget keeps thinking off", () => {
    expect(thinkingModeFor(id)).toBe("switchable");
    expect(resolveTurnBudget(id, "adult").thinking_budget_tokens).toBe(0);
    expect(resolveTurnBudget(id, "child").thinking_for_minors).toBe(false);
  });

  test("it is a choice, never the first recommendation on the Studio", () => {
    const studio = recommend("chat", hw({ isAppleSilicon: true, unifiedMemoryGb: 128 }));
    expect(studio.find((f) => f.model.id === id)?.fits).toBe(true);
  });
});

describe("Qwen3.8 uncensored replacement (MODEL-SWITCH-02)", () => {
  const id = "qwen3-8-27b-huihui-abliterated-iq4-xs";
  test("the Home record mirrors Stack's model and projector pins", () => {
    const model = CATALOG.find((entry) => entry.id === id)!;
    expect(model.role).toBe("chat");
    expect(model.download).toEqual({
      url: "https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF/resolve/1c69098e9c32db6dc06fc48f1d6cc75ad07da89e/Huihui-Qwen3.8-27B-abliterated-UD-IQ4_XS.gguf",
      sha256: "d83adbbbaace8acdfcfe28004f779326176b9df00b4ec99dc6c24d749723d3b9",
      approx_bytes: 14_403_496_864,
    });
    expect(model.image_input?.projector.download).toMatchObject({
      sha256: "c9a09064683620bea3d3bfed5d4462e1a97a7d2fff7e5045d6862a0a85eeb5b5",
      approx_bytes: 931_145_888,
    });
    expect(thinkingModeFor(id)).toBe("switchable");
    expect(Math.abs(weightsBytes(model.sizing as never) - 14_403_496_864) / 14_403_496_864).toBeLessThan(0.01);
  });

  test("fits the Studio and reports that tool use has not been measured", () => {
    const model = CATALOG.find((entry) => entry.id === id)!;
    expect(recommend("chat", hw({ isAppleSilicon: true, unifiedMemoryGb: 128 })).find((entry) => entry.model.id === id)?.fits).toBe(true);
    expect(model.turn_budget?.measured.on).toContain("not yet measured");
  });

  test("it carries the uncensored tag alone and replaces the Qwen3.6 record", () => {
    expect(CATALOG.filter((entry) => entry.tags?.includes("uncensored")).map((entry) => entry.id)).toEqual([id]);
    expect(CATALOG.find((entry) => entry.id === "qwen3-6-35b-a3b-uncensored-hauhaucs-q4-k-m")).toBeUndefined();
    expect(CATALOG.find((entry) => entry.id === "qwen3-8-27b-uncensored-hauhaucs-q4-k-p")).toBeUndefined();
    expect(recommend("chat", hw({ isAppleSilicon: true, unifiedMemoryGb: 128 }))[0]?.model.id).not.toBe(id);
  });
});
