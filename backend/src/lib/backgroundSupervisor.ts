// The router skeleton for the `background` role (platform plan decision 3,
// 2026-09-12): the same lazy-start-once shape embedSupervisor.ts set for
// `embed`. Engine is llama-server only, launched against the pinned background
// model with `--reasoning off` (never thinking). CPU by default so the GPU
// stays with the chat model.
//
// Which backend answers `background` is chosen once, lazily, on first use,
// in this order:
//   1. MAIPAI_BACKGROUND_URL - point at an already-running server (real or
//      someone else's stub). Nothing is spawned.
//   2. The shared engine binary is installed AND the pinned background model
//      is on disk (downloaded on demand, backgroundAssets.ts): spawn
//      `llama-server` as a real child process. A spawn that starts but fails
//      to become healthy THROWS, matching embedSupervisor.ts's discipline.
//   3. Nothing installed yet (every fresh install before any chat model is
//      chosen, and every test run) - start the in-process stub server.
import { detectHardware } from "@/lib/hardware";
import { engineBinaryPath } from "@/lib/llmSupervisor";
import { spawnAndWaitHealthy, watchEngine, probeAlive, engineHealthKind, cancelEngineRespawn, type EngineHealth } from "@/lib/sidecars";
import { hotReloadState } from "@/lib/hotReloadState";
import { assertNotInCrashBootHold } from "@/lib/dirtyBoot";
import { backgroundModelPath, ensureBackgroundModel } from "@/lib/backgroundAssets";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";
import { seedFields } from "@/lib/benchSampling";

export type BackgroundBackendKind = "url" | "spawned" | "stub";

interface BackgroundBackend {
  client: LlamaServerClient;
  /** #73: a spawned backend's stop is watchEngine()'s, which resolves
   * once the process has exited (SIGKILL after a timeout); the URL and
   * stub tiers stop nothing and return at once. */
  stop: () => void | Promise<void>;
  pid?: number;
  kind: BackgroundBackendKind;
  startedAt: string;
}

interface BackgroundSupervisorState {
  backgroundBackend: BackgroundBackend | null;
  startingPromise: Promise<BackgroundBackend> | null;
  generation: number;
}

const state = hotReloadState<BackgroundSupervisorState>("backgroundSupervisor", () => ({
  backgroundBackend: null,
  startingPromise: null,
  generation: 0,
}));

/** The background engine's launch line, pure so a test can hold it.
 * #97: `--cache-ram 0` turns off llama-server's server-side prompt cache
 * (default 8192 MiB on b10797, `--cache-ram` in its help), which keeps
 * the KV state of every distinct prompt it has answered until that
 * ceiling. The judge's prompts never repeat (each is a different
 * transcript), so the cache bought nothing and grew the process from
 * 3.5 GB after load to 9.4 GB in three bench runs and 11 GB over a day,
 * with the machine swapping. No `--cache-reuse` either: it only ever
 * reused from that cache. The slot count is left to llama-server's
 * auto (four): measured, one slot loads at the same 4.4 GB resident as
 * four, so the base is the model and its compute buffers, not the KV
 * pool, and a change there would serialize the summaries for nothing. */
export function backgroundLaunchArgs(binPath: string, modelPath: string, port: number, gpuLayers: number): string[] {
  return [
    binPath,
    "--model", modelPath,
    "--port", String(port),
    "--host", "127.0.0.1",
    "-c", "8192",
    "-ngl", String(gpuLayers),
    "-t", "4",
    "-fa", "on",
    "--reasoning", "off",
    "--jinja",
    "--no-webui",
    "--metrics",
    "--cache-ram", "0",
  ];
}

async function spawnBackgroundServer(binPath: string): Promise<BackgroundBackend> {
  const port = Number(process.env.MAIPAI_BACKGROUND_PORT ?? 8789);
  await ensureBackgroundModel();
  const client = new LlamaServerClient(`http://127.0.0.1:${port}`);
  const gpuLayers = Number(process.env.MAIPAI_BACKGROUND_GPU_LAYERS ?? 0);
  const proc = await spawnAndWaitHealthy({
    command: backgroundLaunchArgs(binPath, backgroundModelPath(), port, gpuLayers),
    port,
    healthCheck: () => client.health(),
    timeoutMs: 60_000,
    label: "llama-server (background)",
  });

  const watch = watchEngine({
    proc,
    role: "background",
    label: "the memory engine",
    healthCheck: () => client.health(),
    drop: () => void restartBackgroundBackend(),
    respawn: () => getBackgroundClient(),
    title: "MaiPai's memory engine stopped unexpectedly",
  });
  return { client, stop: watch.stop, pid: proc.pid, kind: "spawned", startedAt: new Date().toISOString() };
}

export async function restartBackgroundBackend(): Promise<void> {
  cancelEngineRespawn("background");
  state.generation++;
  // The state is cleared before the (now awaited, #73) stop, so a
  // caller that does not await, the test reset among them, sees the
  // backend gone at once; the process is stopped in the background.
  const previous = state.backgroundBackend;
  state.backgroundBackend = null;
  state.startingPromise = null;
  await previous?.stop();
}

export async function probeBackgroundEngine(): Promise<EngineHealth> {
  return {
    kind: engineHealthKind("background", getBackgroundBackendKind()),
    pid: state.backgroundBackend?.pid ?? null,
    alive: await probeAlive(state.backgroundBackend?.client),
  };
}

async function startBackgroundBackend(): Promise<BackgroundBackend> {
  const configuredUrl = process.env.MAIPAI_BACKGROUND_URL;
  if (configuredUrl) {
    return { client: new LlamaServerClient(configuredUrl), stop: () => {}, kind: "url", startedAt: new Date().toISOString() };
  }

  const hw = await detectHardware();
  const binPath = engineBinaryPath(hw);
  if (binPath) {
    assertNotInCrashBootHold();
    return spawnBackgroundServer(binPath);
  }

  const stub = startStubLlmServer();
  return { client: new LlamaServerClient(stub.url), stop: stub.stop, kind: "stub", startedAt: new Date().toISOString() };
}

export async function getBackgroundClient(): Promise<LlamaServerClient> {
  if (state.backgroundBackend) return state.backgroundBackend.client;
  if (!state.startingPromise) {
    const myGeneration = state.generation;
    state.startingPromise = startBackgroundBackend()
      .then(async (backend): Promise<BackgroundBackend> => {
        if (myGeneration !== state.generation) {
          backend.stop();
          return { ...backend, client: await getBackgroundClient() };
        }
        state.backgroundBackend = backend;
        return backend;
      })
      .catch((err) => {
        if (myGeneration === state.generation) state.startingPromise = null;
        throw err;
      });
  }
  return (await state.startingPromise).client;
}

export function getBackgroundBackendKind(): BackgroundBackendKind | "starting" | "none" {
  if (state.backgroundBackend) return state.backgroundBackend.kind;
  if (state.startingPromise) return "starting";
  return "none";
}

export function getBackgroundLivePid(): number | null {
  return state.backgroundBackend?.pid ?? null;
}

export function __resetBackgroundSupervisorForTests(): void {
  void restartBackgroundBackend();
}

export async function completeBackground(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  opts?: {
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: "json_schema"; json_schema: Record<string, unknown> } | { type: "json_object"; schema?: Record<string, unknown> };
  }
): Promise<{ ok: true; text: string } | { ok: false; unavailable: true }> {
  try {
    const client = await getBackgroundClient();
    const response = await client.chatComplete({
      model: "background",
      messages,
      temperature: opts?.temperature,
      ...seedFields(),
      max_tokens: opts?.max_tokens ?? 1024,
      response_format: opts?.response_format as any,
      chat_template_kwargs: { enable_thinking: false },
    });
    const choice = response.choices[0];
    if (!choice) {
      return { ok: false, unavailable: true };
    }
    return { ok: true, text: choice.message.content };
  } catch {
    return { ok: false, unavailable: true };
  }
}
