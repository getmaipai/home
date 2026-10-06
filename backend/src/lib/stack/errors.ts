// The Stack's failure kinds, mapped one-to-one from what the Stack
// itself states. A cause the Stack did not state is never guessed.

export type StackErrorKind =
  | "offline" // 503: the role is down; carries offline_reason
  | "unverified" // 409: the model is not verified
  | "unknown" // 400: the request was bad
  | "cancelled" // 499: the job was cancelled
  | "timeout" // 504: the Stack stopped answering
  | "unreachable" // the socket refused: the Stack is not running
  | "unexpected"; // anything else: carries status and body text

export class StackError extends Error {
  kind: StackErrorKind;
  status?: number;
  offline_reason?: string;
  body?: string;
  /** CHAT-CALM-ERRORS-01b: the role's state as the failure body stated it
   * (the Stack's router: notInstalled, installed, loaded, ready, offline). */
  state?: string;
  /** The `x-maipai-engine` and `x-maipai-model` headers of the failed reply, when it carried any. */
  engine?: string;
  model?: string;

  constructor(kind: StackErrorKind, message: string, extra?: { status?: number; offline_reason?: string; body?: string; state?: string; engine?: string; model?: string }) {
    super(message);
    this.name = "StackError";
    this.kind = kind;
    this.status = extra?.status;
    this.offline_reason = extra?.offline_reason;
    this.body = extra?.body;
    this.state = extra?.state;
    this.engine = extra?.engine;
    this.model = extra?.model;
  }
}
