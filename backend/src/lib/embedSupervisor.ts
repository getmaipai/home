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
import { engineBinaryPath, freePort } from "@/lib/llmSupervisor";
import { embedModelPath, ensureEmbedModel } from "@/lib/embedAssets";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";

export type EmbedBackendKind = "url" | "spawned" | "stub";

interface EmbedBackend {
  client: LlamaServerClient;
  stop: () => void;
  kind: EmbedBackendKind;
  startedAt: string;
}

let embedBackend: EmbedBackend | null = null;
let startingPromise: Promise<EmbedBackend> | null = null;
// Bumped on every restart/reset - guards the exact race a code review
// (2026-09-04) found and fixed in ttsSupervisor.ts's identical shape: a
// spawn already in flight when a restart lands must never re-populate
// the cache afterward. See that file's own comment for the full
// reasoning; applied here from the start rather than re-discovered later.
let generation = 0;

async function waitForHealth(client: LlamaServerClient, timeoutMs: number, proc: Bun.Subprocess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.health()) return;
    if (proc.exitCode !== null) {
      throw new Error(`llama-server (embed) exited early (code ${proc.exitCode}) before becoming healthy`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`llama-server (embed) did not become healthy within ${timeoutMs}ms`);
}

async function spawnEmbedServer(binPath: string): Promise<EmbedBackend> {
  const port = Number(process.env.MAIPAI_EMBED_PORT ?? 8794);
  // A code review (2026-09-04) found this fixed-port spawn skipped the
  // exact `freePort()` call llmSupervisor.ts's own spawnLlamaServer makes
  // for the identical reason: a `bun --hot` reload wipes this module's
  // tracking (embedBackend/startingPromise) without killing whatever it
  // already spawned, so a leftover process stays bound to this port -
  // the next spawn attempt then either fails to bind or, worse, polls
  // the orphaned process as if it were the new one. Freeing the port
  // first is what makes "restart" (once embed has one) actually mean
  // restart, the real live incident llmSupervisor.ts's own comment
  // documents.
  await freePort(port);
  await ensureEmbedModel();
  const proc = Bun.spawn(
    [binPath, "--model", embedModelPath(), "--embedding", "--port", String(port), "--host", "127.0.0.1"],
    { stdout: "inherit", stderr: "inherit" },
  );
  const client = new LlamaServerClient(`http://127.0.0.1:${port}`);
  try {
    await waitForHealth(client, 60_000, proc);
  } catch (err) {
    proc.kill();
    throw err;
  }
  return { client, stop: () => proc.kill(), kind: "spawned", startedAt: new Date().toISOString() };
}

async function startEmbedBackend(): Promise<EmbedBackend> {
  const configuredUrl = process.env.MAIPAI_EMBED_URL;
  if (configuredUrl) {
    return { client: new LlamaServerClient(configuredUrl), stop: () => {}, kind: "url", startedAt: new Date().toISOString() };
  }

  const hw = await detectHardware();
  const binPath = engineBinaryPath(hw);
  if (binPath) {
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
  if (embedBackend) return embedBackend.client;
  if (!startingPromise) {
    const myGeneration = generation;
    startingPromise = startEmbedBackend()
      .then(async (backend): Promise<EmbedBackend> => {
        if (myGeneration !== generation) {
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
        embedBackend = backend;
        return backend;
      })
      .catch((err) => {
        if (myGeneration === generation) startingPromise = null;
        throw err;
      });
  }
  return (await startingPromise).client;
}

/** Which backend (if any) is currently serving `embed` - "none" before
 * the first embed call in this process's lifetime. */
export function getEmbedBackendKind(): EmbedBackendKind | "starting" | "none" {
  if (embedBackend) return embedBackend.kind;
  if (startingPromise) return "starting";
  return "none";
}

/** Test-only: stop whatever backend is running and clear the cached
 * client, the same reset-between-test-files shape as
 * __resetTtsSupervisorForTests. */
export function __resetEmbedSupervisorForTests(): void {
  generation++;
  embedBackend?.stop();
  embedBackend = null;
  startingPromise = null;
}
