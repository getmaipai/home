// Home speaks to the Stack by role: one client per Stack, loopback
// only, every call bounded, every failure mapped to the kind the Stack
// stated, and the engine identity read from the reply's headers instead
// of probing a process.

import { withTimeout } from "@maipai/core/src/withTimeout";
import type { SttEndpointResponse } from "@maipai/spec/voice/ts/sttTypes.js";
import { StackJob as StackJobSchema } from "@maipai/spec/stack/ts/stack-job.js";
import { hostLabel, type EngineIdentity } from "../engineIdentity";
import { StackError, type StackErrorKind } from "./errors";
import { defaultStackBaseUrl } from "../ports";
import { StackVoiceSchema, type StackSelfHeal } from "./types";
import { StackCodingModeSchema } from "./contract";
import type { DiskPlan } from "../../../../shared/diskPlanMath";
import type { TokenCountRequest, TokenCountResponse } from "@maipai/spec/stack/ts/token-count.js";
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
  FitPlanRequest,
  StackFitPlan,
  StackVoice,
  StackCodingMode,
  StackMemoryLedger,
  StackDevLoad,
  StackCapabilities,
  StackReclaimList,
  StackReclaimResult,
  StackMemoryWatchdog,
} from "./types";


const DEFAULT_TIMEOUT_MS = 30_000;
const CODING_FIRST_BYTE_MS = 180_000;

const KIND_BY_STATUS: Record<number, StackErrorKind> = {
  400: "unknown",
  409: "unverified",
  499: "cancelled",
  503: "offline",
  504: "timeout",
};

export interface StackInstallModel {
  id: string; role: string; repo?: string; url: string; sha256: string; approx_bytes?: number;
  licence: string; revision: string; engine?: string; archive?: boolean; hub_file?: string;
  starter: boolean; installed: boolean;
}
export interface StackInstallPlan {
  level: "minimal" | "moderate" | "recommended" | null;
  tier: "p16" | "p32" | "p64" | "p128" | null;
  label: string;
  memory_gb: number;
  memory_source: "unified" | "graphics" | "override" | "unknown";
  models: StackInstallModel[];
  total_bytes: number;
  remaining_bytes: number;
  free_disk_bytes: number | null;
  fits_disk: boolean | null;
  /** What each install costs on disk, per component (the Stack's disk plan); absent on a Stack older than the disk plan. */
  disk?: DiskPlan | null;
  /** The pinned files of the picture and video rows, shaped as pull bodies; not in `models`. */
  optional_models?: StackInstallModel[];
}

/** The shape of GET /stack/v1/search `ddgs`: `url` is set only while `state` is "ready". */
export interface StackSearchServiceStatus {
  state: "unsupported" | "disabled" | "building" | "starting" | "ready" | "failed";
  url: string | null;
  phase: string | null;
  reason: string | null;
  restarts: number;
  library: { name: "ddgs"; version: string };
}

/** GET /stack/v1/image-tools (IMAGETOOLS-01): the editing tools' state, models and limits. */
export interface StackImageToolsStatus {
  state: "unsupported" | "needs-setup" | "building" | "idle" | "running";
  phase: string | null;
  vision: boolean;
  models: Record<string, boolean>;
  limits: Record<string, number>;
  operations: string[];
  reason: string | null;
}
/** One finished edit as POST /v1/images/edits states it: a PNG with no metadata. */
export interface StackImageEditItem { b64_json: string; width: number; height: number; content_type: string; operation: string; engine?: string; model?: string; ms?: number }
export type StackImageEditReply = { kind: "done"; job: string; item: StackImageEditItem } | { kind: "running"; job: string };

/** The coding role's four generation paths on the Stack (CODE-STACK-01). */
export type CodingWirePath = "/v1/messages" | "/v1/messages/count_tokens" | "/v1/responses" | "/v1/chat/completions";
/** The coding role's one served model as `GET /v1/models?role=coding` lists it. */
export interface StackCodingModels { object: "list"; data: Array<{ id: string; role?: string; context_length?: number; thinking_budget_ceiling?: number }> }
/** `GET /stack/v1/roles` coding entry: only what the gateway reads. */
export interface StackCodingStatus { state?: string; slots?: number | null; slots_busy?: number }
export interface StackClient {
  getCodingMode(opts?: { signal?: AbortSignal }): Promise<StackCodingMode>;
  setCodingMode(mode: "normal" | "coding", opts?: { signal?: AbortSignal }): Promise<void>;
  runCodingModeSelfTest(opts?: { signal?: AbortSignal }): Promise<void>;
  mediaRoots(opts?: { signal?: AbortSignal }): Promise<{ read: string[]; write: string[] }>;
  setMediaRoots(roots: { read: string[]; write: string[] }, opts?: { signal?: AbortSignal }): Promise<{ read: string[]; write: string[] }>;
  /** CODE-API-01: POST a coding wire request and hand back the engine's reply as the Stack sent it (status, headers, body stream), including a 4xx or 5xx, which the caller maps. Only a Stack that cannot be reached throws. Optional: an older client has no coding wires. */
  codingWire?(path: CodingWirePath, body: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> | null }>;
  /** CODE-API-01: GET /v1/models?role=coding (the one served model, with its context length and thinking ceiling). */
  codingModels?(opts?: { signal?: AbortSignal }): Promise<StackCodingModels>;
  /** POST /v1/chat/completions. For `stream: true` the Response body reader
   * and its headers come back, not parsed data. */
  chat(request: RoleRequest, opts?: { signal?: AbortSignal }): Promise<
    | { data: Record<string, unknown>; identity: EngineIdentity }
    | { stream: ReadableStream<Uint8Array>; headers: Headers }
  >;
  embeddings(request: RoleRequest, opts?: { signal?: AbortSignal }): Promise<{ data: Record<string, unknown>; identity: EngineIdentity }>;
  /** POST /v1/tokenize (STACK-TOKENIZE-01): the chat engine's own token
   * count on its own template render; a 501 is an engine that cannot
   * count, never an estimate. */
  tokenize(request: TokenCountRequest, opts?: { signal?: AbortSignal }): Promise<{ data: TokenCountResponse; identity: EngineIdentity }>;
  transcribe(form: FormData, opts?: { signal?: AbortSignal }): Promise<{ data: { text: string }; identity: EngineIdentity }>;
  /** POST /v1/audio/endpoint: has the speaker finished? (DUPLEX-02, Smart Turn v3.2 in the Stack). */
  endpoint(form: FormData, opts?: { signal?: AbortSignal }): Promise<{ data: SttEndpointResponse; identity: EngineIdentity }>;
  /** POST /v1/audio/speech; returns the streamed WAV Response. */
  speak(form: FormData, opts?: { signal?: AbortSignal }): Promise<Response>;
  /** POST /stack/v1/voices/{id}/preview; an intentionally unbounded first download/render. */
  voicePreview(id: string, opts?: { signal?: AbortSignal }): Promise<Response>;
  /** POST /v1/images/generations; returns the job. */
  imageJob(request: RoleRequest, opts?: { signal?: AbortSignal }): Promise<StackJob>;
  /** GET /stack/v1/image-tools. */
  imageTools(opts?: { signal?: AbortSignal }): Promise<StackImageToolsStatus>;
  /** POST /v1/images/looks (LOOK-01): one JPEG in, the Stack's look out (objects, scene, cost). The reply is returned as the Stack sent it;
   * lib/robotVision.ts reads the fields it keeps. Refusals are StackErrors (413, 415, 422 detail_unavailable, 429, 503, 500). */
  look(form: FormData, opts?: { signal?: AbortSignal }): Promise<unknown>;
  /** POST /v1/images/edits: 200 is the finished PNG, 202 a job to poll (`job()`), fetch with `imageEditResult()` and stop with `cancelJob()`. */
  imageEdit(form: FormData, opts?: { signal?: AbortSignal }): Promise<StackImageEditReply>;
  /** GET /v1/images/edits/{job}: the PNG a finished edit made (the Stack keeps it in memory a few minutes). */
  imageEditResult(job: string, opts?: { signal?: AbortSignal }): Promise<Uint8Array>;
  submitJob(request: { kind: string; role?: string | null; input?: Record<string, unknown> }, opts?: { signal?: AbortSignal }): Promise<StackJob>;
  job(id: string, opts?: { signal?: AbortSignal }): Promise<StackJob>;
  jobs(opts?: { signal?: AbortSignal }): Promise<StackJob[]>;
  cancelJob(id: string, opts?: { signal?: AbortSignal }): Promise<StackJob>;
  roles(opts?: { signal?: AbortSignal }): Promise<RolesListResponse>;
  engines(opts?: { signal?: AbortSignal }): Promise<EnginesListResponse>;
  voices(opts?: { signal?: AbortSignal }): Promise<StackVoice[]>;
  /** CANARY-01: ask the Stack's own supervised restart path for ONE restart of a role's engine (the circuit breaker keeps its count). An older Stack answers 404. */
  /** GPU-HEALTH-01: one tiny shader compile through the Mac's graphics compiler. An older Stack answers 404. */
  gpuHealth?(opts?: { signal?: AbortSignal }): Promise<{ ok: boolean; reason: string | null }>;
  requestSelfHealRestart?(role: string, reason: string, opts?: { signal?: AbortSignal }): Promise<{ accepted: boolean; why: string | null }>;
  engineAction(
    name: string,
    action: "start" | "stop" | "restart" | "install",
    opts?: { signal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
  /** DELETE /stack/v1/engines/{name}/builds/{tag}: remove an installed engine build. The Stack refuses, in a sentence, while the build serves a running role. Optional so an older Stack or a test double without it still type-checks. */
  removeEngineBuild?(name: string, tag: string, opts?: { signal?: AbortSignal }): Promise<{ ok: true }>;
  models(opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  modelCatalog(opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  /** POST /stack/v1/models: install a pinned model and start its download job. */
  pullModel(body: { id: string; role: string; repo?: string; url: string; sha256: string; approx_bytes?: number; licence: string; revision: string; engine?: string; archive?: boolean; hub_file?: string; component?: string }, opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  /** POST /stack/v1/models/inspect: a Hugging Face model file's size, hash, licence and layer shape, read without downloading it (MODEL-ADD-01). The Stack answers 400 with a sentence for a link it refuses. */
  inspectModel?(body: { source: string; file?: string }, opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  modelAction(id: string, action: string, opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  health(opts?: { signal?: AbortSignal }): Promise<{ health: HealthItem[] }>;
  /** GET /stack/v1/memory. The ledger block is absent on older Stacks. */
  /** GET /stack/v1/capabilities. Absent on older Stacks (404). */
  capabilities?(opts?: { signal?: AbortSignal }): Promise<StackCapabilities>;
  /** GET and POST /stack/v1/memory/reclaim. Absent on older Stacks (404). */
  reclaimList?(opts?: { signal?: AbortSignal }): Promise<StackReclaimList>;
  reclaimRun?(opts?: { signal?: AbortSignal }): Promise<StackReclaimResult>;
  memory?(opts?: { signal?: AbortSignal }): Promise<{ ledger?: StackMemoryLedger; watchdog?: StackMemoryWatchdog; dev_load?: StackDevLoad }>;
  healthFix(code: string, opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  /** ROBUST-01: crashes per day and the Stack's own restarts; absent on a Stack older than the route. */
  selfHeal?(opts?: { signal?: AbortSignal }): Promise<StackSelfHeal>;
  settings(opts?: { signal?: AbortSignal }): Promise<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>;
  applySettings(values: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>;
  /** SEARXNG-SET-03: Stack-owned SearXNG settings preview and revert. */
  /** PUT /stack/v1/settings: store values, validated against the Stack's declaration. A setting that needs a restart becomes pending; the rest take effect now. Optional so a test double without it still type-checks. */
  updateSettings?(values: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>;
  /** POST /stack/v1/settings/apply with no body: promote every pending value to in effect. */
  promotePendingSettings?(opts?: { signal?: AbortSignal }): Promise<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>;
  searchPreview(opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  searchRevert(opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  budget(opts?: { signal?: AbortSignal }): Promise<BudgetResponse>;
  fitPlan(body: FitPlanRequest, opts?: { signal?: AbortSignal }): Promise<StackFitPlan>;
  hardware(opts?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  /** GET /stack/v1/install-plan: the models this computer should install, by hardware level. */
  installPlan(query?: { vramGb?: number }, opts?: { signal?: AbortSignal }): Promise<StackInstallPlan>;
  /** GET /stack/v1/models/catalog: shipped model pins with verified provenance. */
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
  /** POST /stack/v1/warmup (STACK-WARM-01): load and prime the roles a first chat needs; the Stack also does this on its own at start and after each model install. */
  warmup(opts?: { signal?: AbortSignal }): Promise<{ state: "idle" | "warming" | "ready"; trigger: string | null }>;
  /** GET /stack/v1/warmup: the warm-up state, read only. Polling uses this; a POST starts a new warm-up whenever none is running, so polling it looped a chat prime every 2 s. */
  warmupState(opts?: { signal?: AbortSignal }): Promise<{ state: "idle" | "warming" | "ready"; trigger: string | null }>;
  /** GET /stack/v1/search (STACK-DDGS-01): where the Stack's DuckDuckGo search service listens and whether it is healthy. */
  searchService(opts?: { signal?: AbortSignal }): Promise<{ ddgs: StackSearchServiceStatus }>;
  /** GET /healthz. `version` is the Stack's own release ("0.1.0"); `contract` is the wire contract number Home compares to STACK_CONTRACT_MIN/MAX. */
  healthz(opts?: { signal?: AbortSignal }): Promise<{ ok: boolean; version: string; contract?: number; uptimeSeconds: number }>;
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
  const baseUrl = options.baseUrl ?? defaultStackBaseUrl();
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
    const failureMessage = typeof fb?.error === "string" ? fb.error : fb?.error?.message;
    // The coding mode routes refuse with {reason}, not {error}: keep that sentence instead of the HTTP label.
    const bodyReason = typeof (body as { reason?: unknown } | null | undefined)?.reason === "string" ? (body as { reason: string }).reason : undefined;
    const message = failureMessage ?? bodyReason ?? (res.statusText || `the Stack answered ${res.status}`);
    // CHAT-CALM-ERRORS-01b: the body's `state` and the reply's identity
    // headers ride on the error so an admin's details name them.
    const header = (name: string) => {
      const value = res.headers.get(name);
      return value && value !== "none" ? value : undefined;
    };
    const facts = { status: res.status, body: text, state: typeof fb?.state === "string" ? fb.state : undefined, engine: header("x-maipai-engine"), model: header("x-maipai-model"), reason: typeof fb?.reason === "string" ? fb.reason : bodyReason };
    if (kind === "offline") {
      throw new StackError("offline", message, { ...facts, offline_reason: fb?.offline_reason });
    }
    throw new StackError(kind, message, facts);
  }

  function isFailureBody(value: unknown): value is FailureBody {
    if (typeof value !== "object" || value === null) return false;
    const error = (value as FailureBody).error;
    return typeof error === "string" || (typeof error === "object" && error !== null && typeof error.message === "string");
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
    async codingWire(path, body, opts) {
      let res: Response;
      try {
        // A cold coding engine takes tens of seconds to load, so the wait for the first byte is longer than the other roles'.
        res = await withTimeout(doFetch(base + path, { ...jsonInit(body), signal: opts?.signal }), Math.max(timeoutMs, CODING_FIRST_BYTE_MS), timeoutError);
      } catch (err) {
        wrapError(err);
      }
      return { status: res.status, headers: res.headers, body: res.body };
    },
    codingModels: (opts) => call("/v1/models?role=coding", { method: "GET" }, json<StackCodingModels>, opts),
    embeddings: (request, opts) => call("/v1/embeddings", jsonInit(request), rawJson<Record<string, unknown>>, opts),
    tokenize: (request, opts) => call("/v1/tokenize", jsonInit(request), rawJson<TokenCountResponse>, opts),
    transcribe: (form, opts) => call("/v1/audio/transcriptions", formInit(form), rawJson<{ text: string }>, opts),
    endpoint: (form, opts) => call("/v1/audio/endpoint", formInit(form), rawJson<SttEndpointResponse>, opts),
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
    async voicePreview(id, opts) {
      let res: Response;
      try {
        // Deliberately no default timeout: the Stack can fetch a 5–8 MB
        // pinned voice before it renders this first preview.
        res = await doFetch(`${base}/stack/v1/voices/${encodeURIComponent(id)}/preview`, { method: "POST", signal: opts?.signal });
      } catch (err) { wrapError(err); }
      if (!res.ok) { await fail(res); throw new Error("unreachable"); }
      if (!/^audio\/(wav|x-wav)(?:;|$)/i.test(res.headers.get("content-type") ?? "")) {
        throw new StackError("unexpected", "the Stack returned a preview that was not a WAV", { status: res.status });
      }
      return res;
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
        return StackJobSchema.parse({
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
        });
      }
      if (res.ok) {
        const body = await res.json() as { created: number; job: string; data: unknown[] };
        return StackJobSchema.parse({
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
        });
      }
      await fail(res);
      throw new Error("unreachable");
    },
    imageTools: (opts) => call("/stack/v1/image-tools", { method: "GET" }, async (res) => (await json<{ image_tools: StackImageToolsStatus }>(res)).image_tools, opts),
    look: (form, opts) => call("/v1/images/looks", formInit(form), (res) => json<unknown>(res), opts),
    imageEdit: (form, opts) => call("/v1/images/edits", formInit(form), async (res) => {
      const body = await json<{ job: string; data: StackImageEditItem[] }>(res);
      const item = res.status === 200 ? body.data?.[0] : undefined;
      return item ? { kind: "done" as const, job: body.job, item } : { kind: "running" as const, job: body.job };
    }, opts),
    imageEditResult: (job, opts) => call(`/v1/images/edits/${encodeURIComponent(job)}`, { method: "GET" }, async (res) => new Uint8Array(await res.arrayBuffer()), opts),
    submitJob: (request, opts) => call("/stack/v1/jobs", jsonInit(request), async (res) => StackJobSchema.parse((await json<{ job: unknown }>(res)).job), opts),
    job: (id, opts) => call(`/stack/v1/jobs/${encodeURIComponent(id)}`, { method: "GET" }, async (res) => StackJobSchema.parse((await json<{ job: unknown }>(res)).job), opts),
    jobs: (opts) => call("/stack/v1/jobs", { method: "GET" }, async (res) => { const body = await json<{ jobs: unknown }>(res); return Array.isArray(body.jobs) ? body.jobs.map((job) => StackJobSchema.parse(job)) : []; }, opts),
    cancelJob: (id, opts) => call(`/stack/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }, async (res) => StackJobSchema.parse((await json<{ job: unknown }>(res)).job), opts),
    roles: (opts) => call("/stack/v1/roles", { method: "GET" }, json<RolesListResponse>, opts),
    getCodingMode: (opts) => call("/stack/v1/coding/mode", { method: "GET" }, async (res) => StackCodingModeSchema.parse(await json<unknown>(res)), opts),
    setCodingMode: (mode, opts) => call("/stack/v1/coding/mode", jsonInit({ mode }), async (res) => { await json<Record<string, unknown>>(res); }, opts),
    runCodingModeSelfTest: (opts) => call("/stack/v1/coding/mode/self-test", { method: "POST" }, async (res) => { await json<Record<string, unknown>>(res); }, opts),
    engines: (opts) => call("/stack/v1/engines", { method: "GET" }, json<EnginesListResponse>, opts),
    voices: (opts) => call("/stack/v1/voices", { method: "GET" }, async (res) => {
      const body = await json<{ voices: unknown[] }>(res);
      if (!Array.isArray(body.voices)) throw new Error("the Stack returned an invalid voices list");
      let skipped = 0;
      const voices: StackVoice[] = [];
      for (const row of body.voices) {
        const parsed = StackVoiceSchema.safeParse(row);
        if (parsed.success) voices.push(parsed.data);
        else skipped++;
      }
      if (skipped) console.warn(`the Stack voices list contained ${skipped} row(s) without a usable id`);
      return voices;
    }, opts),
    engineAction: (name, action, opts) =>
      call(`/stack/v1/engines/${encodeURIComponent(name)}/${action}`, { method: "POST" }, json<Record<string, unknown>>, opts),
    removeEngineBuild: (name, tag, opts) => call(`/stack/v1/engines/${encodeURIComponent(name)}/builds/${encodeURIComponent(tag)}`, { method: "DELETE" }, json<{ ok: true }>, opts),
    models: (opts) => call("/stack/v1/models", { method: "GET" }, json<Record<string, unknown>>, opts),
    modelCatalog: (opts) => call("/stack/v1/models/catalog", { method: "GET" }, json<Record<string, unknown>>, opts),
    pullModel: (body, opts) => call("/stack/v1/models", jsonInit(body), json<Record<string, unknown>>, opts),
    inspectModel: (body, opts) => call("/stack/v1/models/inspect", jsonInit(body), json<Record<string, unknown>>, opts),
    modelAction: (id, action, opts) => call(`/stack/v1/models/${encodeURIComponent(id)}/actions`, jsonInit({ action }), json<Record<string, unknown>>, opts),
    health: (opts) => call("/stack/v1/health", { method: "GET" }, json<{ health: HealthItem[] }>, opts),
    capabilities: (opts) => call("/stack/v1/capabilities", { method: "GET" }, json<StackCapabilities>, opts),
    reclaimList: (opts) => call("/stack/v1/memory/reclaim", { method: "GET" }, json<StackReclaimList>, opts),
    reclaimRun: (opts) => call("/stack/v1/memory/reclaim", { method: "POST" }, json<StackReclaimResult>, opts),
    memory: (opts) => call("/stack/v1/memory", { method: "GET" }, json<{ ledger?: StackMemoryLedger; watchdog?: StackMemoryWatchdog; dev_load?: StackDevLoad }>, opts),
    mediaRoots: (opts) => call("/stack/v1/media", { method: "GET" }, async (res) => {
      const body = await json<{ media?: { roots?: { read?: unknown; write?: unknown } } }>(res);
      return { read: Array.isArray(body.media?.roots?.read) ? body.media!.roots!.read as string[] : [], write: Array.isArray(body.media?.roots?.write) ? body.media!.roots!.write as string[] : [] };
    }, opts),
    setMediaRoots: (roots, opts) => call("/stack/v1/media/roots", { ...jsonInit(roots), method: "PUT" }, async (res) => (await json<{ roots: { read: string[]; write: string[] } }>(res)).roots, opts),
    requestSelfHealRestart: (role, reason, opts) => call("/stack/v1/engines/self-heal/restart", jsonInit({ role, reason }), json<{ accepted: boolean; why: string | null }>, opts),
    gpuHealth: (opts) => call("/stack/v1/engines/gpu-health", { method: "GET" }, json<{ ok: boolean; reason: string | null }>, opts),
    selfHeal: (opts) => call("/stack/v1/engines/self-heal", { method: "GET" }, json<StackSelfHeal>, opts),
    healthFix: (code, opts) => call(`/stack/v1/health/${encodeURIComponent(code)}/fix`, { method: "POST" }, json<Record<string, unknown>>, opts),
    settings: (opts) => call("/stack/v1/settings", { method: "GET" }, json<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>, opts),
    applySettings: async (values, opts) => {
      // Settings are stored by PUT /settings. The apply endpoint has no
      // body; it only promotes pending values. Keep this one helper for
      // callers that need a setting to take effect now, while avoiding
      // promoting unrelated pending changes staged by an admin.
      const stored = await call("/stack/v1/settings", { ...jsonInit(values), method: "PUT" }, json<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>, opts);
      const keys = new Set(Object.keys(values));
      const pending = stored.settings.filter((setting) => setting.pending !== null && setting.pending !== undefined);
      if (pending.length > 0 && pending.every((setting) => keys.has(setting.key))) {
        return call("/stack/v1/settings/apply", { method: "POST" }, json<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>, opts);
      }
      return stored;
    },
    updateSettings: (values, opts) => call("/stack/v1/settings", { ...jsonInit(values), method: "PUT" }, json<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>, opts),
    promotePendingSettings: (opts) => call("/stack/v1/settings/apply", { method: "POST" }, json<{ sections: Array<{ id: string; label: string }>; settings: StackSetting[] }>, opts),
    searchPreview: (opts) => call("/stack/v1/search/preview", { method: "GET" }, json<Record<string, unknown>>, opts),
    searchRevert: (opts) => call("/stack/v1/search/revert", { method: "POST" }, json<Record<string, unknown>>, opts),
    budget: (opts) => call("/stack/v1/hardware/budget", { method: "GET" }, json<BudgetResponse>, opts),
    fitPlan: (body, opts) => call("/stack/v1/fit-plan", jsonInit(body), json<StackFitPlan>, opts),
    installPlan: (query, opts) => call(`/stack/v1/install-plan${query?.vramGb ? `?vram_gb=${encodeURIComponent(String(query.vramGb))}` : ""}`, { method: "GET" }, json<StackInstallPlan>, opts),
    hardware: (opts) => call("/stack/v1/hardware", { method: "GET" }, json<Record<string, unknown>>, opts),
    updates: (opts) => call("/stack/v1/updates", { method: "GET" }, json<StackUpdatesState>, opts),
    checkUpdates: (opts) => call("/stack/v1/updates/check", { method: "POST" }, json<StackUpdatesState>, opts),
    applyEngineUpdate: (name, opts) => call(`/stack/v1/updates/engines/${encodeURIComponent(name)}/apply`, { method: "POST" }, json<StackEngineApplyResult>, opts),
    rollbackEngine: (name, tag, opts) => call(`/stack/v1/updates/engines/${encodeURIComponent(name)}/rollback`, jsonInit({ tag }), json<StackEngineRollbackResult>, opts),
    sweepStorage: (opts) => call("/stack/v1/storage/sweep", { method: "POST" }, json<StackStorageSweepResult>, opts),
    warmup: (opts) => call("/stack/v1/warmup", { method: "POST" }, json<{ state: "idle" | "warming" | "ready"; trigger: string | null }>, opts),
    warmupState: (opts) => call("/stack/v1/warmup", { method: "GET" }, json<{ state: "idle" | "warming" | "ready"; trigger: string | null }>, opts),
    runCheck: (opts) => call("/stack/v1/check", { method: "POST" }, json<StackCheckRun>, opts),
    searchService: (opts) => call("/stack/v1/search", { method: "GET" }, json<{ ddgs: StackSearchServiceStatus }>, opts),
    healthz: (opts) => call("/healthz", { method: "GET" }, json<{ ok: boolean; version: string; contract?: number; uptimeSeconds: number }>, opts),
  };
}
