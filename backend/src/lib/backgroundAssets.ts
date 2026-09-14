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

// MEM-05 (2026-09-13, Jesse's decision): the household default is the
// 4B. Live use of the 1.7B showed it re-emitting its own extraction
// prompt's few-shot examples as memories (the prompt's negative
// password example and a template placeholder included), attributing
// the hub's replies and world facts to the speaker, and saving the
// passing state of a conversation instead of the durable fact; about
// one record in ten was real. The judge eval's numbers are in
// docs/dev/session-a.md ("MEM-05"). The 1.7B stays available as the
// small alternative, selected by MAIPAI_BACKGROUND_MODEL=qwen3-1.7b.
export const BACKGROUND_MODEL_FILE = "qwen3-4b-q4-k-m.gguf";
export const BACKGROUND_MODEL_URL =
  "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf";
export const BACKGROUND_MODEL_SHA256 =
  "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5";
export const BACKGROUND_MODEL_BYTES = 2_497_280_256;

// The small alternative, MAIPAI_BACKGROUND_MODEL=qwen3-1.7b (the
// default until MEM-05).
export const BACKGROUND_MODEL_SMALL_FILE = "qwen3-1.7b-q8-0.gguf";
export const BACKGROUND_MODEL_SMALL_URL =
  "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf";
export const BACKGROUND_MODEL_SMALL_SHA256 =
  "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a";
export const BACKGROUND_MODEL_SMALL_BYTES = 1_834_426_016;

let warnedUnknownModel = false;

function getBackgroundModelConfig() {
  const requested = process.env.MAIPAI_BACKGROUND_MODEL;
  const small = requested === "qwen3-1.7b";
  // A value that names neither model (a typo, or the retired
  // "qwen3-4b" switch, which now names the default) is said once, so an
  // opt-in that did not take is not silent (a review).
  if (requested && !small && requested !== "qwen3-4b" && !warnedUnknownModel) {
    warnedUnknownModel = true;
    console.warn(`[background] MAIPAI_BACKGROUND_MODEL="${requested}" names no model; using the default ${BACKGROUND_MODEL_FILE} (set "qwen3-1.7b" for the small one)`);
  }
  return small
    ? {
        file: BACKGROUND_MODEL_SMALL_FILE,
        url: BACKGROUND_MODEL_SMALL_URL,
        sha256: BACKGROUND_MODEL_SMALL_SHA256,
        bytes: BACKGROUND_MODEL_SMALL_BYTES,
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
