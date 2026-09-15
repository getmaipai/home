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
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { embedModelPath, ensureEmbedModel, EMBED_MODEL_FILE, EMBED_MODEL_SHA256, EMBED_MODEL_DIMENSIONS } from "@/lib/embedAssets.js";
import { backgroundModelPath, ensureBackgroundModel, BACKGROUND_MODEL_FILE, BACKGROUND_MODEL_SHA256 } from "@/lib/backgroundAssets.js";
import { backgroundLaunchArgs } from "@/lib/backgroundSupervisor.js";
import { engineBinaryPath } from "@/lib/llmSupervisor.js";
import { spawnAndWaitHealthy } from "@/lib/sidecars.js";
import { detectHardware } from "@/lib/hardware.js";

export { EMBED_MODEL_FILE, EMBED_MODEL_SHA256, EMBED_MODEL_DIMENSIONS, BACKGROUND_MODEL_FILE, BACKGROUND_MODEL_SHA256 };

export interface EngineHandle {
  client: LlamaServerClient;
  description: string;
  stop: () => Promise<void>;
}

// Dedicated ports, distinct from the hub's own (8788 chat, 8794 embed)
// and from the emotion-only draft's own training port (18894 embed),
// so a stray leftover process from any of those can never be mistaken
// for this run's.
const TRAINING_CHAT_PORT = Number(process.env.MAIPAI_TRAIN_CHAT_PORT ?? 18788);
const TRAINING_EMBED_PORT = Number(process.env.MAIPAI_TRAIN_EMBED_PORT ?? 18795);

async function spawnEngine(opts: { binPath: string; modelPath: string; port: number; extraArgs: string[]; label: string; description: string }): Promise<EngineHandle> {
  const client = new LlamaServerClient(`http://127.0.0.1:${opts.port}`);
  const proc = await spawnAndWaitHealthy({
    command: [opts.binPath, "--model", opts.modelPath, "--port", String(opts.port), "--host", "127.0.0.1", ...opts.extraArgs],
    port: opts.port,
    healthCheck: () => client.health(),
    timeoutMs: 120_000,
    label: opts.label,
  });
  return {
    client,
    description: opts.description,
    stop: async () => {
      proc.kill();
      await proc.exited;
    },
  };
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
    port: TRAINING_EMBED_PORT,
    extraArgs: ["--embedding"],
    label: "llama-server (embed, training-only)",
    description: `spawned local llama-server --embedding on :${TRAINING_EMBED_PORT}, pinned ${EMBED_MODEL_FILE}, for this run only`,
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
  const fullArgs = backgroundLaunchArgs(binPath, backgroundModelPath(), TRAINING_CHAT_PORT, 0);
  // backgroundLaunchArgs returns [binPath, "--model", modelPath, "--port", port, "--host", host, ...flags] -
  // spawnEngine already supplies binPath/model/port/host, so only the flags after them are reused here.
  const flagsOnly = fullArgs.slice(7);
  return spawnEngine({
    binPath,
    modelPath: backgroundModelPath(),
    port: TRAINING_CHAT_PORT,
    extraArgs: flagsOnly,
    label: "llama-server (chat/4B, training-only)",
    description: `spawned local llama-server on :${TRAINING_CHAT_PORT}, pinned ${BACKGROUND_MODEL_FILE}, for this run only`,
  });
}
