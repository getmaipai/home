// The `background` role's pinned model for extraction, dedupe, summaries,
// and other background work that runs on a separate process (platform plan
// decision 3, 2026-09-12). No catalog entry, no download job, no household
// selection - the same scope embedAssets.ts carries for `embed`. Qwen's own
// GGUF conversion, Apache-2.0, not gated. SHA-256 computed locally against
// the file this session actually downloaded (org rule: never trusted from a
// listing), matching embedAssets.ts's own discipline for the identical reason.
import { join } from "node:path";
import { downloadUrl } from "@/lib/modelDownload";
import { modelsDir } from "@/lib/paths";
import { singleflight } from "@/lib/singleflight";

export const BACKGROUND_MODEL_FILE = "qwen3-1.7b-q8-0.gguf";
export const BACKGROUND_MODEL_URL =
  "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf";
export const BACKGROUND_MODEL_SHA256 =
  "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a";
export const BACKGROUND_MODEL_BYTES = 1_834_426_016;

// Fallback model when MAIPAI_BACKGROUND_MODEL=qwen3-4b is set
export const BACKGROUND_MODEL_FALLBACK_FILE = "qwen3-4b-q4-k-m.gguf";
export const BACKGROUND_MODEL_FALLBACK_URL =
  "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf";
export const BACKGROUND_MODEL_FALLBACK_SHA256 =
  "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5";
export const BACKGROUND_MODEL_FALLBACK_BYTES = 2_497_280_256;

function getBackgroundModelConfig() {
  const fallback = process.env.MAIPAI_BACKGROUND_MODEL === "qwen3-4b";
  return fallback
    ? {
        file: BACKGROUND_MODEL_FALLBACK_FILE,
        url: BACKGROUND_MODEL_FALLBACK_URL,
        sha256: BACKGROUND_MODEL_FALLBACK_SHA256,
        bytes: BACKGROUND_MODEL_FALLBACK_BYTES,
      }
    : {
        file: BACKGROUND_MODEL_FILE,
        url: BACKGROUND_MODEL_URL,
        sha256: BACKGROUND_MODEL_SHA256,
        bytes: BACKGROUND_MODEL_BYTES,
      };
}

export function backgroundModelPath(): string {
  const config = getBackgroundModelConfig();
  return join(modelsDir, config.file);
}

/** Downloads the pinned background model if it isn't already on disk.
 * singleflight()'d the same way ensureEmbedModel() is: a concurrent
 * second caller awaits the same in-flight download instead of starting
 * its own, and a failed attempt clears itself so the next call retries
 * fresh rather than replaying the same rejection forever. */
export const ensureBackgroundModel = singleflight(async (): Promise<void> => {
  const config = getBackgroundModelConfig();
  await downloadUrl(config.url, backgroundModelPath(), {
    expectedSha256: config.sha256,
    expectedBytes: config.bytes,
  });
});
