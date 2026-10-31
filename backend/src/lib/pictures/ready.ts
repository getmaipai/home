// IMGGEN-HOME-01: whether the Stack has a picture engine that can make a picture right now. The picture tool is
// offered only then, so the model never sees a tool that would fail for want of a model (rule 6 still covers a
// failure after the offer). A read failure is "not ready"; the answer is cached briefly so a chat turn pays for
// it at most once every 20 seconds.
import { plainEngineLine } from "@/lib/pictures/plainLine";
import { isStackConfigured } from "@/lib/stackEngine";
import { imageStatus, type StackImageStatus } from "./stack";
import { QUICK_MODEL } from "./quality";

let cached: { at: number; status: StackImageStatus | null } | null = null;
let forTests: StackImageStatus | null | undefined;
const TTL_MS = 20_000;

/** Test seam: the Stack's picture status (null: no engine), or undefined to read for real. */
export function __setPictureStatusForTests(status: StackImageStatus | null | undefined): void { forTests = status; cached = null; }
export function __setPictureStatusReaderForTests(reader: (() => Promise<StackImageStatus | null>) | null): void { statusReaderForTests = reader; cached = null; }
let statusReaderForTests: (() => Promise<StackImageStatus | null>) | null = null;

let refreshing: Promise<StackImageStatus | null> | null = null;
function refresh(): Promise<StackImageStatus | null> {
  refreshing ??= imageStatus().then((status) => { cached = { at: Date.now(), status }; return status; }).finally(() => { refreshing = null; });
  return refreshing;
}

/** Stale-while-revalidate: a chat turn never waits on the Stack for this. A fresh answer is used as is; a stale one is
 * used at once while a refresh runs; the very first read waits, at most 1.5 seconds, and reads as "no engine" past that. */
export async function pictureEngineStatus(): Promise<StackImageStatus | null> {
  if (statusReaderForTests) return statusReaderForTests();
  if (forTests !== undefined) return forTests;
  if (!isStackConfigured()) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.status;
  const pending = refresh();
  if (cached) return cached.status;
  return Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500))]);
}

export function dropPictureStatusCache(): void { cached = null; }

/** The engine is installed and able to take a job (building or running counts: the job queues). */
export async function pictureEngineReady(): Promise<boolean> {
  const status = await pictureEngineStatus();
  if (!status) return false;
  if (status.state === "unsupported" || status.state === "off" || status.state === "not-installed") return false;
  return status.available !== false;
}

/** A test status that is ready. */
export function readyStatusForTests(overrides: Partial<StackImageStatus> = {}): StackImageStatus {
  return {
    state: "idle", phase: null, available: true, reason: null, default_model: QUICK_MODEL,
    models: [{ id: QUICK_MODEL, family: "flux2", installed: true, licence: "Apache-2.0", loras: true, edit: true, steps_default: 4, peak_gb: 13.5 }],
    loras_supported: true, edit: { generative: true, masked: true, references: 2 },
    limits: { min_side: 256, max_side: 2048, size_step: 16, max_n: 4, max_prompt_chars: 2000, max_loras: 3, queue_max: 8 }, idle_unload_s: 600,
    memory: { fits: true, reason: null, peak_gb: 13.5 },
    ...overrides,
  };
}

const NO_PICTURE_MODEL = "No picture model is installed on this computer yet. An admin can add one in Settings, Pictures and videos.";
const PICTURE_ENGINE_UNREACHABLE = "I can't reach the picture engine on this computer right now. Check that the MaiPai Stack is running, then try again.";

/** Why a picture cannot be made now, in the person's terms: the engine's own reason, else "cannot reach it" when the Stack
 * did not answer at all, else "no model". A Stack that is down is not a missing model (found by the generation QA). */
export function pictureNotReadyReason(engine: StackImageStatus | null): string {
  return (engine?.reason ? plainEngineLine(engine.reason) : null) ?? (engine === null ? PICTURE_ENGINE_UNREACHABLE : NO_PICTURE_MODEL);
}
