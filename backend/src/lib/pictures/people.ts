// Non-generative picture helpers retained for background removal and upscaling.
import { runImageTool } from "@/lib/imaging/tools";
import { StackError } from "@/lib/stack/errors";

const RETRY_PAUSE_MS = 4000;
let retryPauseMs = RETRY_PAUSE_MS;
export function __setPeopleRetryPauseForTests(ms: number): void { retryPauseMs = Math.max(0, ms); }

async function runWithRetry<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (attempt > 0 || signal?.aborted || !(error instanceof StackError && [408, 409, 423, 429, 502, 503, 504].includes(error.status ?? 0))) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryPauseMs));
      if (signal?.aborted) throw error;
    }
  }
}

export interface ErasedPeople { png: Uint8Array; width: number; height: number; engine: string; model: string; ms: number }

export async function runPictureTool(operation: "remove_background" | "upscale", bytes: Uint8Array, mediaType: string, extra: Record<string, string>, signal?: AbortSignal): Promise<ErasedPeople> {
  return runWithRetry(signal, () => runImageTool(operation, bytes, { mediaType, extra, signal }));
}
