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
// Set only by stopChatBackend() (an explicit "pause/stop" action, engine
// control's other real ask alongside "see if it's running... restart");
// distinct from chatBackend being merely null (not started YET, which
// still auto-spawns on the next getChatClient() call) - a manual stop
// must stay stopped until a manual start/restart, or "stop" would do
// nothing observable beyond one killed process.
let manuallyStopped = false;

async function waitForHealth(client: LlamaServerClient, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.health()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`llama-server did not become healthy within ${timeoutMs}ms`);
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
  const proc = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  const client = new LlamaServerClient(`http://127.0.0.1:${port}`);
  try {
    await waitForHealth(client, 60_000);
  } catch (err) {
    proc.kill();
    throw err;
  }
  return { client, stop: () => proc.kill(), pid: proc.pid, kind, modelId, startedAt: new Date().toISOString() };
}

/** Null unless the engine is genuinely fully installed - both the binary
 * itself AND the ENGINE_READY_MARKER modelDownloadJobs.ts only writes
 * after every archive (main plus extras) has extracted. Checking the
 * binary alone would treat a crash-interrupted install (the main archive
 * extracted, a required extra like the Windows CUDA runtime didn't) as
 * ready, spawning a binary missing what it needs to actually run. */
function engineBinaryPath(hw: Awaited<ReturnType<typeof detectHardware>>): string | null {
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
    return spawnLlamaServer(bin, modelPath, "override");
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
    startingPromise = startChatBackend()
      .then((backend) => {
        chatBackend = backend;
        return backend;
      })
      .catch((err) => {
        startingPromise = null;
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
  chatBackend?.stop();
  chatBackend = null;
  startingPromise = null;
  lastPostLoadCheck = null;
  manuallyStopped = false;
}
