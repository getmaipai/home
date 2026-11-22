// CODE-FIX-01: the one map from a Code turn's failure reason code to a plain sentence with the next step, in the same style as lib/jobQueueCopy.ts.
// Rule 6a: the code is all that is stored or logged (never the error text); the sentence is made here, from the code, when a session is sent to the app.
// A person never sees a code. An unknown code reads as the generic line.

/** The reason codes a failed turn keeps (`CodingTurnError.reason`, `SandboxClientError.reason`, `restarted` from a restart) and the sentence each one reads as. */
export const CODING_FAILURE_COPY = {
  feature_missing: "The coding engine is too old for this. Ask an admin to update it in Settings, then tap Retry.",
  lock_not_ready: "The sandbox is not ready yet. Wait a minute, then tap Retry.",
  unavailable: "Home could not reach the AI engine. Check that it is running, then tap Retry.",
  gateway_unreachable: "The coding gateway is not ready. Wait a minute, then tap Retry. If it keeps happening, ask an admin to check Settings, Coding.",
  gateway_port_in_use: "Another program is using the port the coding gateway needs. Ask an admin to close it or change the gateway port in Settings, Coding, then tap Retry.",
  agent_exit: "The coding agent quit unexpectedly. Tap Retry.",
  bad_request: "The sandbox refused that step. Tap Retry, and if it fails again ask an admin to check Settings, Coding.",
  failed: "The sandbox could not finish that step. Tap Retry, and if it fails again ask an admin to check Settings, Coding.",
  restarted: "Home restarted while this was stopped. Nothing is running. Tap Retry to run your last message again.",
} as const;

export type CodingFailureCode = keyof typeof CODING_FAILURE_COPY;

const GENERIC = "The agent stopped because of a problem on this computer. Tap Retry, or ask an admin to check Settings, Coding.";

/** The plain sentence, with its next step, for a stored reason code. Any other code reads as the generic line. */
export function codingFailureLine(code: string | undefined | null): string {
  return code && Object.prototype.hasOwnProperty.call(CODING_FAILURE_COPY, code) ? CODING_FAILURE_COPY[code as CodingFailureCode] : GENERIC;
}
