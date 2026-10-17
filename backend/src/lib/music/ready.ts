// MUSIC-GEN-03: whether the Stack has a music engine that can make a song right now. The music tool is offered only
// then, so the model never sees a tool that would fail for want of a model (rule 6 still covers a failure after the
// offer). A read failure is "not ready"; the answer is cached briefly so a chat turn pays for it at most once every
// 20 seconds.
import { isStackConfigured } from "@/lib/stackEngine";
import { musicStatus, type StackMusicStatus } from "./stack";

let cached: { at: number; status: StackMusicStatus | null } | null = null;
let forTests: StackMusicStatus | null | undefined;
const TTL_MS = 20_000;

/** Test seam: the Stack's music status (null: no engine), or undefined to read for real. */
export function __setMusicStatusForTests(status: StackMusicStatus | null | undefined): void { forTests = status; cached = null; }

export async function musicEngineStatus(): Promise<StackMusicStatus | null> {
  if (forTests !== undefined) return forTests;
  if (!isStackConfigured()) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.status;
  const status = await musicStatus();
  cached = { at: Date.now(), status };
  return status;
}

export function dropMusicStatusCache(): void { cached = null; }

/** The engine is installed and able to take a job (setting up, idle or running all count: the job queues). */
export function musicStatusReady(status: StackMusicStatus | null): boolean {
  if (!status || !status.limits || !Number.isFinite(status.limits.max_seconds) || !Number.isFinite(status.limits.min_seconds)) return false;
  if (status.state === "unsupported" || status.state === "off" || status.state === "not-installed") return false;
  return status.available === true;
}

export async function musicEngineReady(): Promise<boolean> {
  return musicStatusReady(await musicEngineStatus());
}

/** A ready status for tests. */
export function readyMusicStatusForTests(overrides: Partial<StackMusicStatus> = {}): StackMusicStatus {
  return { state: "idle", available: true, limits: { min_seconds: 10, max_seconds: 600 }, quality: ["quick", "detailed"], ...overrides };
}
