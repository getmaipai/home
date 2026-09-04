// The wake-word pipeline's shared feature models (melspectrogram +
// embedding) plus a first stock per-phrase detector (2026-09-04, the
// wake-word plan in docs/dev.md, phase 1: "infrastructure proof, no
// custom model yet"). Every file is upstream openWakeWord, pinned to a
// specific GitHub release and checksum-verified on download - the org's
// "download, don't vendor" rule and its "pinned version, pinned URL,
// checksum verified" third-party-model rule, the same shape
// llmSupervisor.ts's GGUF/engine downloads already use via
// modelDownload.ts's downloadUrl().
//
// Deliberately narrow: only `hey_jarvis`, openWakeWord's own well-known,
// community-validated stock phrase, not a MaiPai-trained "hey maipai"
// detector - training our own detector is phase 2+ of the plan, gated on
// real household recordings for validation that don't exist yet. Every
// SHA-256 below was computed locally against the file this session
// actually downloaded and verified, not copied from a third-party
// listing.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { downloadUrl } from "@/lib/modelDownload";
import { wakewordDir } from "@/lib/paths";
import { singleflight } from "@/lib/singleflight";

const OWW_RELEASE_BASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1";

export interface WakewordAsset {
  file: string;
  url: string;
  sha256: string;
}

// Shared by every detector - required before any wake-word inference can
// run at all.
export const WAKEWORD_SHARED_ASSETS: WakewordAsset[] = [
  {
    file: "melspectrogram.onnx",
    url: `${OWW_RELEASE_BASE}/melspectrogram.onnx`,
    sha256: "ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176",
  },
  {
    file: "embedding_model.onnx",
    url: `${OWW_RELEASE_BASE}/embedding_model.onnx`,
    sha256: "70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1",
  },
];

// One stock detector, ships enabled by default (phase 1 only - see the
// module comment above).
export const WAKEWORD_STOCK_DETECTOR: WakewordAsset = {
  file: "hey_jarvis_v0.1.onnx",
  url: `${OWW_RELEASE_BASE}/hey_jarvis_v0.1.onnx`,
  sha256: "94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2c",
};

export const WAKEWORD_ALL_ASSETS: WakewordAsset[] = [...WAKEWORD_SHARED_ASSETS, WAKEWORD_STOCK_DETECTOR];

export function wakewordAssetPath(file: string): string {
  return join(wakewordDir, file);
}

export function isWakewordAssetInstalled(file: string): boolean {
  return existsSync(wakewordAssetPath(file));
}

/** Downloads every pinned wake-word asset not already on disk. Safe to
 * call on every request that needs one (routes/voice.ts): the frontend
 * pipeline loads mel, embedding, and the detector as three concurrent
 * requests (wake-word-pipeline.ts's loadPipeline()), which would
 * otherwise race multiple downloadUrl() calls against the same
 * destination file - downloadUrl() has no locking of its own, so two
 * concurrent calls for the same file could corrupt each other's `.part`
 * file. singleflight() (lib/singleflight.ts) means every concurrent
 * caller awaits the same real download instead of starting their own,
 * and a failed attempt clears itself so the next call retries fresh
 * rather than replaying the same rejection forever. */
export const ensureWakewordAssets = singleflight(async (): Promise<void> => {
  for (const asset of WAKEWORD_ALL_ASSETS) {
    await downloadUrl(asset.url, wakewordAssetPath(asset.file), { expectedSha256: asset.sha256 });
  }
});
