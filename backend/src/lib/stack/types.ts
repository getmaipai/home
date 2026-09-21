// The Stack's wire shapes, hand-copied field-for-field from
// stack/backend/src/spec/schemas/. A follow-up swaps them for
// @maipai/spec once those schemas move into shared/spec.

// role-request.schema.json
export interface RoleRequest {
  /** A role id (`chat`, `coding`, `judge`, `router`, `embed`, `rerank`,
   * `vision`, `stt`, `tts`, `wakeword`, `image`, `video`, `music`) or an
   * installed model id. */
  model: string;
  /** Generator roles only: which of the tiered models the sizing profile
   * installed. */
  quality?: "fast" | "everyday" | "best";
  stream?: boolean;
  timeout_ms?: number;
  /** Passed to the engine unchanged. */
  [key: string]: unknown;
}

// role-reply-headers.schema.json: the three identity headers the Stack
// puts on every role-route reply, including a 503.
export interface RoleReplyHeaders {
  "x-maipai-engine": string;
  "x-maipai-model": string;
  "x-maipai-revision": string;
}

// stack-job.schema.json
export interface StackJob {
  id: string;
  /** The runner's kind: a generator role id (`image`), or a Stack task
   * (`model.install`, `engine.install`, `engine.stage`). */
  kind: string;
  /** The role the job serves, when it serves one. */
  role: string | null;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  percent: number;
  completedBytes: number;
  totalBytes: number;
  /** A short phrase for the current step (`downloading`, `waiting for memory`,
   * `rendering`). */
  status: string;
  /** The job's place in its role's queue while `queued`, null otherwise. */
  position: number | null;
  /** What was submitted, as given. */
  input: Record<string, unknown> | null;
  /** What the runner returned when `done`. */
  result: unknown;
  /** Why the job failed or was cancelled. */
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

// health-item.schema.json
export interface HealthItem {
  /** Stable and unique per condition, `engine.crashed.chat`. */
  code: string;
  severity: "critical" | "error" | "warning";
  title: string;
  text: string;
  since: string;
  cause: string;
  fix?: {
    label: string;
    action:
      | "restart_engine"
      | "free_memory"
      | "retry_download"
      | "rollback_update"
      | "reinstall_engine"
      | "reinstall_model";
  };
}

// stack-setting.schema.json: the SettingsKey half (scope `device`,
// lives_in `stack`) plus the Stack's three fields.
export interface StackSetting {
  key: string;
  scope: "device";
  selector: "number" | "select" | "text" | "boolean";
  range?:
    | { min: number; max: number }
    | { options: Array<{ value: string; label: string }> };
  default: unknown;
  label: string;
  help?: string;
  section?: { id?: string; collapsed?: boolean; order?: number };
  level: "basic" | "advanced" | "expert";
  secret?: boolean;
  needs?: string[];
  lives_in: "stack";
  honoured_by: Array<"home" | "bot">;
  /** True when a change is held as `pending` until the service restarts. */
  needs_restart: boolean;
  /** The value the daemon is running with. */
  in_effect: unknown;
  /** A stored value not yet in effect, or null. */
  pending: unknown;
}

// GET /stack/v1/roles
export interface RoleState {
  state: "notInstalled" | "installed" | "loaded" | "ready" | "offline";
  since: string;
  checkedAt?: string;
  reason?: string | null;
}

export interface RoleInfo {
  id:
    | "chat"
    | "coding"
    | "judge"
    | "router"
    | "embed"
    | "rerank"
    | "vision"
    | "stt"
    | "tts"
    | "wakeword"
    | "image"
    | "video"
    | "music";
  label: string;
  wire: "chat" | "embeddings" | "rerank" | "transcription" | "speech" | "job";
  residency: "resident" | "jit" | "installed";
  endpoints: string[];
  quality: Array<"fast" | "everyday" | "best">;
  sharesModelWith:
    | "chat"
    | "coding"
    | "judge"
    | "router"
    | "embed"
    | "rerank"
    | "vision"
    | "stt"
    | "tts"
    | "wakeword"
    | "image"
    | "video"
    | "music"
    | null;
  state: RoleState;
  reason: string | null;
  model: {
    id: string;
    sizeBytes: number | null;
    measuredFootprintBytes: number | null;
    measuredContextLength: number | null;
    estimated: boolean;
  } | null;
  check: {
    state: "not checked" | "passed" | "failed" | "skipped";
    at: string | null;
    reason: string | null;
    stale: boolean;
  };
}

export interface RolesListResponse {
  roles: RoleInfo[];
}

// GET /stack/v1/engines
export interface EngineInfo {
  id: string;
  name: string;
  label: string;
  platform: string;
  arch: string;
  verified: boolean;
  installed: boolean;
  matchesThisMachine: boolean;
  running: string | null;
  currentTag: string | null;
  newestTag: string | null;
  current: boolean;
  notCurrent: boolean;
  needsRestart: boolean;
  state: "current" | "notCurrent";
  stateReason: "newer installed" | "newer available" | null;
  directory: string;
  roleState: string;
  roleReason: string | null;
}

export interface EnginesListResponse {
  engines: EngineInfo[];
}

// GET /stack/v1/hardware/budget
export interface BudgetResponse {
  totalMemoryBytes: number;
  capBytes: number;
  freeMemoryBytes: number;
  availablePercent: number;
  pressure: "normal" | "warn" | "critical";
  memoryReadingDegraded: boolean;
  loaded: Array<{
    id: string;
    kind: "resident" | "jit" | "generator";
    peakBytes: number;
    measured: boolean;
    lastUsedAt: string;
    idleTtlSeconds: number;
    pinned: boolean;
    pid: number | null;
  }>;
  queue: Array<{ id: string; position: number; kind: "resident" | "jit" | "generator" }>;
}

// GET/POST /stack/v1/updates, /updates/check
export interface StackEngineUpdate {
  name: string;
  installed: string | null;
  available: string | null;
  availableKnown: boolean;
  lastChecked: string | null;
  notes: string | null;
}

export interface StackModelUpdate {
  id: string;
  installed: string;
  available: string | null;
}

export interface StackUpdatesState {
  checksEnabled: boolean;
  engines: StackEngineUpdate[];
  models: { lastChecked: string | null; entries: StackModelUpdate[] };
  recommendations: unknown[];
}

// POST /stack/v1/updates/engines/{name}/apply
export interface StackEngineApplyResult {
  applied: boolean;
  tag: string | null;
  previous: string | null;
}

// POST /stack/v1/updates/engines/{name}/rollback
export interface StackEngineRollbackResult {
  ok: true;
  tag: string;
}

// POST /stack/v1/storage/sweep
export interface StackStorageSweepResult {
  removed: string[];
}

// POST /stack/v1/check, GET /stack/v1/check/latest
export interface StackCheckRoleResult {
  role: string;
  ok: boolean;
  ms: number;
  reason: string | null;
  loadMs: number | null;
  skipped?: boolean;
}

export interface StackCheckRun {
  at: string;
  ok: boolean;
  results: StackCheckRoleResult[];
  fitTogether: { ok: boolean; reason: string | null };
  reason: string | null;
  generation: number;
}

// The failure body every role route returns with an error status.
export interface FailureBody {
  error: string;
  offline_reason?: string;
  roles?: string[];
  model?: string;
  reason?: string;
  missing?: string[];
  job?: string;
  role?: string;
  state?: string;
}
