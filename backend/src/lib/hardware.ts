// Real hardware detection for the model-selection wizard and the chat
// engine's auto-tuning (platform plan 4.11's deferred "which GGUF, which
// hardware" decision, see spec/llm/README.md). Ported from the archived
// legacy hub's lib/hwfit.ts (hard-won logic, kept per the org's "copy
// resolvers/drivers/measurements, never feature scope" rule), adapted to
// this repo's Bun idioms and narrowed to what modelCatalog.ts actually
// needs: no ComfyUI-vs-Ollama placement policy exists yet since no image/
// video backend does either (llm.ts's IMPLEMENTED_ROLES has only "chat").
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

export interface CudaDevice {
  index: number;
  name: string;
  vramBytes: number;
  usedVramBytes?: number;
  utilizationPct?: number;
}

export interface HardwareInfo {
  platform: NodeJS.Platform;
  /** engineCatalog.ts's other half of a binary pin match, alongside
   * `platform`; kept here rather than re-read via node:os a second time
   * so every platform-matching decision trusts the one real detection. */
  arch: string;
  totalRamGb: number;
  cpuCount: number;
  isAppleSilicon: boolean;
  /** Only meaningful when isAppleSilicon: unified memory available to a model,
   * approximated as total RAM (no separate VRAM concept on Metal). */
  unifiedMemoryGb: number;
  cudaDevices: CudaDevice[];
}

// Spawned async, never sync: a blocking spawnSync intermittently stalls the
// event loop on a loaded backend process (the same reason the legacy code
// avoided it), and this can be called from a request handler.
export async function detectCudaDevices(): Promise<CudaDevice[]> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=index,name,memory.total,memory.used,utilization.gpu", "--format=csv,noheader,nounits"],
      { timeout: 8_000 },
    );
    return stdout
      .trim()
      .split("\n")
      .flatMap((line): CudaDevice[] => {
        const parts = line.split(",").map((p) => p.trim());
        if (parts.length < 3) return [];
        const index = parseInt(parts[0] ?? "", 10);
        const name = parts[1] ?? "";
        const vramMiB = parseInt(parts[2] ?? "", 10);
        if (Number.isNaN(index) || Number.isNaN(vramMiB)) return [];
        const usedMiB = parseInt(parts[3] ?? "", 10);
        const utilPct = parseInt(parts[4] ?? "", 10);
        return [
          {
            index,
            name,
            vramBytes: vramMiB * 1_048_576,
            usedVramBytes: Number.isNaN(usedMiB) ? undefined : usedMiB * 1_048_576,
            utilizationPct: Number.isNaN(utilPct) ? undefined : utilPct,
          },
        ];
      });
  } catch {
    // No nvidia-smi on PATH (no NVIDIA driver, or a non-NVIDIA box): not an
    // error, just zero CUDA devices. Apple Silicon and CPU-only boxes both
    // take this path.
    return [];
  }
}

function detectIsAppleSilicon(): boolean {
  return process.platform === "darwin" && (os.cpus()[0]?.model ?? "").includes("Apple");
}

// A short TTL, not a permanent cache: hardware.ts's own live free-VRAM
// figures should stay reasonably fresh (a card's usage changes as other
// things run), but ModelsSection.tsx's one page load fires four requests
// (hardware, chat/image/video models) that would otherwise each spawn
// their own nvidia-smi process for identical data within the same second.
const DETECTION_CACHE_MS = 5_000;
let cached: { at: number; info: HardwareInfo } | null = null;

export async function detectHardware(): Promise<HardwareInfo> {
  if (cached && Date.now() - cached.at < DETECTION_CACHE_MS) return cached.info;
  const totalRamGb = Math.round(os.totalmem() / 1_073_741_824);
  const isAppleSilicon = detectIsAppleSilicon();
  const cudaDevices = isAppleSilicon ? [] : await detectCudaDevices();
  const info: HardwareInfo = {
    platform: process.platform,
    arch: process.arch,
    totalRamGb,
    cpuCount: os.cpus().length,
    isAppleSilicon,
    // No distinct "free VRAM" concept on Metal (unified memory is shared with
    // the OS): use total RAM as the ceiling, same simplification the legacy
    // code made for Apple Silicon's autotune path.
    unifiedMemoryGb: isAppleSilicon ? totalRamGb : 0,
    cudaDevices,
  };
  cached = { at: Date.now(), info };
  return info;
}

/** Test-only: detectHardware() caches between calls. */
export function __resetHardwareCacheForTests(): void {
  cached = null;
}

/** Bytes available to a model on this box for the given role's workload:
 * the biggest single card's FREE VRAM on CUDA (total minus whatever
 * nvidia-smi reports already in use by another process, so a card
 * already loaded with something else isn't recommended as if it were
 * empty), unified memory on Apple Silicon, or 0 (CPU-only, no automatic
 * recommendation possible) otherwise. Multi-card placement (which
 * workload gets which card) is modelCatalog.ts's job once a second real
 * backend (image/video) exists to place; today there is exactly one
 * implemented role (chat), so there is nothing to place between cards
 * yet. */
export function primaryBudgetBytes(hw: HardwareInfo): number {
  if (hw.isAppleSilicon) return hw.unifiedMemoryGb * 1_073_741_824;
  if (hw.cudaDevices.length === 0) return 0;
  return hw.cudaDevices.reduce(
    (max, d) => Math.max(max, d.vramBytes - (d.usedVramBytes ?? 0)),
    0,
  );
}
