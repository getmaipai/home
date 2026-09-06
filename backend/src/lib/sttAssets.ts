// STT's own downloadable models (session-c-brain-and-voice.md step 5):
// Silero VAD (utterance endpointing, lib/sileroVad.ts) and Moonshine
// tiny-en int8 (transcription, lib/stt.ts) - same "pinned version,
// pinned URL, checksum verified" shape wakewordAssets.ts already
// established for this exact kind of third-party model.
//
// Silero VAD's URL/sha256 are the identical pin the archived legacy
// hub's own download.ts carried (`home-legacy.git`'s SILERO_VAD_URL/
// SILERO_VAD_SHA256) - re-verified by downloading it fresh this session
// rather than trusted from the old comment, and it still matches byte
// for byte. Moonshine's sha256 was computed locally against the file
// this session actually downloaded, the same "never copied from a
// third-party listing" discipline wakewordAssets.ts's own header states.
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadUrl } from "@/lib/modelDownload";
import { sttDir } from "@/lib/paths";
import { singleflight } from "@/lib/singleflight";

const execFileAsync = promisify(execFile);

export const SILERO_VAD_ASSET = {
  file: "silero_vad.onnx",
  url: "https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx",
  sha256: "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f",
  expectedBytes: 2_327_524,
};

// Exported (not module-private like the constant's own value used to
// be) so lib/privacy.ts's "what leaves the house" table can name this
// exact host without a second, hand-copied URL that could drift - a
// code review (2026-09-06) found this asset's own download was missing
// from that page entirely, the same class of gap that page's own
// comments already record having happened and been fixed twice before.
export const MOONSHINE_ARCHIVE = {
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2",
  sha256: "d5fe6ec4334fef36255b2a4010412cad4c007e33103fec62fb5d17cad88086f2",
  expectedBytes: 107_600_538,
};

// The archive's own top-level directory name (its tar entries are all
// prefixed with this), not something this file chooses.
export const MOONSHINE_DIR = join(sttDir, "sherpa-onnx-moonshine-tiny-en-int8");

export function sileroVadPath(): string {
  return join(sttDir, SILERO_VAD_ASSET.file);
}

export function moonshinePath(file: string): string {
  return join(MOONSHINE_DIR, file);
}

// encode.int8.onnx is the last file a successful extraction produces
// (tar writes archive members in the order they were added, and this one
// sorts last among the four model files) - checked here rather than
// after every individual file for the same "one representative file
// proves the whole thing landed" reasoning isWakewordAssetInstalled()
// uses per-file, scaled up to an archive.
export function isSttInstalled(): boolean {
  return existsSync(sileroVadPath()) && existsSync(moonshinePath("encode.int8.onnx"));
}

/** Downloads and installs both STT assets if missing. singleflight()
 * (lib/singleflight.ts): concurrent callers (a WS stream opening while a
 * REST transcribe call is also cold-starting) share one real download
 * instead of racing two downloadUrl() calls at the same destination
 * path, the identical reason ensureWakewordAssets() already needs it. */
export const ensureSttAssets = singleflight(async (): Promise<void> => {
  mkdirSync(sttDir, { recursive: true });
  await downloadUrl(SILERO_VAD_ASSET.url, sileroVadPath(), {
    expectedSha256: SILERO_VAD_ASSET.sha256,
    expectedBytes: SILERO_VAD_ASSET.expectedBytes,
  });

  if (existsSync(moonshinePath("encode.int8.onnx"))) return;

  const archivePath = join(sttDir, "moonshine.tar.bz2");
  await downloadUrl(MOONSHINE_ARCHIVE.url, archivePath, {
    expectedSha256: MOONSHINE_ARCHIVE.sha256,
    expectedBytes: MOONSHINE_ARCHIVE.expectedBytes,
  });
  await execFileAsync("tar", ["xjf", archivePath, "-C", sttDir]);
  unlinkSync(archivePath);
});
