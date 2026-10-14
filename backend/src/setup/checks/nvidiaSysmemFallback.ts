export type SetupCheckResult = {
  status: "green" | "amber" | "idle";
  message?: string;
  fix?: string;
};

/** System observations belong to the caller so this policy check stays pure
 * and can be exercised with deterministic fixtures. */
export interface NvidiaSysmemFallbackReader {
  hasNvidiaGpu(): Promise<boolean>;
  isSysmemFallbackEnabled(): Promise<boolean>;
}

export const NVIDIA_SYSMEM_FALLBACK_AMBER_COPY =
  "Your graphics driver may slow chat down by borrowing system memory. Open NVIDIA Control Panel, Manage 3D settings, and set CUDA Sysmem Fallback Policy to Prefer No Sysmem Fallback.";

/** Reports only a confirmed NVIDIA fallback-policy state. A failed or
 * unavailable system read leaves this optional setup row idle and never
 * makes setup fail. */
export async function checkNvidiaSysmemFallback(
  reader: NvidiaSysmemFallbackReader,
): Promise<SetupCheckResult> {
  try {
    if (!(await reader.hasNvidiaGpu())) return { status: "idle" };
    if (await reader.isSysmemFallbackEnabled()) {
      return { status: "amber", message: NVIDIA_SYSMEM_FALLBACK_AMBER_COPY };
    }
    return { status: "green" };
  } catch {
    return { status: "idle" };
  }
}
