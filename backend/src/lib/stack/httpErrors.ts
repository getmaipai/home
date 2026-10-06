import { z } from "@hono/zod-openapi";
import { errorResponses } from "@/lib/openapi";
import { StackError } from "@/lib/stack/errors";

export const StackFailureSchema = z.object({ error: z.string(), reason: z.string().optional() });

export type StackFailure =
  | { status: 400; body: { error: string } }
  | { status: 409; body: { error: string } }
  | { status: 503; body: { error: string; reason?: string } }
  | { status: 504; body: { error: string } };

/** Every StackError kind, mapped to the status and body the Stack's own
 * failure shape carries. Offline and unreachable both mean the Stack did
 * not answer; an offline reason is included only when the Stack stated it. */
export function classifyStackError(err: unknown): StackFailure {
  if (err instanceof StackError) {
    switch (err.kind) {
      case "offline":
      case "unreachable":
        return { status: 503, body: { error: err.message, reason: err.offline_reason } };
      case "unverified":
        return { status: 409, body: { error: err.message } };
      case "unknown":
        return { status: 400, body: { error: err.message } };
      case "timeout":
        return { status: 504, body: { error: err.message } };
      default:
        return { status: 503, body: { error: err.message } };
    }
  }
  return { status: 503, body: { error: err instanceof Error ? err.message : String(err) } };
}

export const STACK_ERROR_RESPONSES = {
  ...errorResponses({ 400: "The request was bad", 409: "The Stack rejected an unverified setting", 504: "The Stack stopped answering" }),
  503: { content: { "application/json": { schema: StackFailureSchema } }, description: "The Stack is offline or unreachable." },
};
