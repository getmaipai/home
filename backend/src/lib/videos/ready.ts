// VIDEO-GEN-05: whether the Stack has a video engine that can make a clip right now. The video tool is offered only
// then, so the model never sees a tool that would fail for want of a model (rule 6 still covers a failure after the
// offer). A read failure is "not ready"; the answer is cached briefly so a chat turn pays for it at most once every
// 20 seconds.
import { plainEngineLine } from "@/lib/pictures/plainLine";
import { isStackConfigured } from "@/lib/stackEngine";
import { videoStatus, type StackVideoStatus } from "./stack";
import { detailedVideoReady, ltx25VideoReady, quickVideoReady } from "./quality";

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

/** The last status read, without waiting (a page fill is synchronous): the test status, else the cached read; a stale or empty cache starts a refresh for the next page. */
export function peekVideoEngineStatus(): StackVideoStatus | null {
  if (forTests !== undefined) return forTests;
  if (!isStackConfigured()) return null;
  if (!cached || Date.now() - cached.at >= TTL_MS) void videoEngineStatus().catch(() => undefined);
  return cached?.status ?? null;
}

export function dropVideoStatusCache(): void { cached = null; }

/** The engine is installed and able to take a job (setting up, idle or running all count: the job queues). Either kind counts: a computer with only Detailed installed can still make a video. */
/** `adult` (default false) says LTX-2.5 may count: it serves adults only, so a teen or a child is ready only when Wan Quick is (VIDEO-TIERS-01, rules 0, 8, 10). */
export function videoStatusReady(status: StackVideoStatus | null, adult = false): boolean {
  if (!status) return false;
  if (status.available === false) return false;
  return quickVideoReady(status) || (adult && (detailedVideoReady(status) || ltx25VideoReady(status)));
}

export async function videoEngineReady(adult = false): Promise<boolean> {
  return videoStatusReady(await videoEngineStatus(), adult);
}

/** A ready status for tests. `detailed: "installed"` or `"missing"` adds the Stack's `qualities` (VIDEO-LTX-01); left out is an older Stack with Quick only. */
export function readyVideoStatusForTests(overrides: Partial<StackVideoStatus> & { detailed?: "installed" | "missing"; quickMissing?: boolean; /** A Stack that can start a Detailed clip from a picture. */ detailedPicture?: boolean; /** LTX-2.5 as the Stack reports it (VIDEO-TIERS-01): `"ready"` serves it, `"missing"` reports it not ready; left out is a Stack without it. */ ltx25?: "ready" | "missing" } = {}): StackVideoStatus {
  const { detailed, quickMissing, detailedPicture, ltx25, ...rest } = overrides;
  const base: StackVideoStatus = {
    state: "idle", phase: null, available: true, code: null, reason: null, tier: "p128",
    memory: { fits: true, reason: null, peak_gb: 44.1 }, model: { id: "wan2.2-ti2v-5b-fastwan-mlx", installed: true },
    limits: { max_seconds: 5, fps: 24, default_size: "832x480", max_pixels: 399360, size_step: 32, min_side: 256, max_frames: 121, max_loras: 4, max_lora_strength: 2, max_prompt_chars: 4000, queue_max: 4 },
    loras_supported: true, lora_count: 0, audio: false,
    reference_images: { generated: true, uploaded: false, reason: "" },
    ...rest,
  };
  if (!detailed && !quickMissing && !ltx25) return base;
  const quality = (id: string, installed: boolean, audio: boolean, maxSeconds: number, size: string): NonNullable<StackVideoStatus["qualities"]>["quick"] => ({
    id, installed, available: true, audio, limits: { max_seconds: maxSeconds, fps: 24, default_size: size }, memory: { fits: true, reason: null, peak_gb: 44 },
    install: { models: [], remaining_bytes: installed ? 0 : 73_572_000_000, download_bytes: 73_572_000_000 }, licence: audio ? { id: "ltx-2.x-community-2026-08-11", name: "LTX-2.x Community License Agreement (2026-08-11)", url: "https://example.com/licence" } : null, lora_base_model: audio ? "ltx-2.3" : "wan2.2-ti2v-5b",
    ...(detailedPicture ? { image_to_video: true } : {}),
  });
  const ltx25Quality = ltx25 ? { ready: ltx25 === "ready", installed: ltx25 === "ready", available: true, environment: { ok: ltx25 === "ready" }, limits: { max_seconds: 10, fps: 24 }, profiles: [
    { name: "standard" as const, size: "512x256", width: 512, height: 256, max_seconds: 10, max_frames: 241, peak_gb: 39.4, short_peak_gb: 25.3 },
    { name: "boost" as const, size: "640x320", width: 640, height: 320, max_seconds: 5, max_frames: 121, peak_gb: 32.4, short_peak_gb: 32.4 },
    { name: "boost" as const, size: "768x448", width: 768, height: 448, max_seconds: 5, max_frames: 121, peak_gb: 45.8, short_peak_gb: 45.8 },
  ] } : undefined;
  return { ...base, state: quickMissing ? "not-installed" : base.state, qualities: { quick: quality("fastwan2-2-ti2v-5b-mlx-bf16", !quickMissing, false, 5, "832x480"), detailed: quality("ltx-2-3-distilled-mlx", detailed === "installed", true, 10, "768x448"), ...(ltx25Quality ? { ltx25: ltx25Quality } : {}) } };
}

const NO_VIDEO_MODEL = "No video model is installed on this computer yet. An admin can add one in Settings, Pictures, videos and music.";
const VIDEO_ENGINE_UNREACHABLE = "Videos are not ready yet. Try again in a few minutes.";

/** Why a video cannot be made now, in the person's terms (see pictureNotReadyReason). */
export function videoNotReadyReason(engine: StackVideoStatus | null): string {
  return (engine?.reason ? plainEngineLine(engine.reason) : null) ?? (engine === null ? VIDEO_ENGINE_UNREACHABLE : NO_VIDEO_MODEL);
}
