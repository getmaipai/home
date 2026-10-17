// VIDEO-GEN-05: whether the Stack has a video engine that can make a clip right now. The video tool is offered only
// then, so the model never sees a tool that would fail for want of a model (rule 6 still covers a failure after the
// offer). A read failure is "not ready"; the answer is cached briefly so a chat turn pays for it at most once every
// 20 seconds.
import { isStackConfigured } from "@/lib/stackEngine";
import { videoStatus, type StackVideoStatus } from "./stack";

let cached: { at: number; status: StackVideoStatus | null } | null = null;
let forTests: StackVideoStatus | null | undefined;
const TTL_MS = 20_000;

/** Test seam: the Stack's video status (null: no engine), or undefined to read for real. */
export function __setVideoStatusForTests(status: StackVideoStatus | null | undefined): void { forTests = status; cached = null; }

export async function videoEngineStatus(): Promise<StackVideoStatus | null> {
  if (forTests !== undefined) return forTests;
  if (!isStackConfigured()) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.status;
  const status = await videoStatus();
  cached = { at: Date.now(), status };
  return status;
}

export function dropVideoStatusCache(): void { cached = null; }

/** The engine is installed and able to take a job (setting up, idle or running all count: the job queues). */
export function videoStatusReady(status: StackVideoStatus | null): boolean {
  if (!status) return false;
  if (status.state === "unsupported" || status.state === "off" || status.state === "not-installed") return false;
  return status.available !== false;
}

export async function videoEngineReady(): Promise<boolean> {
  return videoStatusReady(await videoEngineStatus());
}

/** A ready status for tests. */
export function readyVideoStatusForTests(overrides: Partial<StackVideoStatus> = {}): StackVideoStatus {
  return {
    state: "idle", phase: null, available: true, code: null, reason: null, tier: "p128",
    memory: { fits: true, reason: null, peak_gb: 44.1 }, model: { id: "wan2.2-ti2v-5b-fastwan-mlx", installed: true },
    limits: { max_seconds: 5, fps: 24, default_size: "832x480", max_pixels: 399360, size_step: 32, min_side: 256, max_frames: 121, max_loras: 4, max_lora_strength: 2, max_prompt_chars: 4000, queue_max: 4 },
    loras_supported: true, lora_count: 0, audio: false,
    reference_images: { generated: true, uploaded: false, reason: "" },
    ...overrides,
  };
}
