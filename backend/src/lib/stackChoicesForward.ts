// STACK-MODELS-HOME-01 (owner decision, 2026-11-21): the Stack holds every model choice; Home is a view into it and one way to change it.
// This is Home's one call into the Stack's choices routes. It forwards a call unchanged and stores nothing: the shapes are the Stack's own
// (`@maipai/spec` stack-choices), the refusal sentences are the Stack's own, and who may ask is decided by the route before it gets here.
// A test replaces `fetch` with `__setChoicesFetchForTests`.
import { createStackHttp } from "@/lib/stack/http";

export class StackChoicesError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "StackChoicesError"; }
}

const stack = createStackHttp({
  makeError: (status, code, message) => new StackChoicesError(status, code, message),
  noStackMessage: "The engine isn't set up on this computer yet. Ask an admin to check Settings, Engine.",
  unreachableMessage: "The engine isn't answering. Check that the engine is running, then try again.",
  timeoutMs: 60_000,
});
export const __setChoicesFetchForTests = stack.__setFetchForTests;

export interface Forwarded { status: number; body: unknown }

/** One call to the Stack with a JSON body (or none), answered as the Stack answered it. A refusal throws `StackChoicesError` with the Stack's sentence and code. */
export async function forwardToStack(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<Forwarded> {
  const init: RequestInit = { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) };
  const res = await stack.request(path, init);
  if (!res.ok) return stack.failure(res, { fallback: (status) => `The engine answered ${status}. Try again in a moment.` });
  let parsed: unknown = {};
  try { parsed = await res.json(); } catch { /* an answer with no body is an empty object */ }
  return { status: res.status, body: parsed };
}

/** The status a refusal is passed on with: the Stack's 4xx as it is, anything else (an unreachable or failing engine) as 503. */
export function refusalStatus(error: StackChoicesError): 400 | 401 | 403 | 404 | 409 | 422 | 503 {
  return ([400, 401, 403, 404, 409, 422] as const).find((status) => status === error.status) ?? 503;
}
