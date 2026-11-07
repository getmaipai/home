// Non-generative picture helpers retained for background removal and upscaling.
import { runImageTool } from "@/lib/imaging/tools";
import { StackError } from "@/lib/stack/errors";
import { getStackClient } from "@/lib/stackEngine";

const RETRY_PAUSE_MS = 4000;
let retryPauseMs = RETRY_PAUSE_MS;
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

export interface ErasedPeople { png: Uint8Array; width: number; height: number; engine: string; model: string; ms: number; people?: Array<{ id: number; x: number; y: number; w: number; h: number; area?: number }>; subjects?: Array<{ id: number; x: number; y: number; w: number; h: number; kind: string; label?: string; area?: number }> }

export async function runPictureTool(operation: "remove_background" | "upscale" | "find_people" | "find_subjects", bytes: Uint8Array, mediaType: string, extra: Record<string, string>, signal?: AbortSignal): Promise<ErasedPeople> {
  if (operation === "find_people" || operation === "find_subjects") return runWithRetry(signal, async () => {
    const form = new FormData();
    form.append("image", new File([new Uint8Array(bytes)], "picture", { type: mediaType }));
    form.append("operation", operation);
    form.append("timeout_ms", "2500");
    const submitted = await getStackClient().imageEdit(form, { signal });
    if (submitted.kind === "done") {
      const item = submitted.item as typeof submitted.item & { people?: ErasedPeople["people"]; subjects?: ErasedPeople["subjects"] };
      const subjects = item.subjects;
      const people = item.people;
      if (operation === "find_subjects" ? !subjects : !people) throw new Error("The picture finder did not return boxes.");
      return { png: new Uint8Array(Buffer.from(item.b64_json, "base64")), width: item.width, height: item.height, engine: item.engine ?? operation, model: item.model ?? operation, ms: item.ms ?? 0, ...(people ? { people } : {}), ...(subjects ? { subjects } : {}) };
    }
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const job = await getStackClient().job(submitted.job, { signal });
      if (job.state === "failed") throw new Error(job.reason ?? "The people finder could not finish.");
      if (job.state === "cancelled") throw new Error("The people finder was cancelled.");
      if (job.state === "done") {
        const result = job.result as { people?: ErasedPeople["people"]; subjects?: ErasedPeople["subjects"]; width?: number; height?: number; engine?: string; model?: string; ms?: number } | null;
        if (operation === "find_subjects" ? !result?.subjects : !result?.people) throw new Error("The picture finder did not return boxes.");
        return { png: new Uint8Array(), width: result?.width ?? 0, height: result?.height ?? 0, engine: result?.engine ?? operation, model: result?.model ?? operation, ms: result?.ms ?? 0, ...(result?.people ? { people: result.people } : {}), ...(result?.subjects ? { subjects: result.subjects } : {}) };
      }
    }
    throw new Error("The people finder took too long. Try a smaller picture.");
  });
  return runWithRetry(signal, () => runImageTool(operation, bytes, { mediaType, extra, signal }));
}
