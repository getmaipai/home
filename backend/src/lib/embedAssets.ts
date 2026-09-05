// The `embed` role's one pinned model (platform plan 4.11, 2026-09-04):
// no catalog entry, no download job, no household selection - the same
// "one thing to run, nothing to choose between" scope ttsSupervisor.ts's
// own header comment already carries for `tts`. Nomic AI's own GGUF
// conversion, not a community re-conversion: Apache-2.0, not gated,
// confirmed live via the HF API (`gated: false`), a well-known and
// actively maintained embedding model llama-server's `--embedding` mode
// runs directly. SHA-256 computed locally against the file this session
// actually downloaded (org rule: never trusted from a listing), matching
// wakewordAssets.ts's own discipline for the identical reason.
import { join } from "node:path";
import { downloadUrl } from "@/lib/modelDownload";
import { modelsDir } from "@/lib/paths";
import { singleflight } from "@/lib/singleflight";

export const EMBED_MODEL_FILE = "nomic-embed-text-v1.5.Q4_K_M.gguf";
export const EMBED_MODEL_URL =
  "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf";
export const EMBED_MODEL_SHA256 = "d4e388894e09cf3816e8b0896d81d265b55e7a9fff9ab03fe8bf4ef5e11295ac";
export const EMBED_MODEL_BYTES = 84_106_624;

// The real output dimension of this specific model - embedSupervisor.ts
// has no use for it (llama-server's own response carries the real
// vectors), but the stub server's own comment cites it for why its canned
// vectors use the same width.
export const EMBED_MODEL_DIMENSIONS = 768;

export function embedModelPath(): string {
  return join(modelsDir, EMBED_MODEL_FILE);
}

/** Downloads the pinned embedding model if it isn't already on disk.
 * singleflight()'d the same way ensureWakewordAssets() is: a concurrent
 * second caller awaits the same in-flight download instead of starting
 * its own, and a failed attempt clears itself so the next call retries
 * fresh rather than replaying the same rejection forever. */
export const ensureEmbedModel = singleflight(async (): Promise<void> => {
  await downloadUrl(EMBED_MODEL_URL, embedModelPath(), {
    expectedSha256: EMBED_MODEL_SHA256,
    expectedBytes: EMBED_MODEL_BYTES,
  });
});
