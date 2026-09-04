// Pinned llama-server engine binaries (platform plan 4.11's other real
// gap besides the GGUF itself: "no llama-server binary is fetched for any
// platform"). Same "download, don't vendor" rule as third-party models
// (org CLAUDE.md > Third-party code and assets): a pinned version, a
// pinned URL, a checksum this repo recorded itself (upstream ggml-org/
// llama.cpp publishes no checksums of its own; these were computed by
// downloading each asset once and hashing it, the same trust model
// git-lfs/HF's own oid pinning uses), never a binary tracked in git.
//
// One build (b10797, 2026-09-04) pinned across every platform entry so a
// household's engine and every catalog model's sizing assumptions
// (context, flash-attn/KV-cache flag names below) come from one known-
// good llama-server, not whatever happened to be newest per platform.
import type { HardwareInfo } from "@/lib/hardware";

export interface EngineArchive {
  label: string;
  url: string;
  sha256: string;
  approxBytes: number;
}

export interface EngineBinaryPin {
  id: string;
  /** Node's os.platform()/os.arch() values, what hardware.ts's own
   * detection reports, so matching needs no translation table. */
  platform: "darwin" | "win32";
  arch: "arm64" | "x64";
  requiresNvidia: boolean;
  label: string;
  /** The main archive. Extracted first. */
  archive: EngineArchive;
  /** Extra archives extracted into the same directory afterward (the
   * Windows CUDA build ships its CUDA runtime DLLs as a second,
   * much-larger, separate asset rather than bundling them). */
  extraArchives?: EngineArchive[];
  /** Verified end to end this session (extracted, `--version` ran, spawned
   * a real chat completion): see docs/dev.md's 2026-09-04 entry. False
   * means the pin is real (downloaded and hashed for real) but nothing in
   * this repo has ever run it - true today only for macOS arm64, since
   * that's the only real hardware this session had access to. */
  verified: boolean;
}

export const ENGINE_BINARIES: EngineBinaryPin[] = [
  {
    id: "llama-server-b10797-macos-arm64",
    platform: "darwin",
    arch: "arm64",
    requiresNvidia: false,
    label: "llama-server (macOS, Apple Silicon, Metal), build b10797",
    archive: {
      label: "llama-server (macOS arm64)",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b10797/llama-b10797-bin-macos-arm64.tar.gz",
      sha256: "474a788ec73d17a066360b1c50c9733c78a47d062616e91963c65a344548e889",
      approxBytes: 11_108_860,
    },
    verified: true,
  },
  {
    id: "llama-server-b10797-win-cuda-x64",
    platform: "win32",
    arch: "x64",
    requiresNvidia: true,
    label: "llama-server (Windows, NVIDIA CUDA 12.4, x64), build b10797",
    archive: {
      label: "llama-server (Windows CUDA x64)",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b10797/llama-b10797-bin-win-cuda-12.4-x64.zip",
      sha256: "98d9195ea691f284c1eb8723e28e9ea0efc0adcacc7f082d5f8732491766b8c9",
      approxBytes: 253_916_914,
    },
    // The CUDA build's GPU DLL (ggml-cuda.dll) links the CUDA runtime,
    // which llama.cpp ships as this separate asset rather than bundling -
    // both must extract into the same directory or llama-server.exe fails
    // to load ggml-cuda.dll at startup.
    extraArchives: [
      {
        label: "CUDA 12.4 runtime (cudart)",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10797/cudart-llama-bin-win-cuda-12.4-x64.zip",
        sha256: "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
        approxBytes: 391_443_627,
      },
    ],
    // Real pin (downloaded and hashed for real, both archives), but never
    // run: no Windows/CUDA box exists in this session to prove it against
    // (Jesse's MSI laptop, spec/llm/README.md's other named machine). The
    // household select flow refuses to spawn an unverified pin without an
    // explicit acknowledgment - see modelDownloadJobs.ts.
    verified: false,
  },
];

/** The one binary that matches this box, or null when nothing does
 * (Linux, or a non-NVIDIA Windows card: both real, named gaps, not
 * guessed at - the household sees "no engine build for this computer
 * yet" rather than a silently wrong download). */
/** Written by modelDownloadJobs.ts inside an engine's install directory
 * only once every archive (the main build plus any extraArchives, e.g.
 * the Windows CUDA build's separate cudart runtime package) has
 * downloaded and extracted successfully. Exported so llmSupervisor.ts's
 * spawn-readiness check and modelDownloadJobs.ts's own install-skip
 * check both gate on the identical marker (a code review, 2026-09-04,
 * found llmSupervisor.ts checking only `existsSync(binPath)` - true as
 * soon as the main archive extracts, before any extras - so a crash
 * between those two steps let it spawn a binary missing required runtime
 * DLLs instead of reporting "hasn't finished downloading yet"). */
export const ENGINE_READY_MARKER = ".engine-ready";

export function selectEngineBinary(hw: HardwareInfo): EngineBinaryPin | null {
  return (
    ENGINE_BINARIES.find(
      (b) =>
        b.platform === hw.platform &&
        b.arch === hw.arch &&
        (!b.requiresNvidia || (hw.cudaDevices?.length ?? 0) > 0),
    ) ?? null
  );
}
