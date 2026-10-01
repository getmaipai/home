// ACT-02: dedicated chat (4B) and embed engine instances for this
// training run only, spawned by hand the way scripts/bench/steering-
// spike.ts documents doing it (its header: "spawning a SECOND llama-
// server that shares no state with the one llmSupervisor.ts already
// manages is exactly the kind of one-off infrastructure a bench script
// has no business doing quietly on the side" - equally true of a
// training script). Unlike the emotion-only draft's resolveEmbedBackend()
// (../../../../home-codex-act02/backend/scripts/train/turn-signal-
// heads.ts), this NEVER checks whether a dev-hub engine is already
// running on the production ports: 2026-09-14, the coordinator's own
// instruction for this run was "spawn your own instances... do not point
// at them" (the laptop's engines were down for an unrelated trial at the
// time), and the same reasoning holds generally - a training run must
// never compete with, or be silently served by, whatever the household's
// engines happen to be doing right now. Every process this file starts,
// it stops itself.
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { embedModelPath, ensureEmbedModel, EMBED_MODEL_FILE, EMBED_MODEL_SHA256, EMBED_MODEL_DIMENSIONS } from "@/lib/embedAssets.js";
import { backgroundModelPath, ensureBackgroundModel, BACKGROUND_MODEL_FILE, BACKGROUND_MODEL_SHA256 } from "@/lib/backgroundAssets.js";
import { backgroundLaunchArgs } from "@/lib/backgroundSupervisor.js";
import { engineBinaryPath } from "@/lib/llmSupervisor.js";
import { spawnProcessGroup, terminateProcessGroup } from "./processGroup.js";
import { detectHardware } from "@/lib/hardware.js";

export { EMBED_MODEL_FILE, EMBED_MODEL_SHA256, EMBED_MODEL_DIMENSIONS, BACKGROUND_MODEL_FILE, BACKGROUND_MODEL_SHA256 };

export interface EngineHandle {
  client: LlamaServerClient;
  description: string;
  stop: () => Promise<void>;
}

const runningEngines = new Map<number, () => Promise<void>>();
let signalCleanupStarted = false;
function installSignalCleanup(): void {
  if (signalCleanupStarted) return;
  signalCleanupStarted = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void Promise.allSettled([...runningEngines.values()].map((stop) => stop())).finally(() => {
        process.exit(signal === "SIGINT" ? 130 : 143);
      });
    });
  }
}

async function ephemeralPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not allocate an ephemeral training engine port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function spawnEngine(opts: { binPath: string; modelPath: string; port: number; extraArgs: string[]; label: string; description: string }): Promise<EngineHandle> {
  const client = new LlamaServerClient(`http://127.0.0.1:${opts.port}`);
  const proc = spawnProcessGroup([opts.binPath, "--model", opts.modelPath, "--port", String(opts.port), "--host", "127.0.0.1", ...opts.extraArgs]);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    runningEngines.delete(proc.pid);
    await terminateProcessGroup(proc.pid, proc.exited);
  };
  runningEngines.set(proc.pid, stop);
  installSignalCleanup();
  void proc.exited.finally(() => runningEngines.delete(proc.pid));
  try {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`${opts.label} exited early (code ${proc.exitCode}) before becoming healthy`);
      if (await client.health()) return { client, description: opts.description, stop };
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`${opts.label} did not become healthy within 120000ms`);
  } catch (error) {
    await stop();
    throw error;
  }
}

/** The embed engine (nomic-embed-text-v1.5), spawned fresh for this run. */
export async function startEmbedEngine(): Promise<EngineHandle> {
  console.log(`  ensuring the pinned embed model (${EMBED_MODEL_FILE}) is on disk (verified checksum, downloaded if missing)...`);
  await ensureEmbedModel();
  const hw = await detectHardware();
  const binPath = engineBinaryPath(hw);
  if (!binPath || !existsSync(binPath)) throw new Error("no llama-server engine binary is installed - start the hub once to install one");
  return spawnEngine({
    binPath,
    modelPath: embedModelPath(),
    port: await ephemeralPort(),
    extraArgs: ["--embedding"],
    label: "llama-server (embed, training-only)",
    description: `spawned local llama-server --embedding on an ephemeral port, pinned ${EMBED_MODEL_FILE}, for this run only`,
  });
}

/** The 4B chat engine (backgroundAssets.ts's default model - the same
 * "4B" docs/dev.md section 12 names for the labeling pass), spawned
 * fresh for this run using the household's own launch flags
 * (backgroundLaunchArgs, reused rather than re-derived) minus the
 * ones that name a different port/model, which this call already
 * supplies itself. */
export async function startChatEngine(): Promise<EngineHandle> {
  console.log(`  ensuring the pinned background model (${BACKGROUND_MODEL_FILE}) is on disk (verified checksum, downloaded if missing)...`);
  await ensureBackgroundModel();
  const hw = await detectHardware();
  const binPath = engineBinaryPath(hw);
  if (!binPath || !existsSync(binPath)) throw new Error("no llama-server engine binary is installed - start the hub once to install one");
  const port = await ephemeralPort();
  const fullArgs = backgroundLaunchArgs(binPath, backgroundModelPath(), port, 0);
  // backgroundLaunchArgs returns [binPath, "--model", modelPath, "--port", port, "--host", host, ...flags] -
  // spawnEngine already supplies binPath/model/port/host, so only the flags after them are reused here.
  const flagsOnly = fullArgs.slice(7);
  return spawnEngine({
    binPath,
    modelPath: backgroundModelPath(),
    port,
    extraArgs: flagsOnly,
    label: "llama-server (chat/4B, training-only)",
    description: `spawned local llama-server on an ephemeral port, pinned ${BACKGROUND_MODEL_FILE}, for this run only`,
  });
}
