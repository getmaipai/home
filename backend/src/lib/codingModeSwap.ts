// A Max lease upgrade is the Stack's coding-mode transaction: setCodingMode answers 202 at once and the engine
// loads the big model in the background for minutes. Home must not send coding requests until the Stack reports
// coding/stable, or the engine answers 503 engine_unavailable. This helper posts the switch and polls until done.
import type { StackCodingMode } from "@/lib/stack/types";

/** The coding-mode surface of the Stack client, kept narrow so callers and tests can pass a stand-in. */
export interface CodingModeSwapClient {
  setCodingMode(mode: "normal" | "coding"): Promise<unknown>;
  getCodingMode(): Promise<Pick<StackCodingMode, "mode" | "state" | "reason">>;
}

export interface CodingModeSwapDeps {
  now: () => number;
  wait: (ms: number) => Promise<void>;
  pollMs: number;
  timeoutMs: number;
}

const defaultDeps: CodingModeSwapDeps = {
  now: Date.now,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs: 3_000,
  timeoutMs: 600_000,
};

function codingAndStable(mode: Pick<StackCodingMode, "mode" | "state">): boolean {
  return mode.mode === "coding" && mode.state === "stable";
}

/** Post the switch to coding mode and wait until the Stack says it is there, failed, or ran out of time. */
export async function swapToCodingMode(client: CodingModeSwapClient, deps: CodingModeSwapDeps = defaultDeps): Promise<void> {
  // Already in coding mode: nothing to post, nothing to wait for.
  if (codingAndStable(await client.getCodingMode())) return;
  try {
    await client.setCodingMode("coding");
  } catch (error) {
    // The Stack refuses a second change while one is running (409 "already"). That switch is exactly what we are waiting for.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("already")) throw error;
  }
  const startedAt = deps.now();
  for (;;) {
    const mode = await client.getCodingMode();
    if (codingAndStable(mode)) return;
    if (mode.state === "failed") throw new Error(mode.reason ?? "The Stack could not switch to coding mode.");
    if (deps.now() - startedAt >= deps.timeoutMs) {
      throw new Error("The Stack did not finish switching to coding mode in time. Try the request again in a few minutes.");
    }
    await deps.wait(deps.pollMs);
  }
}
