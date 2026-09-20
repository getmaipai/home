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

  constructor(kind: StackErrorKind, message: string, extra?: { status?: number; offline_reason?: string; body?: string }) {
    super(message);
    this.name = "StackError";
    this.kind = kind;
    this.status = extra?.status;
    this.offline_reason = extra?.offline_reason;
    this.body = extra?.body;
  }
}
