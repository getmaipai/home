// A Stack that is restarting (an update, a crash, a memory restart of the chat
// engine) refuses or drops requests for a few seconds. A chat request that
// failed that way before any word reached the person is sent again once,
// after the Stack answers /healthz, instead of ending in "Something went
// wrong while writing that" (2026-10-17, v0.2.9 installing).
import { StackError } from "@/lib/stack/errors";
import { getStackClient } from "@/lib/stackEngine";

export const STACK_BACK_MAX_MS = 60_000;

/** Whether an error says the Stack was going down or coming up, not that the request was wrong. */
export function isStackRestart(error: unknown): boolean {
  // A body that ended early because the socket closed under it (not a StackError: the reader threw).
  if (!(error instanceof StackError)) return error instanceof Error && /terminated|ECONNRESET|socket|connection (closed|was closed)|fetch failed|network/i.test(error.message);
  if (error.kind === "unreachable") return true;
  if (error.kind === "timeout" && /stopped answering/.test(error.message)) return true;
  return error.status === 503 && /stack_restarting|restarting/i.test(`${error.body ?? ""} ${error.message}`);
}

/** Waits until the Stack answers /healthz again; false when it did not within the limit or the caller stopped. */
export async function waitForStackBack(signal?: AbortSignal, maxMs = STACK_BACK_MAX_MS, pollMs = 1_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    try { const health = await getStackClient().healthz({ signal }); if (health.ok) return true; } catch { /* still down */ }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}
