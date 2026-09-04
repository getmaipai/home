// "Do we need to see stats to see trends on how busy the machine has
// been and resources it's consumed" (Jesse, 2026-09-04). A small
// in-memory ring buffer, not a database table: this is operational
// telemetry about the current process's own child, not household data -
// nothing here needs to survive a hub restart or sync anywhere (the
// zero-phone-home privacy architecture's own local-stats carve-out:
// "Local stats stored in the user's own database are fine and are not
// telemetry" - this is even more local than that, never persisted at
// all). index.ts samples on the same 60s cadence as the scheduler's own
// job poll.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getEngineStatus } from "@/lib/llmSupervisor";
import { measureProcessMemoryBytes } from "@/lib/enginePostLoadCheck";
import { detectHardware } from "@/lib/hardware";

const execFileAsync = promisify(execFile);

export interface EngineStatsSample {
  at: string;
  memoryBytes: number | null;
  cpuPercent: number | null;
}

// Whether this box has an NVIDIA card is effectively fixed for the life
// of a running process (no GPU hot-plug support assumed anywhere else in
// this codebase either), but hardware.ts's own detectHardware() cache is
// only 5s - tuned for a page load's handful of near-simultaneous calls,
// not a 60s recurring timer. A code review (2026-09-04) found that gap
// meant sampleEngineStats() re-spawned a real nvidia-smi process on every
// single tick, forever, just to re-learn a value that never changes.
// Cached here instead, with a much longer TTL as a safety margin against
// a real (if unsupported) hot-plug rather than an unconditional
// once-ever cache.
const CUDA_PRESENCE_CACHE_MS = 10 * 60_000;
let cudaPresenceCache: { at: number; hasCuda: boolean } | null = null;

async function hasCudaCard(): Promise<boolean> {
  if (cudaPresenceCache && Date.now() - cudaPresenceCache.at < CUDA_PRESENCE_CACHE_MS) {
    return cudaPresenceCache.hasCuda;
  }
  const hw = await detectHardware();
  const hasCuda = hw.cudaDevices.length > 0;
  cudaPresenceCache = { at: Date.now(), hasCuda };
  return hasCuda;
}

// 120 samples at the 60s cadence index.ts uses = 2 hours of trend, enough
// to answer "has it been busy today" without growing unbounded in a
// long-running process.
const MAX_SAMPLES = 120;
const samples: EngineStatsSample[] = [];

async function measureCpuPercent(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "%cpu=", "-p", String(pid)], { timeout: 5_000 });
    const pct = Number(stdout.trim());
    return Number.isFinite(pct) ? pct : null;
  } catch {
    return null;
  }
}

/** Samples the currently-running engine process (if any real one is
 * running - the stub and an unconfigured/stopped state have no pid to
 * measure, and are silently skipped rather than recorded as a zero,
 * which would misleadingly read as "running at 0 load"). */
export async function sampleEngineStats(): Promise<void> {
  const status = getEngineStatus();
  if (!status.pid) return;
  const hasCuda = await hasCudaCard();
  const [memoryBytes, cpuPercent] = await Promise.all([
    measureProcessMemoryBytes(status.pid, hasCuda),
    measureCpuPercent(status.pid),
  ]);
  samples.push({ at: new Date().toISOString(), memoryBytes, cpuPercent });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function getEngineStatsSamples(): EngineStatsSample[] {
  return samples;
}

/** Test-only: the ring buffer is module state. */
export function __clearEngineStatsForTests(): void {
  samples.length = 0;
}
