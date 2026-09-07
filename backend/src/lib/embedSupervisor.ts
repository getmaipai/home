// The router skeleton for platform plan 4.11's `embed` role, the same
// lazy-start-once shape llmSupervisor.ts set for `chat` and
// ttsSupervisor.ts scaled down for `tts` - here scaled down for a THIRD
// role with a real, but even narrower, need: no catalog entry, no
// download job, no household selection (there is exactly one pinned
// model, embedAssets.ts). "Engine is llama-server, only" (4.11) means
// `embed` doesn't need its own engine binary - it reuses whatever's
// already installed for `chat` (llmSupervisor.ts's exported
// engineBinaryPath()), just launched against a different model with
// `--embedding`.
//
// Which backend answers `embed` is chosen once, lazily, on first use, in
// this order:
//   1. MAIPAI_EMBED_URL - point at an already-running server (real or
//      someone else's stub). Nothing is spawned.
//   2. The shared engine binary is installed (a chat model has been set
//      up at least once - the only way it gets downloaded today) AND the
//      pinned embedding model is on disk (downloaded on demand,
//      embedAssets.ts): spawn `llama-server --embedding` as a real child
//      process. A spawn that starts but fails to become healthy THROWS,
//      matching llmSupervisor.ts's tier-3 discipline.
//   3. Nothing installed yet (every fresh install before any chat model
//      is chosen, and every test run) - start the in-process stub
//      server. Real code path, canned deterministic vectors.
import { detectHardware } from "@/lib/hardware";
import { engineBinaryPath } from "@/lib/llmSupervisor";
import { spawnAndWaitHealthy } from "@/lib/sidecars";
import { hotReloadState } from "@/lib/hotReloadState";
import { assertNotInCrashBootHold } from "@/lib/dirtyBoot";
import { embedModelPath, ensureEmbedModel } from "@/lib/embedAssets";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";

export type EmbedBackendKind = "url" | "spawned" | "stub";

interface EmbedBackend {
  client: LlamaServerClient;
  stop: () => void;
  /** Only set for a backend this module actually spawned ("spawned") -
   * llmSupervisor.ts's `ChatBackend.pid` precedent, needed here too for
   * Fix A2's own orphan-sweep exclusion (see `getEmbedLivePid()` below). */
  pid?: number;
  kind: EmbedBackendKind;
  startedAt: string;
}

// Fix A (docs/dev.md, "Chat reliability: the 2026-09-07 incident"):
// `lib/hotReloadState.ts`'s shared helper - a `bun --hot` reload resets a
// module-level `let` to its initializer, but `globalThis` survives (same
// process, same heap), so this module's spawned embed server stops
// looking orphaned to the fresh module instance that reload just created.
interface EmbedSupervisorState {
  embedBackend: EmbedBackend | null;
  startingPromise: Promise<EmbedBackend> | null;
  // Bumped on every restart/reset - guards the exact race a code review
  // (2026-09-04) found and fixed in ttsSupervisor.ts's identical shape: a
  // spawn already in flight when a restart lands must never re-populate
  // the cache afterward. See that file's own comment for the full
  // reasoning; applied here from the start rather than re-discovered later.
  generation: number;
}

const state = hotReloadState<EmbedSupervisorState>("embedSupervisor", () => ({
  embedBackend: null,
  startingPromise: null,
  generation: 0,
}));

// Session F, step 2: the spawn+freePort+health-wait shape this module
// used to hand-roll (a near-duplicate of llmSupervisor.ts's own, per that
// file's 2026-09-04 comment on why this needed its own freePort() call)
// now goes through lib/sidecars.ts's spawnAndWaitHealthy() - one
// implementation of "spawn, poll health, fail fast on early exit" for
// every process-shaped supervisor in this codebase.
async function spawnEmbedServer(binPath: string): Promise<EmbedBackend> {
  const port = Number(process.env.MAIPAI_EMBED_PORT ?? 8794);
  await ensureEmbedModel();
  const client = new LlamaServerClient(`http://127.0.0.1:${port}`);
  const proc = await spawnAndWaitHealthy({
    command: [binPath, "--model", embedModelPath(), "--embedding", "--port", String(port), "--host", "127.0.0.1"],
    port,
    healthCheck: () => client.health(),
    timeoutMs: 60_000,
    label: "llama-server (embed)",
  });
  return { client, stop: () => proc.kill(), pid: proc.pid, kind: "spawned", startedAt: new Date().toISOString() };
}

async function startEmbedBackend(): Promise<EmbedBackend> {
  const configuredUrl = process.env.MAIPAI_EMBED_URL;
  if (configuredUrl) {
    return { client: new LlamaServerClient(configuredUrl), stop: () => {}, kind: "url", startedAt: new Date().toISOString() };
  }

  const hw = await detectHardware();
  const binPath = engineBinaryPath(hw);
  if (binPath) {
    // The crash-boot hold (lib/dirtyBoot.ts, session-f-platform-and-trust.md
    // step 3): only gates a real spawn, the same "tier 1 and the stub are
    // unaffected" carve-out llmSupervisor.ts's identical check makes.
    assertNotInCrashBootHold();
    return spawnEmbedServer(binPath);
  }

  const stub = startStubLlmServer();
  return { client: new LlamaServerClient(stub.url), stop: stub.stop, kind: "stub", startedAt: new Date().toISOString() };
}

/** Lazily starts (once) and returns the client for the `embed` role.
 * Concurrent first callers share one in-flight start; a failed start
 * clears `startingPromise` so the next call retries fresh, the same fix
 * llmSupervisor.ts's getChatClient() and ttsSupervisor.ts's
 * getTtsClient() already carry. */
export async function getEmbedClient(): Promise<LlamaServerClient> {
  if (state.embedBackend) return state.embedBackend.client;
  if (!state.startingPromise) {
    const myGeneration = state.generation;
    state.startingPromise = startEmbedBackend()
      .then(async (backend): Promise<EmbedBackend> => {
        if (myGeneration !== state.generation) {
          // A reset landed while this spawn was still starting. Simply
          // returning the (now-stopped) `backend` here would be a second
          // bug, not a fix: a code review (2026-09-04) found that the
          // ORIGINAL caller of getEmbedClient() already committed to
          // `await`ing exactly this promise before the reset happened,
          // so it would still receive `.client` bound to the process
          // just stopped on the line above - a client to a dead server,
          // not a retry. Recursing into getEmbedClient() instead means
          // that caller transparently lands on whatever the CURRENT
          // generation resolves to (a fresh spawn if nothing else is in
          // flight, or another in-flight one), the same guarantee a
          // caller starting fresh right now would get.
          backend.stop();
          return { ...backend, client: await getEmbedClient() };
        }
        state.embedBackend = backend;
        return backend;
      })
      .catch((err) => {
        if (myGeneration === state.generation) state.startingPromise = null;
        throw err;
      });
  }
  return (await state.startingPromise).client;
}

/** Which backend (if any) is currently serving `embed` - "none" before
 * the first embed call in this process's lifetime. */
export function getEmbedBackendKind(): EmbedBackendKind | "starting" | "none" {
  if (state.embedBackend) return state.embedBackend.kind;
  if (state.startingPromise) return "starting";
  return "none";
}

/** The embed backend's own pid, when one is genuinely spawned and running
 * - Fix A2 (docs/dev.md's incident note): index.ts passes this to
 * llmSupervisor.ts's `sweepOrphanEngineProcesses()` so a `bun --hot`
 * reload's own re-run of the boot-time orphan sweep never kills this
 * still-healthy process out from under the fresh module instance that's
 * about to reuse it. */
export function getEmbedLivePid(): number | null {
  return state.embedBackend?.pid ?? null;
}

/** Test-only: stop whatever backend is running and clear the cached
 * client, the same reset-between-test-files shape as
 * __resetTtsSupervisorForTests. */
export function __resetEmbedSupervisorForTests(): void {
  state.generation++;
  state.embedBackend?.stop();
  state.embedBackend = null;
  state.startingPromise = null;
}
