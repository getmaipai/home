// AUDIT-DUP-NET-01: the one HTTP helper for Home's calls to the Stack's media routes (pictures, videos, music, engine components).
// Each module makes its own with `createStackHttp` and keeps its own error class; the base URL, the timeout, the unreachable and
// no-Stack mapping, the failure-body read and the test fetch seam are written once here. (`stack/client.ts` is the separate spec client.)
import { getStackUrl } from "@/lib/stackEngine";
import { sendWithView, StackViewError, VIEW_KEY_LINE, type FullView } from "./fullView";

/** The base a test fetch is called with (no real Stack answers there). */
export const STACK_TEST_BASE = "http://127.0.0.1:1";

export interface StackHttpConfig<E extends Error> {
  /** Builds the module's own error: the HTTP status, a machine code, a plain sentence (empty when the module has none) and a job id the Stack named. */
  makeError(status: number, code: string, message: string, job?: string): E;
  /** The plain sentence when no Stack is configured (code `no_stack`). */
  noStackMessage: string;
  /** The plain sentence when the Stack does not answer (code `unreachable`). */
  unreachableMessage: string;
  /** The default per-call timeout; a call can pass its own `timeoutMs`. Default 15 s. */
  timeoutMs?: number;
}

export interface FailureOptions {
  /** The sentence when the Stack's body carries none; a function gets the HTTP status. */
  fallback: string | ((status: number) => string);
  /** Rewrites the Stack's sentence for the person, given its machine code. */
  describe?: (code: string | null, text: string) => string;
  /** Sees the final code and sentence before the error is thrown (for example to remember a refusal for the health row). */
  onFailure?: (code: string | null, message: string) => void;
}

export function createStackHttp<E extends Error>(config: StackHttpConfig<E>) {
  let fetchForTests: typeof fetch | null = null;

  function baseUrl(): string {
    if (fetchForTests) return STACK_TEST_BASE;
    const url = getStackUrl();
    if (!url) throw config.makeError(503, "no_stack", config.noStackMessage);
    return url.replace(/\/$/, "");
  }

  /** `view` (ADULT-LOCK-03) is the full-view grant of an adult job; without it the call is the plain one and carries no extra header. */
  async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}, view?: FullView): Promise<Response> {
    const doFetch = fetchForTests ?? globalThis.fetch;
    const { timeoutMs = config.timeoutMs ?? 15_000, ...rest } = init;
    const signal = rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const base = baseUrl();
    try {
      return await sendWithView(doFetch, base, path, { ...rest, signal }, view);
    } catch (error) {
      if (error instanceof StackViewError) throw config.makeError(503, error.code, VIEW_KEY_LINE);
      throw config.makeError(503, "unreachable", config.unreachableMessage);
    }
  }

  /** Throws the module's error from a non-2xx answer: the Stack's `{ error, code, job }` body when it has one. */
  async function failure(res: Response, options: FailureOptions): Promise<never> {
    let body: { error?: unknown; code?: unknown; job?: unknown } = {};
    try { body = await res.json() as typeof body; } catch { /* a body that is not JSON carries no detail */ }
    const code = typeof body.code === "string" ? body.code : null;
    const text = typeof body.error === "string" && body.error ? body.error : typeof options.fallback === "function" ? options.fallback(res.status) : options.fallback;
    const message = options.describe ? options.describe(code, text) : text;
    options.onFailure?.(code, message);
    throw config.makeError(res.status, code ?? `http_${res.status}`, message, typeof body.job === "string" ? body.job : undefined);
  }

  return {
    baseUrl,
    request,
    failure,
    /** Test seam: a function that answers the Stack's routes for this module. */
    __setFetchForTests(fn: typeof fetch | null): void { fetchForTests = fn; },
    /** True while a test fetch is set (a module that reports "Stack configured" counts it). */
    hasTestFetch(): boolean { return fetchForTests !== null; },
  };
}
