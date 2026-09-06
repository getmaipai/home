// The router skeleton for platform plan 4.11's `chat` role, the "engine
// is llama-server, only" supervisor scaled down to exactly one role and
// one process, since that's all this pass has a real caller for. See
// spec/llm/README.md for the full scope and what's deferred (the real
// residency policy across many roles, GPU placement).
//
// Which backend answers `chat` is chosen once, lazily, on first use, in
// this order:
//   1. MAIPAI_LLAMA_SERVER_URL - point at an already-running server
//      (real or someone else's stub). Nothing is spawned.
//   2. MAIPAI_LLAMA_SERVER_BIN + MAIPAI_CHAT_MODEL_PATH - spawn a real
//      llama-server as a child process with no auto-tuning (a developer's
//      explicit override, unchanged since this pass).
//   3. The household's selected chat model (settings key chat.model_id,
//      settings/aiKeys.ts): if its GGUF and a platform-matched engine
//      binary are both already on disk (modelDownloadJobs.ts put them
//      there), spawn it for real with engineAutotune.ts's launch flags
//      and run enginePostLoadCheck.ts before returning it as healthy. A
//      configured-but-broken selection THROWS here rather than silently
//      falling back to the stub (tier 4): llm.ts's complete() turns that
//      into a real "chat model unavailable" 503 a surface can show,
//      instead of quietly serving canned stub replies while the household
//      believes a real model is answering.
//   4. Nothing selected yet (every dev machine and the test suite today,
//      and a fresh install before its first model choice) - start the
//      in-process stub server. Real code path, canned answers; see
//      spec/llm/README.md's "What's real vs. stubbed".
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";
import type { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import { CATALOG } from "@/lib/modelCatalog";
import { detectHardware } from "@/lib/hardware";
import { selectEngineBinary, ENGINE_READY_MARKER } from "@/lib/engineCatalog";
import { modelsDir, enginesDir } from "@/lib/paths";
import { resolveLaunchFlags, launchFlagsToArgs, type LaunchFlags, type LaunchFlagOverrides } from "@/lib/engineAutotune";
import { runPostLoadCheck, type PostLoadCheckResult } from "@/lib/enginePostLoadCheck";
import { getHouseholdSettingValue } from "@/lib/settings";
import { spawnAndWaitHealthy, freePort, sweepOrphanProcesses } from "@/lib/sidecars";
import { assertNotInCrashBootHold } from "@/lib/dirtyBoot";
import { startResourceGovernor } from "@/lib/resourceGovernor";
import { resolveIssue } from "@/lib/issues";

export type BackendKind = "url" | "override" | "selection" | "stub";

interface ChatBackend {
  client: LlamaServerClient;
  stop: () => void;
  /** Only set for a backend this module actually spawned (tiers 2-3): the
   * child's pid, for enginePostLoadCheck.ts's real memory measurement. */
  pid?: number;
  kind: BackendKind;
  modelId?: string;
  startedAt: string;
}

export interface EngineStatus {
  /** "stopped": a household member (or a failed spawn's cleanup) stopped
   * it on purpose and it will NOT auto-respawn on the next chat message
   * (unlike every other non-running state). "starting": a spawn is
   * in-flight. "none": nothing has ever been requested yet (a fresh
   * process before the first chat message). */
  kind: BackendKind | "stopped" | "starting" | "none";
  modelId: string | null;
  pid: number | null;
  startedAt: string | null;
}

let chatBackend: ChatBackend | null = null;
let startingPromise: Promise<ChatBackend> | null = null;
let lastPostLoadCheck: (PostLoadCheckResult & { modelId: string }) | null = null;
// COR-1 (code review, 2026-09-06): embedSupervisor.ts's identical shape
// already carried this generation guard "from the start" (its own
// comment cites the 2026-09-04 review that found and fixed the race here
// first) - this module never got the same fix. Bumped by every
// stopChatBackend()/restartChatBackend() call; getChatClient()'s own
// in-flight spawn checks it before ever assigning to `chatBackend`, so a
// stop/restart that lands mid-spawn can't have that spawn silently
// resurrect the very state it just cleared. See getChatClient()'s own
// comment for the exact race this closes.
let generation = 0;
// Set only by stopChatBackend() (an explicit "pause/stop" action, engine
// control's other real ask alongside "see if it's running... restart");
// distinct from chatBackend being merely null (not started YET, which
// still auto-spawns on the next getChatClient() call) - a manual stop
// must stay stopped until a manual start/restart, or "stop" would do
// nothing observable beyond one killed process.
let manuallyStopped = false;

// Session F, step 2: freePort() and the spawn+health-wait loop this
// function used to hand-roll both moved to lib/sidecars.ts as
// spawnAndWaitHealthy() - the shared primitive every process-shaped
// supervisor in this codebase now spawns through, including
// embedSupervisor.ts's identical shape. See that file's own header for
// the freePort() incident writeup; freePort() itself is re-exported here
// so this module's existing test suite and callers don't need to know it
// moved.
export { freePort };

/** Session F, step 3: the "max-resident models policy with an orphan
 * sweep" guard (docs/BACKLOG.md's "Copy the legacy runtime guards" item -
 * legacy's own incident: "orphaned runners once forced every load to
 * CPU: a 90s 'hi'"). freePort() only catches an orphan bound to the
 * EXACT port a fresh spawn is about to claim; this catches one sitting
 * anywhere else - a leftover from a since-changed
 * MAIPAI_LLAMA_SERVER_PORT/MAIPAI_EMBED_PORT, or any other stray engine
 * process this codebase spawned before a crash or a dev-mode reload wiped
 * the tracking that would have stopped it. Matches on `enginesDir` (every
 * real spawn - chat and embed both - invokes the binary by its absolute
 * path under here, per selectEngineBinary()'s own pin), so this covers
 * both roles with one call. Meant to run once at boot (index.ts), before
 * anything real spawns. */
export async function sweepOrphanEngineProcesses(): Promise<number> {
  return sweepOrphanProcesses(enginesDir);
}

async function spawnLlamaServer(
  bin: string,
  modelPath: string,
  kind: BackendKind,
  launchFlags?: LaunchFlags,
  modelId?: string,
): Promise<ChatBackend> {
  // One fixed port: this pass supervises exactly one chat process, not a
  // pool, so there's nothing to pick a free port among yet. A second role
  // (e.g. router) would need real port allocation, deferred with the rest
  // of the multi-role residency policy.
  const port = Number(process.env.MAIPAI_LLAMA_SERVER_PORT ?? 8788);
  const args = [
    bin,
    "--model",
    modelPath,
    "--port",
    String(port),
    "--host",
    "127.0.0.1",
    ...(launchFlags ? launchFlagsToArgs(launchFlags) : []),
  ];
  const client = new LlamaServerClient(`http://127.0.0.1:${port}`);
  const proc = await spawnAndWaitHealthy({
    command: args,
    port,
    healthCheck: () => client.health(),
    timeoutMs: 60_000,
    label: "llama-server",
  });
  return { client, stop: () => proc.kill(), pid: proc.pid, kind, modelId, startedAt: new Date().toISOString() };
}

/** Null unless the engine is genuinely fully installed - both the binary
 * itself AND the ENGINE_READY_MARKER modelDownloadJobs.ts only writes
 * after every archive (main plus extras) has extracted. Checking the
 * binary alone would treat a crash-interrupted install (the main archive
 * extracted, a required extra like the Windows CUDA runtime didn't) as
 * ready, spawning a binary missing what it needs to actually run.
 * Exported for embedSupervisor.ts (2026-09-04): "engine is llama-server,
 * only" means every role shares this one installed binary - `embed`
 * needing to check the identical thing chat already does is the whole
 * point of that rule, not a coincidence to re-derive a second way. */
export function engineBinaryPath(hw: Awaited<ReturnType<typeof detectHardware>>): string | null {
  const pin = selectEngineBinary(hw);
  if (!pin) return null;
  const dir = join(enginesDir, pin.id);
  if (!existsSync(join(dir, ENGINE_READY_MARKER))) return null;
  return join(dir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
}

/** Tier 3: spawn the household's selected chat model from what's already
 * on disk. Returns null only when nothing has been selected yet (a fresh
 * install's honest "not configured" state, tier 4's cue to use the stub);
 * every other failure (selected but not downloaded, engine binary
 * missing, spawn error, a failed post-load check) throws with a specific
 * reason instead. */
async function trySpawnFromSelection(): Promise<ChatBackend | null> {
  const modelId = getHouseholdSettingValue("chat.model_id") as string;
  if (!modelId) return null;

  // The crash-boot hold (lib/dirtyBoot.ts, session-f-platform-and-trust.md
  // step 3): only gates a REAL spawn, never tier 1 (a developer's URL
  // override) or tier 4's stub - a household that already has a model
  // selected still gets a working (stubbed) chat surface immediately
  // after a crash-boot, just not the real engine for 30 minutes.
  assertNotInCrashBootHold();

  const model: ModelCapabilities | undefined = CATALOG.find(
    (m) => m.id === modelId && m.role === "chat" && m.implemented,
  );
  if (!model) {
    throw new Error(`the selected chat model "${modelId}" is no longer in the catalog`);
  }
  if (model.sizing.kind !== "transformer_gguf") {
    throw new Error(`the selected chat model "${modelId}" has no llama-server-compatible sizing`);
  }

  const modelPath = join(modelsDir, `${modelId}.gguf`);
  if (!existsSync(modelPath)) {
    throw new Error(`the selected chat model "${modelId}" hasn't finished downloading yet`);
  }

  const hw = await detectHardware();
  const binPath = engineBinaryPath(hw);
  if (!binPath || !existsSync(binPath)) {
    throw new Error("the chat engine (llama-server) hasn't finished downloading yet");
  }

  const overrides: LaunchFlagOverrides = {
    contextSize: getHouseholdSettingValue("chat.context_size_override") as number | undefined,
    flashAttention: getHouseholdSettingValue("chat.flash_attention_override") as LaunchFlagOverrides["flashAttention"],
    kvCache: getHouseholdSettingValue("chat.kv_cache_override") as LaunchFlagOverrides["kvCache"],
  };
  const flags = resolveLaunchFlags(model, hw, overrides);
  const backend = await spawnLlamaServer(binPath, modelPath, "selection", flags, modelId);

  try {
    const result = await runPostLoadCheck(backend.client, backend.pid!, model, flags, hw);
    lastPostLoadCheck = { modelId, ...result };
  } catch (err) {
    backend.stop();
    throw err;
  }
  // A fresh, healthy real spawn clears any resource-governor issue a prior
  // backend's restart may have raised - symmetric with how sidecars.ts
  // resolves its own crash issues on a healthy restart.
  resolveIssue("resource-governor", "chat");
  startResourceGovernor({
    pid: backend.pid!,
    hasCuda: hw.cudaDevices.length > 0,
    // Prefer the real measured footprint over the pure formula estimate -
    // enginePostLoadCheck.ts's own doc comment notes the formula can drift;
    // actualBytes is a null fallback (unmeasurable on this platform), not a
    // routine case.
    ceilingBaselineBytes: lastPostLoadCheck.actualBytes ?? lastPostLoadCheck.estimatedBytes,
  });
  return backend;
}

async function startChatBackend(): Promise<ChatBackend> {
  const configuredUrl = process.env.MAIPAI_LLAMA_SERVER_URL;
  if (configuredUrl) {
    return { client: new LlamaServerClient(configuredUrl), stop: () => {}, kind: "url", startedAt: new Date().toISOString() };
  }

  const bin = process.env.MAIPAI_LLAMA_SERVER_BIN;
  const modelPath = process.env.MAIPAI_CHAT_MODEL_PATH;
  if (bin && modelPath) {
    // A code review (2026-09-06) found this real spawn path - a
    // developer's explicit override, but still a real local process
    // contending for the same GPU a crash-boot just took down - had no
    // crash-boot-hold check at all, unlike tier 3 right below it. Only
    // tier 1 (a bare URL, nothing spawned) and tier 4's stub are meant to
    // bypass this.
    assertNotInCrashBootHold();
    const backend = await spawnLlamaServer(bin, modelPath, "override");
    // No model metadata on this tier (a bare env-var override, no catalog
    // entry) to size a process ceiling against - system-memory protection
    // only (resourceGovernor.ts's trigger A), matching this tier's existing
    // "unchanged since this pass" scope.
    const hw = await detectHardware();
    startResourceGovernor({ pid: backend.pid!, hasCuda: hw.cudaDevices.length > 0, ceilingBaselineBytes: null });
    return backend;
  }

  const selected = await trySpawnFromSelection();
  if (selected) return selected;

  const stub = startStubLlmServer();
  return { client: new LlamaServerClient(stub.url), stop: stub.stop, kind: "stub", startedAt: new Date().toISOString() };
}

/** Lazily starts (once) and returns the client for the `chat` role.
 * Concurrent first callers share one in-flight start, never race to spawn
 * two backends. A failed start clears `startingPromise` so the *next*
 * call retries fresh instead of replaying the same rejection forever: a
 * code review (2026-09-04) found the original version left a rejected
 * promise cached, permanently wedging the role after one transient
 * failure (a briefly-wrong model path, a taken port, a slow first load
 * past the health timeout) until the whole process restarted. */
export async function getChatClient(): Promise<LlamaServerClient> {
  if (manuallyStopped) {
    throw new Error("the chat engine is stopped - restart it from Household → AI models");
  }
  if (chatBackend) return chatBackend.client;
  if (!startingPromise) {
    const myGeneration = generation;
    startingPromise = startChatBackend()
      .then(async (backend): Promise<ChatBackend> => {
        if (myGeneration !== generation) {
          // A stop/restart landed while this spawn was still starting
          // (COR-1): a real, 20-60s window on an actual model. Assigning
          // to `chatBackend` here regardless would resurrect exactly the
          // state stopChatBackend()/restartChatBackend() just cleared - a
          // live, GPU-resident process the admin explicitly stopped (or
          // superseded with a restart), with getEngineStatus() reporting
          // "stopped" the whole time because it checks `manuallyStopped`
          // first, never `chatBackend` itself. Stopped instead, and the
          // ORIGINAL caller (already committed to awaiting this exact
          // promise) recurses into getChatClient() so it transparently
          // lands on whatever the CURRENT generation resolves to - the
          // same embedSupervisor.ts fix, applied here.
          //
          // Unlike embedSupervisor's own spawn, tier 3 here
          // (trySpawnFromSelection) has already run a real side effect by
          // this point - lastPostLoadCheck, read by the Household -> AI
          // models status page - for whichever backend this generation
          // check just discarded (a background review of this fix caught
          // it: porting the guard didn't account for a side effect
          // embedSupervisor's own spawn never had). Nulled rather than
          // left stale; the recursive getChatClient() call below sets a
          // fresh one if the new generation also reaches tier 3.
          if (backend.kind === "selection") lastPostLoadCheck = null;
          backend.stop();
          return { ...backend, client: await getChatClient() };
        }
        chatBackend = backend;
        return backend;
      })
      .catch((err) => {
        if (myGeneration === generation) startingPromise = null;
        throw err;
      });
  }
  return (await startingPromise).client;
}

/** Stops whatever backend is currently running (if any) and clears the
 * cache, so the next getChatClient() call re-resolves from scratch -
 * tier 3 picks up a freshly-downloaded model instead of staying pinned to
 * whatever was running (or the stub) before. modelDownloadJobs.ts calls
 * this once a fresh download's checksum verifies, right before the
 * select job's own "loading"/"testing" phases exercise the new spawn. */
export async function restartChatBackend(): Promise<void> {
  manuallyStopped = false;
  generation++;
  chatBackend?.stop();
  chatBackend = null;
  startingPromise = null;
}

/** Engine control's "stop/pause": kills the running backend (if any) and,
 * unlike restartChatBackend()/a plain cache-clear, keeps it stopped -
 * getChatClient() refuses to auto-respawn until restartChatBackend() (or
 * a fresh model select, which calls that) runs. Safe to call with nothing
 * running (a stopped stub, or nothing started yet). */
export function stopChatBackend(): void {
  manuallyStopped = true;
  generation++;
  chatBackend?.stop();
  chatBackend = null;
  startingPromise = null;
}

/** Real-time engine status for the Household → AI models page: is
 * anything running, what kind (a real spawned model vs. the stub vs. a
 * developer's MAIPAI_LLAMA_SERVER_URL override), which model, since when. */
export function getEngineStatus(): EngineStatus {
  if (manuallyStopped) {
    const modelId = (getHouseholdSettingValue("chat.model_id") as string) || null;
    return { kind: "stopped", modelId, pid: null, startedAt: null };
  }
  if (chatBackend) {
    return { kind: chatBackend.kind, modelId: chatBackend.modelId ?? null, pid: chatBackend.pid ?? null, startedAt: chatBackend.startedAt };
  }
  if (startingPromise) return { kind: "starting", modelId: null, pid: null, startedAt: null };
  return { kind: "none", modelId: null, pid: null, startedAt: null };
}

/** The most recent post-load check's result, for the select job (and
 * eventually a status view) to report alongside "ready" - null before any
 * real (non-stub, non-URL-configured) spawn has ever completed one. */
export function getLastPostLoadCheck(): (PostLoadCheckResult & { modelId: string }) | null {
  return lastPostLoadCheck;
}

/** Test-only: stop whatever backend is running (spawned process or stub
 * server) and clear the cached client, the same reset-between-test-files
 * shape as resetDb()/__clearSessionCacheForTests. */
export function __resetLlmSupervisorForTests(): void {
  generation++;
  chatBackend?.stop();
  chatBackend = null;
  startingPromise = null;
  lastPostLoadCheck = null;
  manuallyStopped = false;
}
