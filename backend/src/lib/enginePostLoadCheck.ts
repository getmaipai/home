// The real post-load check the household select flow (modelDownloadJobs.ts)
// runs on every fresh spawn: "rather than trusting the fit calculator
// alone" (the task this file closes out). Two independent things prove a
// model actually works, not just that the process started and answered
// /health: a real chat completion round-trips, and the memory it actually
// used is compared against modelCatalog.ts's own weightsBytes/kvCacheBytes
// formula so a bad sizing assumption in the catalog shows up as a logged
// drift instead of silently compounding into a future OOM at a bigger
// context size.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import type { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import type { HardwareInfo } from "@/lib/hardware";
import type { LaunchFlags } from "@/lib/engineAutotune";
import { kvCacheBytes, weightsBytes } from "@/lib/modelCatalog";

const execFileAsync = promisify(execFile);

export interface PostLoadCheckResult {
  /** Always true on return - a failed reply throws instead (a functional
   * gate on the spawn, not just a liveness one), so the caller never has
   * to branch on this; it's here so the shape self-documents what was
   * checked. */
  replyOk: true;
  estimatedBytes: number;
  actualBytes: number | null;
  driftPct: number | null;
  /** Fix E (docs/dev.md's "Chat reliability" - native tool calling):
   * whether this exact spawn can answer with a real `tool_calls` reply
   * when offered one. Unlike `replyOk`, never gates the spawn - Jesse,
   * 2026-09-07: chat is the core capability a household picked this
   * model for, tool calling is a Tier 2 extra on top of it, so a model
   * that can chat but not tool-call still gets to serve the household;
   * `false` here is logged as a warning (see below), the same posture
   * this file's own drift check already takes for a lesser mismatch. */
  toolCallingOk: boolean;
}

// Above this, the drift is logged as a warning (a real sizing-formula
// miss worth someone reading logs noticing) rather than routine info.
// Picked loosely, not calibrated against a measured distribution yet:
// generation buffers, allocator fragmentation, and (on CUDA) the driver's
// own context overhead all sit outside the formula on purpose, so some
// slack is expected; this just catches a formula that's wrong by a lot.
const DRIFT_WARN_THRESHOLD = 0.25;

/** Exported for engineStats.ts's periodic sampler, which reuses the exact
 * same measurement this post-load check makes once at spawn time, on a
 * timer, so "how much memory is it using right now" and "how much did it
 * use when it first loaded" never drift into two different methods of
 * measuring the same thing. Takes a plain `hasCuda` boolean rather than a
 * full HardwareInfo so a caller sampling on a recurring timer
 * (engineStats.ts) can cache that one fact on its own, longer-lived
 * schedule instead of re-running full hardware detection (and, on a CUDA
 * box, a real nvidia-smi spawn) every tick just to re-derive it. */
export async function measureProcessMemoryBytes(pid: number, hasCuda: boolean): Promise<number | null> {
  if (hasCuda) {
    try {
      const { stdout } = await execFileAsync(
        "nvidia-smi",
        ["--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"],
        { timeout: 8_000 },
      );
      for (const line of stdout.trim().split("\n")) {
        const [pidStr, memStr] = line.split(",").map((s) => s.trim());
        if (Number(pidStr) === pid) {
          const mib = Number(memStr);
          return Number.isFinite(mib) ? mib * 1_048_576 : null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  // No discrete VRAM on Apple Silicon (unified memory) or a CPU-only box:
  // the spawned process's own resident set size is the honest substitute
  // for "how much memory did loading this model actually cost."
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)], { timeout: 5_000 });
    const kb = Number(stdout.trim());
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

/** Sends one real chat completion and measures real memory use against
 * the catalog formula's estimate for the flags actually launched with.
 * Throws only when the reply itself is unusable (empty/missing) - a
 * memory-measurement failure (no `ps`/`nvidia-smi` on PATH, an unmatched
 * pid) degrades to a null actualBytes/driftPct rather than failing the
 * whole spawn, since it's diagnostic, not load-bearing. */
export async function runPostLoadCheck(
  client: LlamaServerClient,
  pid: number,
  model: ModelCapabilities,
  flags: LaunchFlags,
  hw: HardwareInfo,
): Promise<PostLoadCheckResult> {
  // The reply check and the tool-calling probe are two independent
  // requests to the same fresh spawn - run together (a code review,
  // 2026-09-07, found these serial: on a slow/CPU-bound host, every
  // fresh selection and every auto-heal restart was paying roughly
  // double the real model latency here for no reason, since neither
  // result depends on the other).
  const [response, toolCallingOk] = await Promise.all([
    client.chatComplete({
      model: "chat",
      messages: [{ role: "user", content: "Reply with just the word OK." }],
      max_tokens: 16,
    }),
    // Fix E: one canned tool-calling round trip, `tool_choice: "required"`
    // so a genuine capability gap (declines every time) can't be
    // confused with "this particular trivial question didn't need a
    // tool" the way "auto" would leave ambiguous. Never throws - see
    // PostLoadCheckResult.toolCallingOk's own comment for why this is a
    // warning, not a spawn-blocking gate.
    // A hand-built ToolDefinition literal, not llm.ts's own
    // toToolDefinition() helper: that module imports llmSupervisor.ts,
    // which imports THIS file (llmSupervisor.ts's own runPostLoadCheck()
    // call) - reusing it here would close a real import cycle for one
    // literal this file can already build itself, the same call this
    // session already made for conversationHistory.ts/lib/commands.ts.
    client
      .chatComplete({
        model: "chat",
        messages: [{ role: "user", content: "What is 2 plus 2?" }],
        max_tokens: 64,
        tools: [
          {
            type: "function",
            function: {
              name: "add",
              description: "Adds two numbers and returns their sum.",
              parameters: { type: "object", required: ["a", "b"], properties: { a: { type: "number" }, b: { type: "number" } } },
            },
          },
        ],
        tool_choice: "required",
      })
      .then((toolResponse) => (toolResponse.choices[0]?.message.tool_calls?.length ?? 0) > 0)
      .catch(() => false),
  ]);
  const text = response.choices[0]?.message.content;
  if (!text || !text.trim()) {
    throw new Error("post-load check: the model loaded but returned no reply text");
  }
  if (!toolCallingOk) {
    console.warn(
      `[enginePostLoadCheck] ${model.id}: this spawn did not answer a canned request with a real tool_calls reply - Tier 2 tool calling will be unavailable for this model; chat itself is unaffected`,
    );
  }

  if (model.sizing.kind !== "transformer_gguf") {
    throw new Error(`runPostLoadCheck: ${model.id} is not a transformer_gguf model`);
  }
  const estimatedBytes = weightsBytes(model.sizing) + kvCacheBytes(model.sizing, flags.contextSize, flags.kvCacheQuantized);
  const actualBytes = await measureProcessMemoryBytes(pid, hw.cudaDevices.length > 0);
  const driftPct = actualBytes !== null ? (actualBytes - estimatedBytes) / estimatedBytes : null;

  const gib = (n: number) => (n / 1_000_000_000).toFixed(2);
  if (actualBytes === null) {
    console.log(`[enginePostLoadCheck] ${model.id}: reply ok, estimated ${gib(estimatedBytes)}GB (actual unmeasurable on this platform)`);
  } else if (driftPct !== null && Math.abs(driftPct) > DRIFT_WARN_THRESHOLD) {
    console.warn(
      `[enginePostLoadCheck] ${model.id}: estimated ${gib(estimatedBytes)}GB, actual ${gib(actualBytes)}GB (${(driftPct * 100).toFixed(0)}% drift) - the sizing formula may need revisiting`,
    );
  } else {
    console.log(`[enginePostLoadCheck] ${model.id}: estimated ${gib(estimatedBytes)}GB, actual ${gib(actualBytes)}GB (${(driftPct! * 100).toFixed(0)}% drift)`);
  }

  return { replyOk: true, estimatedBytes, actualBytes, driftPct, toolCallingOk };
}
