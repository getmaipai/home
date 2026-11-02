// MAX-WAIT-REASON-01: the plain line for a clip the Stack is holding at its start. The Stack reports the hold as the job's `phase`
// ("waiting for running jobs" while other jobs still run, "waiting for the computer" once none does); the one mapping lives here so the
// Videos card, the chat card and the Create stage say the same words. Null for any other phase.
import { jobQueueCopy } from "@/lib/jobQueueCopy";

export const STACK_WAIT_RUNNING_PHASE = "waiting for running jobs";
export const STACK_WAIT_COMPUTER_PHASE = "waiting for the computer";

export function videoWaitLine(phase: string | null | undefined, audience: "adult" | "child"): string | null {
  if (phase === STACK_WAIT_RUNNING_PHASE) return jobQueueCopy("queued", "max_drain", null, null, audience);
  if (phase === STACK_WAIT_COMPUTER_PHASE) return jobQueueCopy("waiting_memory", "max_hold", null, null, audience);
  return null;
}
