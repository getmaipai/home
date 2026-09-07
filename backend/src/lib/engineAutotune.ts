// Turns a catalog model + detected hardware into the llama-server CLI
// flags that actually launch it (platform plan 4.11's other deferred
// piece beyond the download queue: "engine-launch auto-tuning", spec/llm/
// README.md / docs/dev.md's "Hardware detection and the model-selection
// wizard" entry). Three tuned knobs, each overridable by an advanced
// household setting (settings/aiKeys.ts): context size, flash attention,
// and a quantized KV cache. Flag names and defaults confirmed against a
// real `llama-server --help` on the pinned b10797 build (engineCatalog.ts),
// 2026-09-04, not assumed from older llama.cpp docs.
import type { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import type { HardwareInfo } from "@/lib/hardware";
import { primaryBudgetBytes } from "@/lib/hardware";
import { kvCacheBytes, usableChatBudgetBytes, weightsBytes } from "@/lib/modelCatalog";

type GgufSizing = Extract<ModelCapabilities["sizing"], { kind: "transformer_gguf" }>;

export interface LaunchFlagOverrides {
  /** 0 (or absent) means "let auto-tune pick." */
  contextSize?: number;
  flashAttention?: "auto" | "on" | "off";
  kvCache?: "auto" | "quantized" | "full";
}

export interface LaunchFlags {
  contextSize: number;
  flashAttention: "auto" | "on" | "off";
  kvCacheQuantized: boolean;
  gpuLayers: "all" | 0;
}

// Ladder tried largest-first; the model's own max_context always leads
// (uncapped candidates above it are pointless - llama-server would just
// clamp to the model's trained window), 2048 is the floor: docs/
// SETTINGS.md's household.conversation_retention_days help text and
// buildSystemPrompt's own budget assume a system prompt can run 1-2k
// tokens alone, so anything smaller leaves no room for a reply.
const CONTEXT_LADDER = [32768, 16384, 8192, 4096, 2048];

/** Largest context size that fits the budget at the given KV
 * quantization, searched with the exact weightsBytes/kvCacheBytes formula
 * fitsWithin() itself uses (modelCatalog.ts), so the number this picks and
 * the number the fit calculator would report for it never disagree. */
export function autotuneContextSize(sizing: GgufSizing, budgetBytes: number, kvQuantized: boolean): number {
  const usable = usableChatBudgetBytes(budgetBytes);
  const weights = weightsBytes(sizing);
  const candidates = [sizing.max_context, ...CONTEXT_LADDER].filter((c) => c <= sizing.max_context);
  for (const ctx of candidates) {
    if (weights + kvCacheBytes(sizing, ctx, kvQuantized) <= usable) return ctx;
  }
  return CONTEXT_LADDER[CONTEXT_LADDER.length - 1]!;
}

/** Resolve the real launch flags for `model` on `hw`, honoring whichever
 * of the three the household overrode (settings/aiKeys.ts's advanced
 * keys) and auto-tuning the rest. `sizing.kind !== "transformer_gguf"`
 * throws: llama-server (this function's only caller, llmSupervisor.ts)
 * never launches a diffusion entry. */
export function resolveLaunchFlags(
  model: ModelCapabilities,
  hw: HardwareInfo,
  overrides: LaunchFlagOverrides = {},
): LaunchFlags {
  if (model.sizing.kind !== "transformer_gguf") {
    throw new Error(`resolveLaunchFlags: ${model.id} is not a transformer_gguf model`);
  }
  const budget = primaryBudgetBytes(hw);
  const kvCacheQuantized = overrides.kvCache === "full" ? false : true;
  const contextSize =
    overrides.contextSize && overrides.contextSize > 0
      ? Math.min(overrides.contextSize, model.sizing.max_context)
      : autotuneContextSize(model.sizing, budget, kvCacheQuantized);
  // llama.cpp's KV-cache quantization needs flash attention on to take
  // effect (a plain -ctk/-ctv without -fa is silently ignored on this
  // build); 'auto' lets llama-server itself decide when we're not forcing
  // quantized KV, which is the safer default on hardware this catalog
  // hasn't specifically validated flash-attn against.
  const flashAttention =
    overrides.flashAttention && overrides.flashAttention !== "auto"
      ? overrides.flashAttention
      : kvCacheQuantized
        ? "on"
        : "auto";
  // budget > 0 means real dedicated VRAM/unified memory was detected
  // (hardware.ts): force full GPU offload rather than trust llama-server's
  // own 'auto' heuristic, since the fit calculator already proved the
  // whole model fits. budget === 0 (CPU-only box, no GPU detected at all)
  // leaves every layer on CPU.
  const gpuLayers: "all" | 0 = budget > 0 ? "all" : 0;
  return { contextSize, flashAttention, kvCacheQuantized, gpuLayers };
}

/** The CLI args resolveLaunchFlags()'s output maps to, split out so
 * llmSupervisor.ts's spawn call and any future "show me the exact command"
 * debug view build the identical argv from the identical flags. */
export function launchFlagsToArgs(flags: LaunchFlags): string[] {
  // Never above the actual context size: `chat.context_size_override`
  // (settings/aiKeys.ts, range 0 to 131072) lets a household pick
  // anything down to a genuinely tiny context to conserve memory, and
  // llama-server rejects (or misbehaves on) a ubatch larger than -c
  // itself - a code review (2026-09-06) caught the first cut of this
  // hardcoding 1024 unconditionally, which would have broken the spawn
  // for any household running a context override below that.
  const ubatchSize = Math.min(1024, flags.contextSize);
  const args = [
    "-c",
    String(flags.contextSize),
    "-fa",
    flags.flashAttention,
    "-ngl",
    String(flags.gpuLayers),
    // Thinking mode off by default (Jesse, 2026-09-04): the server-wide
    // fallback for any request that doesn't say otherwise. `-rea off` is
    // the CLI's own real, current spelling of this - a live spawn against
    // the pinned b10797 binary (docs/dev.md, 2026-09-04) proved the
    // `--chat-template-kwargs '{"enable_thinking":false}'` form still
    // works but logs "deprecated... use --reasoning on/off instead",
    // caught by exactly the post-load check this task asked for rather
    // than trusting the flag choice untested. llm.ts's `thinking` option
    // still overrides this per request via `chat_template_kwargs` (the
    // one path proven live end to end this session) so a household
    // member can turn reasoning on for one message without restarting.
    "--reasoning",
    "off",
    // A latency review (2026-09-06): `-ub` (prefill/ubatch size) defaults
    // to 512, and raising it toward 1024 measured ~21% higher prefill
    // throughput in one GPU-bound llama.cpp benchmark for no extra VRAM
    // (it's compute batching, not a KV allocation) - a real, close-to-free
    // win on the exact hot path (prompt prefill) this household's turn
    // latency depends on most. `--no-webui` turns off llama-server's own
    // bundled HTML UI: this process is only ever reached through
    // llm.ts/embed's own client, never a browser, so serving it is a
    // needless attack surface for zero benefit. `--metrics` exposes
    // Prometheus-format counters at `/metrics` (`requests_deferred`,
    // `kv_cache_usage_ratio`) - the harness a follow-up latency pass needs
    // to see slot queueing has nothing to scrape without this flag
    // present from the process's first launch.
    "-ub",
    String(ubatchSize),
    "--no-webui",
    "--metrics",
    // Fix E (docs/dev.md's "Chat reliability" - native tool calling):
    // llama-server parses Qwen3's Hermes-style tool calls only through
    // its Jinja chat template. The pinned b10797 binary already defaults
    // this on (confirmed live, 2026-09-07: tool calling round-tripped
    // correctly even before this flag was added) - passed explicitly so
    // a spawn never silently depends on that default surviving a future
    // binary upgrade.
    "--jinja",
  ];
  if (flags.kvCacheQuantized) args.push("-ctk", "q8_0", "-ctv", "q8_0");
  return args;
}
