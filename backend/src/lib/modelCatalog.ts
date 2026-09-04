// The model catalog (platform plan 4.11's deferred ModelCapabilities
// record, see spec/llm/README.md and spec/schemas/model-capabilities.
// schema.json) and the fit calculator that turns real detected hardware
// (hardware.ts) into "which of these actually runs here, with how much
// context." Every entry is parsed through the generated Zod model at
// module load (coreKeys.ts's same fail-fast-on-a-bad-declaration
// pattern), so a bad catalog entry breaks `bun test`, not a live request.
//
// Only `chat` has a real backend (llmSupervisor.ts / llm.ts's
// IMPLEMENTED_ROLES). The `image` and `video` entries are the researched,
// decided picks (FLUX.2 [klein] 4B, Wan 2.2 TI2V-5B) recorded now so the
// decision isn't lost, marked `implemented: false`: no ComfyUI-equivalent
// sidecar, download queue, or route exists yet to run them. Recommending
// or selecting a non-implemented entry is a documentation-only no-op
// today (see recommend()'s doc comment).
import { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import type { HardwareInfo } from "@/lib/hardware";
import { primaryBudgetBytes } from "@/lib/hardware";

const GB = 1_000_000_000;

// VRAM the model can't have: display/compositor + CUDA context overhead.
// Same figure the legacy engineAutotune.ts calibrated against a real dev
// box; kept rather than re-deriving from nothing.
const OVERHEAD_BYTES = 0.7 * GB;
// Fraction of the budget we're willing to fill (slack for fragmentation).
const USABLE_FRACTION = 0.96;

export const CATALOG: ModelCapabilities[] = [
  ModelCapabilities.parse({
    id: "qwen3-8b-instruct-q4-k-m",
    role: "chat",
    label: "Qwen3 8B Instruct",
    license: "Apache-2.0",
    engine: "llama-server",
    implemented: true,
    quality_tier: "standard",
    tags: ["recommended", "fast"],
    pros: ["Runs well on a single 8GB GPU", "Fast replies"],
    cons: ["Less capable than a larger model on hard reasoning tasks"],
    sizing: {
      kind: "transformer_gguf",
      param_count_billion: 8.2,
      bits_per_weight: 4,
      gguf_overhead_fraction: 0.1,
      num_layers: 36,
      num_kv_heads: 8,
      head_dim: 128,
      max_context: 32768,
    },
  }),
  // Not run by anything yet (image role, implemented: false). Recorded so
  // the LoRA-ecosystem tradeoff Jesse and this session worked through
  // (2026-09-04, docs/dev.md) survives as data, not just chat history:
  // Juggernaut XL has by far the larger existing community LoRA library;
  // FLUX.2 is sharper with a smaller but real and growing one. The
  // eventual model-selection wizard presents both, doesn't pick one.
  ModelCapabilities.parse({
    id: "juggernaut-xl-ragnarok",
    role: "image",
    label: "Juggernaut XL Ragnarok (SDXL)",
    license: "OpenRAIL++-M",
    engine: "comfyui",
    implemented: false,
    quality_tier: "standard",
    tags: ["largest-lora-library"],
    pros: ["By far the largest existing community LoRA library", "Well-established, predictable output"],
    cons: ["Softer image quality than newer checkpoints"],
    sizing: { kind: "diffusion", approx_vram_bytes: 7.5 * GB },
  }),
  ModelCapabilities.parse({
    id: "flux2-klein-4b",
    role: "image",
    label: "FLUX.2 [klein] 4B",
    license: "Apache-2.0",
    engine: "comfyui",
    implemented: false,
    quality_tier: "high",
    tags: ["sharper"],
    pros: ["Sharper output than SDXL-class checkpoints", "Purpose-built for 8GB cards", "First-party LoRA training support"],
    cons: ["Smaller community LoRA library than SDXL, though real and growing"],
    sizing: { kind: "diffusion", approx_vram_bytes: 7 * GB },
  }),
  ModelCapabilities.parse({
    id: "wan-2-2-ti2v-5b-fp8",
    role: "video",
    label: "Wan 2.2 TI2V-5B (FP8)",
    license: "Apache-2.0",
    engine: "comfyui",
    implemented: false,
    quality_tier: "high",
    tags: ["recommended"],
    pros: ["720p clips on a single 8GB card", "Active community LoRA library (motion, character, style)"],
    cons: ["Clip length limited to a few seconds at this quant"],
    sizing: { kind: "diffusion", approx_vram_bytes: 7.5 * GB },
  }),
];

export interface ModelFit {
  model: ModelCapabilities;
  fits: boolean;
  /** Context length the fit was computed at (transformer_gguf only). */
  contextUsed?: number;
  requiredBytes: number;
  budgetBytes: number;
}

/** 2 x layers x kv_heads x head_dim x context x bytes_per_element (K+V).
 * kv_heads, not total attention heads: GQA models (Qwen, Llama 3) have far
 * fewer KV heads than attention heads, and using num_heads here
 * overestimates the cache by that ratio. q8 KV cache (this hub's default,
 * matching the legacy engineGuards.ts choice) halves the f16 figure. */
export function kvCacheBytes(
  sizing: Extract<ModelCapabilities["sizing"], { kind: "transformer_gguf" }>,
  contextLength: number,
  kvQuantized = true,
): number {
  const bytesPerElement = kvQuantized ? 1 : 2;
  return 2 * sizing.num_layers * sizing.num_kv_heads * sizing.head_dim * contextLength * bytesPerElement;
}

/** params x bits/8 x (1 + gguf overhead). The overhead fraction covers
 * GGUF block metadata/scales the raw bit-packing doesn't include. */
export function weightsBytes(sizing: Extract<ModelCapabilities["sizing"], { kind: "transformer_gguf" }>): number {
  return (
    sizing.param_count_billion * 1_000_000_000 * (sizing.bits_per_weight / 8) * (1 + (sizing.gguf_overhead_fraction ?? 0.1))
  );
}

/** Fit one catalog entry against a byte budget. `contextLength` only
 * matters for transformer_gguf sizing; diffusion entries are a flat
 * working-VRAM figure with no context concept. */
export function fitsWithin(model: ModelCapabilities, budgetBytes: number, contextLength?: number): ModelFit {
  if (model.sizing.kind === "diffusion") {
    // No OVERHEAD_BYTES subtraction here: that figure is calibrated for an
    // always-resident chat server sharing a card with the OS compositor
    // (hardware.ts's card is picked to avoid exactly that for the LLM).
    // approx_vram_bytes is a real measured working figure for the whole
    // pipeline already, the same flat-threshold comparison the legacy
    // hwfit.ts used for its MIN_COMFY_VRAM check.
    const usable = budgetBytes * USABLE_FRACTION;
    const required = model.sizing.approx_vram_bytes;
    return { model, fits: required <= usable, requiredBytes: required, budgetBytes: usable };
  }
  const usable = Math.max(0, budgetBytes * USABLE_FRACTION - OVERHEAD_BYTES);
  const ctx = Math.min(contextLength ?? 8192, model.sizing.max_context);
  const required = weightsBytes(model.sizing) + kvCacheBytes(model.sizing, ctx);
  return { model, fits: required <= usable, contextUsed: ctx, requiredBytes: required, budgetBytes: usable };
}

/** Every catalog entry for a role, annotated with whether it fits this
 * hardware, best-fit first (fits before doesn't, then smallest required
 * bytes: the legacy autotune's "fast over big" preference). The wizard
 * renders every entry (fitting or not) with its pros/cons so the choice
 * stays the household's, not an auto-pick: see docs/UI.md's disclosure
 * rule this session applied to the model-selection step (2026-09-04).
 * Entries with `implemented: false` are included for their pros/cons and
 * documentation value; nothing consumes a selection of one yet. */
export function recommend(role: ModelCapabilities["role"], hw: HardwareInfo, contextLength?: number): ModelFit[] {
  const budget = primaryBudgetBytes(hw);
  return CATALOG.filter((m) => m.role === role)
    .map((m) => fitsWithin(m, budget, contextLength))
    .sort((a, b) => {
      if (a.fits !== b.fits) return a.fits ? -1 : 1;
      return a.requiredBytes - b.requiredBytes;
    });
}
