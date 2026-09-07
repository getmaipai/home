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
import { spawnAndWaitHealthy, freePort, sweepOrphanProcesses, watchEngine, probeAlive, engineHealthKind, cancelEngineRespawn, type EngineWatch, type EngineHealth } from "@/lib/sidecars";
import { hotReloadState } from "@/lib/hotReloadState";
import { assertNotInCrashBootHold } from "@/lib/dirtyBoot";
import { startResourceGovernor } from "@/lib/resourceGovernor";
import { raiseIssue, resolveIssue } from "@/lib/issues";

export type BackendKind = "url" | "override" | "selection" | "stub";

interface ChatBackend {
  client: LlamaServerClient;
  stop: () => void;
  /** Only set for a backend this module actually spawned (tiers 2-3): the
   * child's pid, for enginePostLoadCheck.ts's real memory measurement. */
  pid?: number;
  /** Only for a spawned backend: sidecars.ts's watchEngine(), the
   * auto-heal (exit watch, health poll, backoff respawn) and the thing
   * `stop` is routed through so a deliberate stop is never mistaken for
   * a death. */
  watch?: EngineWatch;
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

// Fix A (docs/dev.md, "Chat reliability: the 2026-09-07 incident"):
// `bun --hot` gives every reload a FRESH module instance - a top-level
// `let` resets to its initializer - but the same OS process, same heap,
// so `globalThis` survives (`wyomingServer.ts`'s own
// `__maipaiWyomingBoundPorts` set this precedent first). Before this fix,
// a source save during development made the fresh module instance
// believe no chat backend existed, so the next chat message spawned a
// second llama-server on the same port - which `spawnAndWaitHealthy()`'s
// own `freePort()` call kills the FIRST, still-perfectly-healthy one to
// make room for - costing a multi-second model reload, and killing any
// reply already in flight against the one just SIGKILLed. Keeping this
// state on `globalThis` instead means every module instance across every
// reload reads and writes the identical object: an in-flight spawn's
// `.then()`/`.catch()` closures (captured by the pre-reload module
// instance) keep resolving against the SAME state a post-reload caller
// also sees, so nothing is silently discarded or duplicated either.
interface LlmSupervisorState {
  chatBackend: ChatBackend | null;
  startingPromise: Promise<ChatBackend> | null;
  lastPostLoadCheck: (PostLoadCheckResult & { modelId: string }) | null;
  // COR-1 (code review, 2026-09-06): embedSupervisor.ts's identical shape
  // already carried this generation guard "from the start" (its own
  // comment cites the 2026-09-04 review that found and fixed the race here
  // first) - this module never got the same fix. Bumped by every
  // stopChatBackend()/restartChatBackend() call; getChatClient()'s own
  // in-flight spawn checks it before ever assigning to `chatBackend`, so a
  // stop/restart that lands mid-spawn can't have that spawn silently
  // resurrect the very state it just cleared. See getChatClient()'s own
  // comment for the exact race this closes.
  generation: number;
  // Set only by stopChatBackend() (an explicit "pause/stop" action, engine
  // control's other real ask alongside "see if it's running... restart");
  // distinct from chatBackend being merely null (not started YET, which
  // still auto-spawns on the next getChatClient() call) - a manual stop
  // must stay stopped until a manual start/restart, or "stop" would do
  // nothing observable beyond one killed process.
  manuallyStopped: boolean;
}

const state = hotReloadState<LlmSupervisorState>("llmSupervisor", () => ({
  chatBackend: null,
  startingPromise: null,
  lastPostLoadCheck: null,
  generation: 0,
  manuallyStopped: false,
}));

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
 * process this codebase spawned before a real crash. Matches on
 * `enginesDir` (every real spawn - chat and embed both - invokes the
 * binary by its absolute path under here, per selectEngineBinary()'s own
 * pin), so this covers both roles with one call. Meant to run once at
 * boot (index.ts), before anything real spawns.
 *
 * `extraLivePids` (Fix A2, docs/dev.md's 2026-09-07 incident note):
 * index.ts calls this on every `bun --hot` reload too (it re-runs the
 * whole module top level), not just a genuine process boot. Before Fix A,
 * that meant every reload swept up and SIGKILLed its own still-healthy
 * engines, because a fresh module instance's own tracking had just been
 * reset - the exact "dev-mode reload wiped the tracking" case this
 * function used to be the (destructive) answer to. Fix A1 keeps chat's
 * own state on `globalThis` (see the `state` object above), so this
 * module already knows its own chat backend's pid is still genuinely
 * alive and excludes it; `extraLivePids` lets the caller (index.ts) pass
 * embed's and tts's own live pids from their own registries the same
 * way, without this module importing either (avoiding a three-way
 * circular import between the engine supervisors). A real orphan - one
 * NO registry claims, chat, embed, or tts - is still swept exactly as
 * before, including at a genuine fresh boot, when every registry is
 * empty and nothing is excluded. */
export async function sweepOrphanEngineProcesses(extraLivePids: readonly (number | null)[] = []): Promise<number> {
  const excludePids = [state.chatBackend?.pid ?? null, ...extraLivePids].filter((pid): pid is number => typeof pid === "number");
  return sweepOrphanProcesses(enginesDir, { excludePids });
}

/** A spawned, healthy llama-server, not yet watched. Split from
 * attachChatWatch() below (a second code review, 2026-09-07): tier 3
 * (trySpawnFromSelection) still has a whole post-load memory check left
 * to run after this returns, and attaching the auto-heal's watch before
 * that finishes meant a process that died DURING the check (the exact
 * OOM case the check exists to catch) was already being counted as a
 * crash by watchEngine's own exit handler, so it got auto-respawned
 * (and the full model reload retried) up to five times against a model
 * that had just proven it doesn't fit, instead of failing once with the
 * check's own clear reason. */
interface SpawnedLlamaServer {
  proc: Bun.Subprocess;
  client: LlamaServerClient;
  pid: number;
  kind: BackendKind;
  modelId?: string;
}

async function spawnLlamaServer(
  bin: string,
  modelPath: string,
  kind: BackendKind,
  launchFlags?: LaunchFlags,
  modelId?: string,
): Promise<SpawnedLlamaServer> {
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
  return { proc, client, pid: proc.pid, kind, modelId };
}

// The auto-heal (docs/dev.md, "What was actually killing the chat
// engine", 2026-09-07): before this, nothing observed a spawned engine's
// exit at all, so a SIGKILLed process left every turn repeating "could
// not reach" against this cached client until someone restarted the
// whole hub. `drop` is the same restartChatBackend() a manual restart
// uses (which routes back through `watch.stop()`, by then a no-op),
// `respawn` the same lazy start the first message uses.
function attachChatWatch(spawned: SpawnedLlamaServer): ChatBackend {
  const watch = watchEngine({
    proc: spawned.proc,
    role: "chat",
    label: "the chat engine",
    healthCheck: () => spawned.client.health(),
    drop: () => void restartChatBackend(),
    respawn: () => getChatClient(),
    title: "MaiPai's AI stopped unexpectedly",
  });
  return { client: spawned.client, stop: watch.stop, watch, pid: spawned.pid, kind: spawned.kind, modelId: spawned.modelId, startedAt: new Date().toISOString() };
}

/** llm.ts's recoverFromDeadBackend() lands here when a request failed
 * with "could not reach": a spawned engine goes straight to its watch's
 * own down path (log, Repairs, respawn), without waiting for the exit or
 * the next health poll and without ever being read as a deliberate stop;
 * the URL tier (a process this hub does not own) can only be dropped so
 * the next call re-resolves. */
export function reportChatBackendUnreachable(message: string): void {
  const backend = state.chatBackend;
  if (!backend) return;
  if (backend.watch) backend.watch.markDown(`stopped answering (${message})`);
  else void restartChatBackend();
}

/** For GET /api/health: the configured kind plus a real probe of the
 * process behind it, so a dead engine reads as down rather than as its
 * kind label. */
export async function probeChatEngine(): Promise<EngineHealth> {
  const status = getEngineStatus();
  return { kind: engineHealthKind("chat", status.kind), pid: status.pid, alive: await probeAlive(state.chatBackend?.client) };
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
  const spawned = await spawnLlamaServer(binPath, modelPath, "selection", flags, modelId);

  try {
    const result = await runPostLoadCheck(spawned.client, spawned.pid, model, flags, hw);
    state.lastPostLoadCheck = { modelId, ...result };
  } catch (err) {
    spawned.proc.kill();
    throw err;
  }
  // The auto-heal's watch attaches only now, after the post-load check
  // has already proven the process survives it - see SpawnedLlamaServer's
  // own doc comment for the crash-loop this ordering was found to cause.
  const backend = attachChatWatch(spawned);
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
    ceilingBaselineBytes: state.lastPostLoadCheck.actualBytes ?? state.lastPostLoadCheck.estimatedBytes,
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
    const spawned = await spawnLlamaServer(bin, modelPath, "override");
    const backend = attachChatWatch(spawned);
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
  if (state.manuallyStopped) {
    throw new Error("the chat engine is stopped - restart it from Household → AI models");
  }
  if (state.chatBackend) return state.chatBackend.client;
  if (!state.startingPromise) {
    const myGeneration = state.generation;
    state.startingPromise = startChatBackend()
      .then(async (backend): Promise<ChatBackend> => {
        if (myGeneration !== state.generation) {
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
          if (backend.kind === "selection") state.lastPostLoadCheck = null;
          backend.stop();
          return { ...backend, client: await getChatClient() };
        }
        state.chatBackend = backend;
        // A genuinely healthy spawn closes out any earlier failure -
        // same "a fresh success clears a prior fault" posture
        // resourceGovernor's own resolveIssue("resource-governor", "chat")
        // call already has just above.
        resolveIssue("chat-engine", "spawn");
        return backend;
      })
      .catch((err) => {
        if (myGeneration === state.generation) state.startingPromise = null;
        // Found live 2026-09-07: a genuine chat-engine spawn failure had
        // no Repairs-page visibility at all - only found by a household
        // member happening to check Settings -> AI models themselves.
        // Every other subsystem that can fail on its own (a Tier 1
        // package's sandbox, TLS renewal) already raises an issue here;
        // this was the one gap. Not raised for `manuallyStopped` (that
        // throws before startChatBackend() is ever called, so it never
        // reaches this catch) - only a real spawn/post-load-check
        // failure lands here.
        //
        // Gated on the same myGeneration === generation check as the
        // startingPromise clear above it (a code review, 2026-09-07,
        // caught this was missing here): without it, a stale generation's
        // spawn - already superseded by a deliberate stop/restart -
        // rejecting later would raise a false "failed to start" for an
        // admin action that was never a failure, and could even re-raise
        // it AFTER the new generation's own resolveIssue() already
        // cleared it, leaving a phantom issue stuck open while the engine
        // is actually running fine.
        if (myGeneration === state.generation) {
          void raiseIssue({
            source: "chat-engine",
            key: "spawn",
            severity: "error",
            title: "MaiPai's AI failed to start",
            detail: (err as Error).message,
          });
        }
        throw err;
      });
  }
  return (await state.startingPromise).client;
}

/** Stops whatever backend is currently running (if any) and clears the
 * cache, so the next getChatClient() call re-resolves from scratch -
 * tier 3 picks up a freshly-downloaded model instead of staying pinned to
 * whatever was running (or the stub) before. modelDownloadJobs.ts calls
 * this once a fresh download's checksum verifies, right before the
 * select job's own "loading"/"testing" phases exercise the new spawn. */
export async function restartChatBackend(): Promise<void> {
  cancelEngineRespawn("chat");
  state.manuallyStopped = false;
  state.generation++;
  state.chatBackend?.stop();
  state.chatBackend = null;
  state.startingPromise = null;
}

/** Engine control's "stop/pause": kills the running backend (if any) and,
 * unlike restartChatBackend()/a plain cache-clear, keeps it stopped -
 * getChatClient() refuses to auto-respawn until restartChatBackend() (or
 * a fresh model select, which calls that) runs. Safe to call with nothing
 * running (a stopped stub, or nothing started yet). */
export function stopChatBackend(): void {
  cancelEngineRespawn("chat");
  state.manuallyStopped = true;
  state.generation++;
  state.chatBackend?.stop();
  state.chatBackend = null;
  state.startingPromise = null;
}

/** Real-time engine status for the Household → AI models page: is
 * anything running, what kind (a real spawned model vs. the stub vs. a
 * developer's MAIPAI_LLAMA_SERVER_URL override), which model, since when. */
export function getEngineStatus(): EngineStatus {
  if (state.manuallyStopped) {
    const modelId = (getHouseholdSettingValue("chat.model_id") as string) || null;
    return { kind: "stopped", modelId, pid: null, startedAt: null };
  }
  if (state.chatBackend) {
    return { kind: state.chatBackend.kind, modelId: state.chatBackend.modelId ?? null, pid: state.chatBackend.pid ?? null, startedAt: state.chatBackend.startedAt };
  }
  if (state.startingPromise) return { kind: "starting", modelId: null, pid: null, startedAt: null };
  return { kind: "none", modelId: null, pid: null, startedAt: null };
}

/** The most recent post-load check's result, for the select job (and
 * eventually a status view) to report alongside "ready" - null before any
 * real (non-stub, non-URL-configured) spawn has ever completed one. */
export function getLastPostLoadCheck(): (PostLoadCheckResult & { modelId: string }) | null {
  return state.lastPostLoadCheck;
}

/** The chat backend's own pid, when one is genuinely spawned and running
 * (never for a URL override or the stub, neither of which this process
 * owns) - Fix A2 (docs/dev.md's incident note): index.ts's boot-time
 * `sweepOrphanEngineProcesses()` excludes this from the processes it
 * kills, so a `bun --hot` reload's own re-run of that sweep never SIGKILLs
 * the still-healthy engine this same registry (see the `state` object
 * above) is about to hand right back to the fresh module instance. */
export function getChatLivePid(): number | null {
  return state.chatBackend?.pid ?? null;
}

/** Test-only: stop whatever backend is running (spawned process or stub
 * server) and clear the cached client, the same reset-between-test-files
 * shape as resetDb()/__clearSessionCacheForTests. */
export function __resetLlmSupervisorForTests(): void {
  cancelEngineRespawn("chat");
  state.generation++;
  state.chatBackend?.stop();
  state.chatBackend = null;
  state.startingPromise = null;
  state.lastPostLoadCheck = null;
  state.manuallyStopped = false;
}
