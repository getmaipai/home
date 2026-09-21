// Home speaks to the Stack by role: one client per Stack, loopback
// only, every call bounded, every failure mapped to the kind the Stack
// stated, and the engine identity read from the reply's headers instead
// of probing a process.

import { withTimeout } from "@maipai/core/src/withTimeout";
import { hostLabel, type EngineIdentity } from "../engineIdentity";
import { StackError, type StackErrorKind } from "./errors";
import type {
  RoleRequest,
  RoleReplyHeaders,
  StackJob,
  HealthItem,
  StackSetting,
  RolesListResponse,
  EnginesListResponse,
  BudgetResponse,
  FailureBody,
  StackUpdatesState,
  StackEngineApplyResult,
  StackEngineRollbackResult,
  StackStorageSweepResult,
  StackCheckRun,
} from "./types";

const DEFAULT_BASE_URL = "http://127.0.0.1:8770";
const DEFAULT_TIMEOUT_MS = 30_000;

const KIND_BY_STATUS: Record<number, StackErrorKind> = {
  400: "unknown",
  409: "unverified",
  499: "cancelled",
  503: "offline",
  504: "timeout",
};

export interface StackClient {
  /** POST /v1/chat/completions. For `stream: true` the Response body reader
   * and its headers come back, not parsed data. */
  chat(request: RoleRequest, opts?: { signal?: AbortSignal }): Promise<
    | { data: Record<string, unknown>; identity: EngineIdentity }
    | { stream: ReadableStream<Uint8Array>; headers: Headers }
  >;
  embeddings(request: RoleRequest, opts?: { signal?: AbortSignal }): Promise<{ data: Record<string, unknown>; identity: EngineIdentity }>;
  transcribe(form: FormData, opts?: { signal?: AbortSignal }): Promise<{ data: { text: string }; identity: EngineIdentity }>;
  /** POST /v1/audio/speech; returns the streamed WAV Response. */
  speak(form: FormData, opts?: { signal?: AbortSignal }): Promise<Response>;
  /** POST /v1/images/generations; returns the job. */
  imageJob(request: RoleRequest, opts?: { signal?: AbortSignal }): Promise<StackJob>;
  job(id: string, opts?: { signal?: AbortSignal }): Promise<StackJob>;
  cancelJob(id: string, opts?: { signal?: AbortSignal }): Promise<StackJob>;
  roles(opts?: { signal?: AbortSignal }): Promise<RolesListResponse>;
  engines(opts?: { signal?: AbortSignal }): Promise<EnginesListResponse>;
  engineAction(
    name: string,
    action: "start" | "stop" | "restart" | "install",
    opts?: { signal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
  models(opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  modelAction(id: string, action: string, opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  health(opts?: { signal?: AbortSignal }): Promise<{ health: HealthItem[] }>;
  healthFix(code: string, opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  settings(opts?: { signal?: AbortSignal }): Promise<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>;
  applySettings(values: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>;
  budget(opts?: { signal?: AbortSignal }): Promise<BudgetResponse>;
  hardware(opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  updates(opts?: { signal?: AbortSignal }): Promise<StackUpdatesState>;
  checkUpdates(opts?: { signal?: AbortSignal }): Promise<StackUpdatesState>;
  /** POST /stack/v1/updates/engines/{name}/apply - stage, drain, swap and check. */
  applyEngineUpdate(name: string, opts?: { signal?: AbortSignal }): Promise<StackEngineApplyResult>;
  /** POST /stack/v1/updates/engines/{name}/rollback - go back to an installed build. */
  rollbackEngine(name: string, tag: string, opts?: { signal?: AbortSignal }): Promise<StackEngineRollbackResult>;
  /** POST /stack/v1/storage/sweep - prune orphaned blobs past their grace period. */
  sweepStorage(opts?: { signal?: AbortSignal }): Promise<StackStorageSweepResult>;
  /** POST /stack/v1/check - the readiness check, run now. */
  runCheck(opts?: { signal?: AbortSignal }): Promise<StackCheckRun>;
  healthz(opts?: { signal?: AbortSignal }): Promise<{ ok: boolean; version: string; uptimeSeconds: number }>;
}

export interface StackClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** The header names are in role-reply-headers.schema.json; used exactly.
 * `none` means no engine answered, per that schema. Exported for
 * llm.ts's Stack-routed streaming path (startCompleteStream()), which
 * reads a raw `{ stream, headers }` reply itself rather than going
 * through this file's own chat()/embeddings() JSON helpers. */
export function identityFromHeaders(headers: Headers): EngineIdentity {
  const get = (name: string): string | null => {
    const value = headers.get(name);
    return value && value !== "none" ? value : null;
  };
  const engine = get("x-maipai-engine");
  const [host, build] = engine ? splitEngineHeader(engine) : ["local", null];
  return {
    host: host as "local" | "external" | "stub",
    build,
    model: get("x-maipai-model"),
    healthy: null,
  };
}

// `x-maipai-engine` is "the engine host and build that answered
// (`local b10797`)", so host and build arrive as one string.
function splitEngineHeader(value: string): ["local" | "external", string | null] {
  const space = value.indexOf(" ");
  const host = space === -1 ? value : value.slice(0, space);
  const build = space === -1 ? null : value.slice(space + 1);
  const parsedHost: "local" | "external" = host === "external" ? "external" : "local";
  return [parsedHost, build];
}

function isLoopback(url: string): boolean {
  try {
    return hostLabel(url) === "local";
  } catch {
    return false;
  }
}

export function createStackClient(options: StackClientOptions = {}): StackClient {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch ?? globalThis.fetch;

  if (!isLoopback(baseUrl)) {
    throw new StackError("unexpected", `Stack baseUrl ${baseUrl} is not loopback; the Stack speaks only on this machine`);
  }
  const base = baseUrl.replace(/\/$/, "");

  function timeoutError(): Error {
    return new StackError("timeout", "the Stack stopped answering before it finished");
  }

  function wrapFetch(promise: Promise<Response>): Promise<Response> {
    return withTimeout(promise, timeoutMs, timeoutError);
  }

  function wrapError(err: unknown): never {
    if (err instanceof StackError) throw err;
    const any = err as { name?: string; message?: string; code?: string | number };
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new StackError("timeout", "the request was aborted");
    }
    const msg = any?.message ?? String(err);
    const code = any?.code;
    if (code === "ECONNREFUSED" || code === "ConnectionRefused" || code === -1 || msg.includes("fetch failed") || msg.includes("socket hang up") || msg.includes("connection refused") || msg.includes("Unable to connect") || msg.includes("ECONNREFUSED")) {
      throw new StackError("unreachable", "the Stack is not running: the socket refused");
    }
    throw new StackError("unexpected", `request to the Stack failed: ${msg}`, { body: msg });
  }

  async function fail(res: Response): Promise<never> {
    let body: unknown;
    let text: string;
    try {
      text = await res.text();
    } catch {
      text = "";
    }
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    const kind = KIND_BY_STATUS[res.status] ?? "unexpected";
    const fb = isFailureBody(body) ? body : undefined;
    const message = fb?.error ?? (res.statusText || `the Stack answered ${res.status}`);
    if (kind === "offline") {
      throw new StackError("offline", message, { status: res.status, offline_reason: fb?.offline_reason, body: text });
    }
    throw new StackError(kind, message, { status: res.status, body: text });
  }

  function isFailureBody(value: unknown): value is FailureBody {
    return typeof value === "object" && value !== null && typeof (value as FailureBody).error === "string";
  }

  function json<T>(res: Response): Promise<T> {
    return res.json() as Promise<T>;
  }

  async function rawJson<T>(res: Response): Promise<{ data: T; identity: EngineIdentity }> {
    const data = (await res.json()) as unknown as T;
    return { data, identity: identityFromHeaders(res.headers) };
  }

  async function call<T>(
    path: string,
    init: RequestInit,
    parse: (res: Response) => T | Promise<T>,
    opts?: { signal?: AbortSignal },
  ): Promise<T> {
    let res: Response;
    try {
      res = await wrapFetch(doFetch(base + path, { ...init, signal: opts?.signal }));
    } catch (err) {
      wrapError(err);
    }
    if (res.ok) return await parse(res);
    return fail(res);
  }

  function jsonInit(body: unknown): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  }

  function formInit(form: FormData): RequestInit {
    return { method: "POST", body: form };
  }

  return {
    async chat(request, opts) {
      const stream = request.stream === true;
      if (stream) {
        let res: Response;
        try {
          res = await wrapFetch(doFetch(base + "/v1/chat/completions", { ...jsonInit(request), signal: opts?.signal }));
        } catch (err) {
          wrapError(err);
        }
        if (!res.ok) {
          await fail(res);
          throw new Error("unreachable");
        }
        return { stream: res.body!, headers: res.headers };
      }
      return call("/v1/chat/completions", jsonInit(request), rawJson<Record<string, unknown>>, opts);
    },
    embeddings: (request, opts) => call("/v1/embeddings", jsonInit(request), rawJson<Record<string, unknown>>, opts),
    transcribe: (form, opts) => call("/v1/audio/transcriptions", formInit(form), rawJson<{ text: string }>, opts),
    async speak(form, opts) {
      let res: Response;
      try {
          res = await wrapFetch(doFetch(base + "/v1/audio/speech", { ...formInit(form), signal: opts?.signal }));
      } catch (err) {
        wrapError(err);
      }
      if (res.ok) return res;
      await fail(res);
      throw new Error("unreachable");
    },
    async imageJob(request, opts) {
      let res: Response;
      try {
          res = await wrapFetch(doFetch(base + "/v1/images/generations", { ...jsonInit(request), signal: opts?.signal }));
      } catch (err) {
        wrapError(err);
      }
      if (res.status === 202) {
        const body = await res.json() as { created: number; job: string; data: unknown[] };
        return {
          id: body.job,
          kind: "image",
          role: "image",
          state: "queued",
          percent: 0,
          completedBytes: 0,
          totalBytes: 0,
          status: "queued",
          position: null,
          input: request,
          result: null,
          reason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } satisfies StackJob;
      }
      if (res.ok) {
        const body = await res.json() as { created: number; job: string; data: unknown[] };
        return {
          id: body.job,
          kind: "image",
          role: "image",
          state: "done",
          percent: 100,
          completedBytes: 0,
          totalBytes: 0,
          status: "done",
          position: null,
          input: request,
          result: { images: body.data.map((d) => ({ b64_json: (d as { b64_json?: string }).b64_json ?? "" })) },
          reason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } satisfies StackJob;
      }
      await fail(res);
      throw new Error("unreachable");
    },
    job: (id, opts) => call(`/stack/v1/jobs/${encodeURIComponent(id)}`, { method: "GET" }, (res) => json<{ job: StackJob }>(res).then((b) => b.job), opts),
    cancelJob: (id, opts) => call(`/stack/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }, (res) => json<{ job: StackJob }>(res).then((b) => b.job), opts),
    roles: (opts) => call("/stack/v1/roles", { method: "GET" }, json<RolesListResponse>, opts),
    engines: (opts) => call("/stack/v1/engines", { method: "GET" }, json<EnginesListResponse>, opts),
    engineAction: (name, action, opts) =>
      call(`/stack/v1/engines/${encodeURIComponent(name)}/${action}`, { method: "POST" }, json<Record<string, unknown>>, opts),
    models: (opts) => call("/stack/v1/models", { method: "GET" }, json<Record<string, unknown>>, opts),
    modelAction: (id, action, opts) => call(`/stack/v1/models/${encodeURIComponent(id)}/actions`, jsonInit({ action }), json<Record<string, unknown>>, opts),
    health: (opts) => call("/stack/v1/health", { method: "GET" }, json<{ health: HealthItem[] }>, opts),
    healthFix: (code, opts) => call(`/stack/v1/health/${encodeURIComponent(code)}/fix`, { method: "POST" }, json<Record<string, unknown>>, opts),
    settings: (opts) => call("/stack/v1/settings", { method: "GET" }, json<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>, opts),
    applySettings: (values, opts) => call("/stack/v1/settings/apply", jsonInit(values), json<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>, opts),
    budget: (opts) => call("/stack/v1/hardware/budget", { method: "GET" }, json<BudgetResponse>, opts),
    hardware: (opts) => call("/stack/v1/hardware", { method: "GET" }, json<Record<string, unknown>>, opts),
    updates: (opts) => call("/stack/v1/updates", { method: "GET" }, json<StackUpdatesState>, opts),
    checkUpdates: (opts) => call("/stack/v1/updates/check", { method: "POST" }, json<StackUpdatesState>, opts),
    applyEngineUpdate: (name, opts) => call(`/stack/v1/updates/engines/${encodeURIComponent(name)}/apply`, { method: "POST" }, json<StackEngineApplyResult>, opts),
    rollbackEngine: (name, tag, opts) => call(`/stack/v1/updates/engines/${encodeURIComponent(name)}/rollback`, jsonInit({ tag }), json<StackEngineRollbackResult>, opts),
    sweepStorage: (opts) => call("/stack/v1/storage/sweep", { method: "POST" }, json<StackStorageSweepResult>, opts),
    runCheck: (opts) => call("/stack/v1/check", { method: "POST" }, json<StackCheckRun>, opts),
    healthz: (opts) => call("/healthz", { method: "GET" }, json<{ ok: boolean; version: string; uptimeSeconds: number }>, opts),
  };
}
