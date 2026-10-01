// Home downloads only the small Silero VAD model used to cut streaming
// audio into utterances. Transcription models belong to the Stack.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { downloadUrl } from "@/lib/modelDownload";
import { sttDir } from "@/lib/paths";
import { singleflight } from "@maipai/core/src/singleflight";

export const SILERO_VAD_ASSET = {
  file: "silero_vad.onnx",
  url: "https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx",
  sha256: "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f",
  expectedBytes: 2_327_524,
};

export function sileroVadPath(): string {
  return join(sttDir, SILERO_VAD_ASSET.file);
}

export const ensureSileroVadAsset = singleflight(async (): Promise<void> => {
  mkdirSync(sttDir, { recursive: true });
  await downloadUrl(SILERO_VAD_ASSET.url, sileroVadPath(), {
    expectedSha256: SILERO_VAD_ASSET.sha256,
    expectedBytes: SILERO_VAD_ASSET.expectedBytes,
  });
});
