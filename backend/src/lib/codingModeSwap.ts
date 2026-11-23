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

const maxReasks = 2;

function codingAndStable(mode: Pick<StackCodingMode, "mode" | "state">): boolean {
  return mode.mode === "coding" && mode.state === "stable";
}

function settledOutOfCoding(mode: Pick<StackCodingMode, "mode" | "state">): boolean {
  return mode.mode !== "coding" && (mode.state === "stable" || mode.state === "waiting");
}

/** Ask the Stack for coding mode. A refusal ("already") means a switch is running and is safe to wait for. */
async function askForCoding(client: CodingModeSwapClient): Promise<void> {
  try {
    await client.setCodingMode("coding");
  } catch (error) {
    // The Stack refuses a second change while one is running (409 "already"). That switch is exactly what we are waiting for.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("already")) throw error;
  }
}

/** Post the switch to coding mode and wait until the Stack says it is there, failed, or ran out of time. */
export async function swapToCodingMode(client: CodingModeSwapClient, deps: CodingModeSwapDeps = defaultDeps): Promise<void> {
  // Already in coding mode: nothing to post, nothing to wait for.
  if (codingAndStable(await client.getCodingMode())) return;
  await askForCoding(client);
  const startedAt = deps.now();
  let reasks = 0;
  for (;;) {
    const mode = await client.getCodingMode();
    if (codingAndStable(mode)) return;
    if (mode.state === "failed") throw new Error(mode.reason ?? "The Stack could not switch to coding mode.");
    if (settledOutOfCoding(mode)) {
      // A switch that was running ended the other way: normal/stable while we want coding. Ask again, a couple of times.
      if (reasks < maxReasks) {
        reasks += 1;
        await askForCoding(client);
        await deps.wait(deps.pollMs);
        continue;
      }
      throw new Error("The Stack stayed in normal mode after Home asked for coding mode. Try again in a minute.");
    }
    if (deps.now() - startedAt >= deps.timeoutMs) {
      throw new Error("The Stack did not finish switching to coding mode in time. Try the request again in a few minutes.");
    }
    await deps.wait(deps.pollMs);
  }
}
