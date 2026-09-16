/** The assistant-ui reload action creates the new sibling branch, but it
 * does not carry the stopped message's partial text into the adapter. This
 * single-shot handoff keeps that context beside chatEditSupersedes.ts's
 * edit handoff until the next run consumes it. */
export interface PendingContinuation {
  assistantText: string;
  fromTurnId?: string;
}

let pendingContinuation: PendingContinuation | null = null;

export function setPendingContinuation(value: PendingContinuation | null): void {
  pendingContinuation = value;
}

export function consumeContinuation(): PendingContinuation | undefined {
  const value = pendingContinuation;
  pendingContinuation = null;
  return value ?? undefined;
}

