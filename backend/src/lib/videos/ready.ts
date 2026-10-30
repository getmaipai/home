// VIDEO-GEN-05: whether the Stack has a video engine that can make a clip right now. The video tool is offered only
// then, so the model never sees a tool that would fail for want of a model (rule 6 still covers a failure after the
// offer). A read failure is "not ready"; the answer is cached briefly so a chat turn pays for it at most once every
// 20 seconds.
import { plainEngineLine } from "@/lib/pictures/plainLine";
import { isStackConfigured } from "@/lib/stackEngine";
import { videoStatus, type StackVideoStatus } from "./stack";
import { detailedVideoReady, quickVideoReady } from "./quality";

let cached: { at: number; status: StackVideoStatus | null } | null = null;
let forTests: StackVideoStatus | null | undefined;
const TTL_MS = 20_000;

/** Test seam: the Stack's video status (null: no engine), or undefined to read for real. */
export function __setVideoStatusForTests(status: StackVideoStatus | null | undefined): void { forTests = status; cached = null; }
export function __setVideoStatusReaderForTests(reader: (() => Promise<StackVideoStatus | null>) | null): void { statusReaderForTests = reader; cached = null; }
let statusReaderForTests: (() => Promise<StackVideoStatus | null>) | null = null;

export async function videoEngineStatus(): Promise<StackVideoStatus | null> {
  if (statusReaderForTests) return statusReaderForTests();
  if (forTests !== undefined) return forTests;
  if (!isStackConfigured()) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.status;
  const status = await videoStatus();
  cached = { at: Date.now(), status };
  return status;
}

export function dropVideoStatusCache(): void { cached = null; }

/** The engine is installed and able to take a job (setting up, idle or running all count: the job queues). Either kind counts: a computer with only Detailed installed can still make a video. */
export function videoStatusReady(status: StackVideoStatus | null): boolean {
  if (!status) return false;
  if (status.available === false) return false;
  return quickVideoReady(status) || detailedVideoReady(status);
}

export async function videoEngineReady(): Promise<boolean> {
  return videoStatusReady(await videoEngineStatus());
}

/** A ready status for tests. `detailed: "installed"` or `"missing"` adds the Stack's `qualities` (VIDEO-LTX-01); left out is an older Stack with Quick only. */
export function readyVideoStatusForTests(overrides: Partial<StackVideoStatus> & { detailed?: "installed" | "missing"; quickMissing?: boolean; /** A Stack that can start a Detailed clip from a picture. */ detailedPicture?: boolean } = {}): StackVideoStatus {
  const { detailed, quickMissing, detailedPicture, ...rest } = overrides;
  const base: StackVideoStatus = {
    state: "idle", phase: null, available: true, code: null, reason: null, tier: "p128",
    memory: { fits: true, reason: null, peak_gb: 44.1 }, model: { id: "wan2.2-ti2v-5b-fastwan-mlx", installed: true },
    limits: { max_seconds: 5, fps: 24, default_size: "832x480", max_pixels: 399360, size_step: 32, min_side: 256, max_frames: 121, max_loras: 4, max_lora_strength: 2, max_prompt_chars: 4000, queue_max: 4 },
    loras_supported: true, lora_count: 0, audio: false,
    reference_images: { generated: true, uploaded: false, reason: "" },
    ...rest,
  };
  if (!detailed && !quickMissing) return base;
  const quality = (id: string, installed: boolean, audio: boolean, maxSeconds: number, size: string): NonNullable<StackVideoStatus["qualities"]>["quick"] => ({
    id, installed, available: true, audio, limits: { max_seconds: maxSeconds, fps: 24, default_size: size }, memory: { fits: true, reason: null, peak_gb: 44 },
    install: { models: [], remaining_bytes: installed ? 0 : 73_572_000_000, download_bytes: 73_572_000_000 }, licence: audio ? { id: "ltx-2.x-community-2026-08-11", name: "LTX-2.x Community License Agreement (2026-08-11)", url: "https://example.com/licence" } : null, lora_base_model: audio ? "ltx-2.3" : "wan2.2-ti2v-5b",
    ...(detailedPicture ? { image_to_video: true } : {}),
  });
  return { ...base, state: quickMissing ? "not-installed" : base.state, qualities: { quick: quality("fastwan2-2-ti2v-5b-mlx-bf16", !quickMissing, false, 5, "832x480"), detailed: quality("ltx-2-3-distilled-mlx", detailed === "installed", true, 10, "768x448") } };
}

const NO_VIDEO_MODEL = "No video model is installed on this computer yet. An admin can add one in Settings, Pictures, videos and music.";
const VIDEO_ENGINE_UNREACHABLE = "I can't reach the video engine on this computer right now. Check that the MaiPai Stack is running, then try again.";

/** Why a video cannot be made now, in the person's terms (see pictureNotReadyReason). */
export function videoNotReadyReason(engine: StackVideoStatus | null): string {
  return (engine?.reason ? plainEngineLine(engine.reason) : null) ?? (engine === null ? VIDEO_ENGINE_UNREACHABLE : NO_VIDEO_MODEL);
}
