/**
 * Max chat runs its own quick test. When the only missing step is the coding self-test (it goes stale when the Stack changes),
 * the person who turned Max on should not have to find a button: Home runs the test during the "Switching to Max" wait.
 * One test runs at a time; later callers wait on the same one.
 */
import { codingModeReadiness } from "@/lib/codingMode";
import { getStackClient } from "@/lib/stackEngine";
import { selfTestAborted, selfTestFinished, selfTestStarted } from "@/lib/chatTransitions";

export interface MaxSelfTestDeps {
  firstUnmet: () => Promise<string | null>;
  start: () => Promise<void>;
  pollMs: number;
  maxWaitMs: number;
}

const realDeps: MaxSelfTestDeps = {
  firstUnmet: async () => (await codingModeReadiness().catch(() => null))?.first_unmet ?? null,
  start: async () => { selfTestStarted(); await getStackClient().runCodingModeSelfTest(); },
  pollMs: 2000,
  maxWaitMs: 180_000,
};

let inFlight: Promise<boolean> | null = null;

/** True when the self-test was the missing step and it now passed; false when it was something else or did not finish. */
export function ensureSelfTest(deps: MaxSelfTestDeps = realDeps): Promise<boolean> {
  if (inFlight) return inFlight;
  const run = (async () => {
    if ((await deps.firstUnmet()) !== "self_test") return false;
    try { await deps.start(); } catch { selfTestAborted(); return false; }
    for (let waited = 0; waited < deps.maxWaitMs; waited += deps.pollMs) {
      await new Promise((resolve) => setTimeout(resolve, deps.pollMs));
      const unmet = await deps.firstUnmet();
      if (unmet !== "self_test") { selfTestFinished(); return true; }
    }
    selfTestAborted();
    return false;
  })().finally(() => { inFlight = null; });
  inFlight = run;
  return run;
}
