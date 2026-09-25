// HOME-STACK-04a: the household's own view onto the Stack's admin
// surface (roles, engines, models, health, settings) - owner/admin
// only, the same gate repairs.ts uses, since this reaches into machine
// internals no ordinary household member needs. Route style copied from
// repairs.ts: apiRouter(), one createRoute() per endpoint with named
// Zod schemas, `.openapi(route, handler)`, no `any`. Every schema below
// is declared once from stack/types.ts's own field names; the two
// exceptions (models/hardware/action-result payloads) are honestly
// `z.record(...)` because stack/client.ts itself still types those
// calls as `Record<string, unknown>` - the Stack has not spec'd their
// shape yet, so a hand-typed schema here would just be guessing.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { getHomeSupervisorRoles } from "@/lib/homeSupervisorRoles";
import { StackError } from "@/lib/stack/errors";
import { getStackUpdatesState, checkStackUpdates, applyStackEngineUpdate, rollbackStackEngine } from "@/lib/stackUpdates";
import { ROLE_IDS } from "@/lib/stack/types";

export const enginesRoutes = apiRouter();

// ---- Schemas, one per stack/types.ts shape --------------------------

const RoleIdSchema = z.enum(ROLE_IDS);

const RoleInfoSchema = z.object({
  id: RoleIdSchema,
  label: z.string(),
  wire: z.enum(["chat", "embeddings", "rerank", "transcription", "speech", "job"]),
  residency: z.enum(["resident", "jit", "installed"]),
  endpoints: z.array(z.string()),
  quality: z.array(z.enum(["fast", "everyday", "best"])),
  sharesModelWith: RoleIdSchema.nullable(),
  state: z.object({
    state: z.enum(["notInstalled", "installed", "loaded", "ready", "offline"]),
    since: z.string(),
    checkedAt: z.string().optional(),
    reason: z.string().nullable().optional(),
  }),
  reason: z.string().nullable(),
  model: z
    .object({
      id: z.string(),
      sizeBytes: z.number().nullable(),
      measuredFootprintBytes: z.number().nullable(),
      measuredContextLength: z.number().nullable(),
      estimated: z.boolean(),
    })
    .nullable(),
  check: z.object({
    state: z.enum(["not checked", "passed", "failed", "skipped"]),
    at: z.string().nullable(),
    reason: z.string().nullable(),
    stale: z.boolean(),
  }),
});

const EngineInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  platform: z.string(),
  arch: z.string(),
  verified: z.boolean(),
  installed: z.boolean(),
  matchesThisMachine: z.boolean(),
  running: z.string().nullable(),
  currentTag: z.string().nullable(),
  newestTag: z.string().nullable(),
  current: z.boolean(),
  notCurrent: z.boolean(),
  needsRestart: z.boolean(),
  state: z.enum(["current", "notCurrent"]),
  stateReason: z.enum(["newer installed", "newer available"]).nullable(),
  directory: z.string(),
  roleState: z.string(),
  roleReason: z.string().nullable(),
});

const BudgetSchema = z.object({
  totalMemoryBytes: z.number(),
  capBytes: z.number(),
  freeMemoryBytes: z.number(),
  availablePercent: z.number(),
  pressure: z.enum(["normal", "warn", "critical"]),
  memoryReadingDegraded: z.boolean(),
  loaded: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["resident", "jit", "generator"]),
      peakBytes: z.number(),
      measured: z.boolean(),
      lastUsedAt: z.string(),
      idleTtlSeconds: z.number(),
      pinned: z.boolean(),
      pid: z.number().nullable(),
    }),
  ),
  queue: z.array(z.object({ id: z.string(), position: z.number(), kind: z.enum(["resident", "jit", "generator"]) })),
});

const HealthItemSchema = z.object({
  code: z.string(),
  severity: z.enum(["critical", "error", "warning"]),
  title: z.string(),
  text: z.string(),
  since: z.string(),
  cause: z.string(),
  fix: z
    .object({
      label: z.string(),
      action: z.enum(["restart_engine", "free_memory", "retry_download", "rollback_update", "reinstall_engine", "reinstall_model"]),
    })
    .optional(),
});

const StackSettingSchema = z.object({
  key: z.string(),
  scope: z.literal("device"),
  selector: z.enum(["number", "select", "text", "boolean"]),
  range: z.union([z.object({ min: z.number(), max: z.number() }), z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })) })]).optional(),
  default: z.unknown(),
  label: z.string(),
  help: z.string().optional(),
  section: z.object({ id: z.string().optional(), collapsed: z.boolean().optional(), order: z.number().optional() }).optional(),
  level: z.enum(["basic", "advanced", "expert"]),
  secret: z.boolean().optional(),
  needs: z.array(z.string()).optional(),
  lives_in: z.literal("stack"),
  honoured_by: z.array(z.enum(["home", "bot"])),
  needs_restart: z.boolean(),
  in_effect: z.unknown(),
  pending: z.unknown(),
});

const StackEngineUpdateSchema = z.object({ name: z.string(), installed: z.string().nullable(), available: z.string().nullable(), availableKnown: z.boolean(), lastChecked: z.string().nullable(), notes: z.string().nullable() });
const StackModelUpdateSchema = z.object({ id: z.string(), installed: z.string(), available: z.string().nullable() });
const StackUpdatesSchema = z.object({
  checksEnabled: z.boolean(),
  engines: z.array(StackEngineUpdateSchema),
  models: z.object({ lastChecked: z.string().nullable(), entries: z.array(StackModelUpdateSchema) }),
});
const StackEngineApplyResultSchema = z.object({ applied: z.boolean(), tag: z.string().nullable(), previous: z.string().nullable() });
const StackEngineRollbackResultSchema = z.object({ ok: z.literal(true), tag: z.string() });

// The Stack hasn't spec'd these shapes anywhere - stack/client.ts itself
// still types each of these calls as `Record<string, unknown>` - so an
// honest schema here is a record, not a guessed object shape (a real
// StackJob-per-model-action shape looked plausible while writing this,
// but client.ts's own modelAction() signature doesn't promise one, so
// this stays a record like its neighbors rather than typing past what
// the client actually returns).
const HardwareSchema = z.record(z.string(), z.unknown());
const ModelsListSchema = z.record(z.string(), z.unknown());
const EngineActionResultSchema = z.record(z.string(), z.unknown());
const ModelActionResultSchema = z.record(z.string(), z.unknown());

const ModelActionBodySchema = z.object({ action: z.enum(["load", "unload", "pin", "unpin"]) });
// Allowed only here, same as settings.ts's own precedent: the Stack's
// setting values are genuinely by-key, not a shape Home can name up
// front.
const SettingsApplyBodySchema = z.record(z.string(), z.unknown());
const SettingsResponseSchema = z.object({ sections: z.array(z.object({ id: z.string(), label: z.string() })), settings: z.array(StackSettingSchema) });

// ---- Failure mapping, one place --------------------------------------

const StackFailureSchema = z.object({ error: z.string(), reason: z.string().optional() });

type StackFailure =
  | { status: 400; body: { error: string } }
  | { status: 409; body: { error: string } }
  | { status: 503; body: { error: string; reason?: string } }
  | { status: 504; body: { error: string } };

/** Every StackError kind, mapped to the status and body the Stack's own
 * `failure()` shape carries - never a guessed cause. `offline` and
 * `unreachable` both mean "the Stack didn't answer" (503); `offline`
 * alone carries a real `offline_reason`, folded through as `reason`.
 * `cancelled`/`unexpected` fall back to 503 too, the same "the Stack
 * didn't answer" posture stackEngine.ts's own `stackFailureResult()`
 * already takes for anything outside its five named kinds. */
function classifyStackError(err: unknown): StackFailure {
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

const STACK_ERROR_RESPONSES = {
  ...errorResponses({ 400: "The request was bad", 409: "The model is not verified", 504: "The Stack stopped answering" }),
  503: { content: { "application/json": { schema: StackFailureSchema } }, description: "The Stack is offline or unreachable." },
};

// ---- Routes ------------------------------------------------------------

const overviewRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Engines"],
  summary: "Roles, engines and the hardware budget, in one read",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    // `configured: false` is a normal, common household state (no
    // Stack set up yet - engines.stack.url empty), not a failure: it
    // reads 200 with empty roles/engines and a null budget, the same
    // "null, not an error" posture dashboard.ts's own
    // engineStatusCounts() already takes for the identical case, so a
    // page reading this never has to string-match an error message to
    // tell "not configured" apart from "configured but unreachable".
    200: {
      content: { "application/json": { schema: z.object({ configured: z.boolean(), roles: z.array(RoleInfoSchema), engines: z.array(EngineInfoSchema), budget: BudgetSchema.nullable() }) } },
      description: "The Stack's own current state, or configured: false with empty/null fields when no Stack is set up.",
    },
    ...errorResponses({ 403: "Not owner/admin" }),
    ...STACK_ERROR_RESPONSES,
  },
});
enginesRoutes.openapi(overviewRoute, async (c) => {
  // VOICE-LIVE-01b: `roles` used to be unconditionally empty here - the
  // common household case (no Stack) could never read any role as
  // ready, no matter how healthy Home's own chat/tts/stt/embed
  // supervisors really were. homeSupervisorRoles.ts is the same
  // RoleInfo shape, the other source (docs/dev.md's own VOICE-LIVE-01b
  // note has the full trace).
  if (!isStackConfigured()) return c.json({ configured: false, roles: await getHomeSupervisorRoles(), engines: [], budget: null }, 200);
  try {
    const [{ roles }, { engines }, budget] = await Promise.all([getStackClient().roles(), getStackClient().engines(), getStackClient().budget()]);
    return c.json({ configured: true, roles, engines, budget }, 200);
  } catch (err) {
    const failure = classifyStackError(err);
    return c.json(failure.body, failure.status);
  }
});

const hardwareRoute = createRoute({
  method: "get",
  path: "/hardware",
  tags: ["Engines"],
  summary: "The Stack's raw hardware read",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: HardwareSchema } }, description: "Not yet spec'd upstream; passed through as the client returns it." },
    ...errorResponses({ 403: "Not owner/admin" }),
    ...STACK_ERROR_RESPONSES,
  },
});
enginesRoutes.openapi(hardwareRoute, async (c) => {
  try {
    return c.json(await getStackClient().hardware(), 200);
  } catch (err) {
    const failure = classifyStackError(err);
    return c.json(failure.body, failure.status);
  }
});

const modelsRoute = createRoute({
  method: "get",
  path: "/models",
  tags: ["Engines"],
  summary: "The Stack's installed and available models",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: ModelsListSchema } }, description: "Not yet spec'd upstream; passed through as the client returns it." },
    ...errorResponses({ 403: "Not owner/admin" }),
    ...STACK_ERROR_RESPONSES,
  },
});
enginesRoutes.openapi(modelsRoute, async (c) => {
  try {
    return c.json(await getStackClient().models(), 200);
  } catch (err) {
    const failure = classifyStackError(err);
    return c.json(failure.body, failure.status);
  }
});

const ModelIdParamSchema = z.object({ id: z.string().openapi({ param: { name: "id", in: "path" }, example: "qwen3-8b-instruct-q4_k_m.gguf" }) });

const modelActionRoute = createRoute({
  method: "post",
  path: "/models/{id}/actions",
  tags: ["Engines"],
  summary: "Load, unload, pin or unpin one model",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: ModelIdParamSchema, body: { content: { "application/json": { schema: ModelActionBodySchema } } } },
  responses: {
    200: { content: { "application/json": { schema: ModelActionResultSchema } }, description: "Not yet spec'd upstream; passed through as the client returns it." },
    ...errorResponses({ 403: "Not owner/admin" }),
    ...STACK_ERROR_RESPONSES,
  },
});
enginesRoutes.openapi(modelActionRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { action } = c.req.valid("json");
  try {
    return c.json(await getStackClient().modelAction(id, action), 200);
  } catch (err) {
    const failure = classifyStackError(err);
    return c.json(failure.body, failure.status);
  }
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Engines"],
  summary: "The Stack's own health items",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    // Same `configured: false` posture as GET / above: no Stack set up
    // is a normal state, empty health list, never an error.
    200: { content: { "application/json": { schema: z.object({ configured: z.boolean(), health: z.array(HealthItemSchema) }) } }, description: "The Stack's current health list - the same items Repairs already folds in - or configured: false with an empty list when no Stack is set up." },
    ...errorResponses({ 403: "Not owner/admin" }),
    ...STACK_ERROR_RESPONSES,
  },
});
enginesRoutes.openapi(healthRoute, async (c) => {
  if (!isStackConfigured()) return c.json({ configured: false, health: [] }, 200);
  try {
    const result = await getStackClient().health();
    return c.json({ configured: true, ...result }, 200);
  } catch (err) {
    const failure = classifyStackError(err);
    return c.json(failure.body, failure.status);
  }
});

const HealthCodeParamSchema = z.object({ code: z.string().openapi({ param: { name: "code", in: "path" }, example: "engine.crashed.chat" }) });

const healthFixRoute = createRoute({
  method: "post",
  path: "/health/{code}/fix",
  tags: ["Engines"],
  summary: "Run the Stack's own fix for one health item",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: HealthCodeParamSchema },
  responses: {
    200: { content: { "application/json": { schema: EngineActionResultSchema } }, description: "Not yet spec'd upstream; passed through as the client returns it." },
    ...errorResponses({ 403: "Not owner/admin" }),
    ...STACK_ERROR_RESPONSES,
  },
});
enginesRoutes.openapi(healthFixRoute, async (c) => {
  const { code } = c.req.valid("param");
  try {
    return c.json(await getStackClient().healthFix(code), 200);
  } catch (err) {
    const failure = classifyStackError(err);
    return c.json(failure.body, failure.status);
  }
});

// The three routes below delegate to lib/stackUpdates.ts rather than
// calling getStackClient() directly - the exact same functions
// routes/updates.ts's own `/stack/*` routes already call, so there is
// one path to "apply an engine update," not two that could drift. Their
// failure shape is therefore that file's own coarse
// `{ok:false, status:503, error}` (stackFailureResult() folds every
// StackError kind into one "model unavailable" 503, since these calls
// also raise/resolve the same Repairs entry updates.ts's routes do) -
// not this file's own finer-grained classifyStackError().
const updatesRoute = createRoute({
  method: "get",
  path: "/updates",
  tags: ["Engines"],
  summary: "The Stack's own engine/model update state",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: StackUpdatesSchema } }, description: "The last known state - does not itself check the Catalog." },
    ...errorResponses({ 403: "Not owner/admin", 503: "The Stack did not answer" }),
  },
});
enginesRoutes.openapi(updatesRoute, async (c) => {
  const result = await getStackUpdatesState();
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ checksEnabled: result.value.checksEnabled, engines: result.value.engines, models: result.value.models }, 200);
});

const updatesCheckRoute = createRoute({
  method: "post",
  path: "/updates/check",
  tags: ["Engines"],
  summary: "Ask the Stack to read the Catalog index now",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: StackUpdatesSchema } }, description: "The state after the check." },
    ...errorResponses({ 403: "Not owner/admin", 503: "The Stack did not answer" }),
  },
});
enginesRoutes.openapi(updatesCheckRoute, async (c) => {
  const result = await checkStackUpdates();
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ checksEnabled: result.value.checksEnabled, engines: result.value.engines, models: result.value.models }, 200);
});

const UpdateActionParamsSchema = z.object({
  name: z.string().openapi({ param: { name: "name", in: "path" }, example: "llama-server" }),
  action: z.enum(["apply", "rollback"]).openapi({ param: { name: "action", in: "path" } }),
});
const UpdateActionBodySchema = z.object({ tag: z.string().optional().openapi({ description: "Required for rollback; ignored for apply." }) });

const updatesActionRoute = createRoute({
  method: "post",
  path: "/updates/{name}/{action}",
  tags: ["Engines"],
  summary: "Apply the Stack's available engine build, or roll back to an installed one",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: UpdateActionParamsSchema, body: { content: { "application/json": { schema: UpdateActionBodySchema } } } },
  responses: {
    200: { content: { "application/json": { schema: z.union([StackEngineApplyResultSchema, StackEngineRollbackResultSchema]) } }, description: "What changed." },
    ...errorResponses({ 400: "A rollback with no tag", 403: "Not owner/admin", 503: "The Stack did not answer, or the swap failed and was rolled back" }),
  },
});
enginesRoutes.openapi(updatesActionRoute, async (c) => {
  const { name, action } = c.req.valid("param");
  const { tag } = c.req.valid("json");
  if (action === "rollback") {
    if (!tag) return c.json({ error: "tag is required to roll back" }, 400);
    const result = await rollbackStackEngine(name, tag);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.value, 200);
  }
  const result = await applyStackEngineUpdate(name);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});

const settingsRoute = createRoute({
  method: "get",
  path: "/settings",
  tags: ["Engines"],
  summary: "The Stack's own settings",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: SettingsResponseSchema } }, description: "Every stack-owned setting, current and pending values." },
    ...errorResponses({ 403: "Not owner/admin" }),
    ...STACK_ERROR_RESPONSES,
  },
});
enginesRoutes.openapi(settingsRoute, async (c) => {
  try {
    return c.json(await getStackClient().settings(), 200);
  } catch (err) {
    const failure = classifyStackError(err);
    return c.json(failure.body, failure.status);
  }
});

const settingsApplyRoute = createRoute({
  method: "post",
  path: "/settings/apply",
  tags: ["Engines"],
  summary: "Apply one or more of the Stack's own settings",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: SettingsApplyBodySchema } } } },
  responses: {
    200: { content: { "application/json": { schema: SettingsResponseSchema } }, description: "The settings state after applying." },
    ...errorResponses({ 403: "Not owner/admin" }),
    ...STACK_ERROR_RESPONSES,
  },
});
enginesRoutes.openapi(settingsApplyRoute, async (c) => {
  const values = c.req.valid("json");
  try {
    return c.json(await getStackClient().applySettings(values), 200);
  } catch (err) {
    const failure = classifyStackError(err);
    return c.json(failure.body, failure.status);
  }
});

// Registered last, not right after GET /hardware: `/{name}/{action}` is
// a two-segment path shape identical to the literal `/updates/check`
// and `/settings/apply` above - Hono's router matches by registration
// order among same-shaped patterns, so a two-segment catch-all
// registered earlier silently swallowed both (found live: `POST
// /api/engines/updates/check` 400'd with "expected one of
// start|stop|restart|install", the engine-action route's own
// validation error). Registering every literal path first, this one
// last, is the whole fix; nothing else about the route changes.
const EngineActionParamsSchema = z.object({
  name: z.string().openapi({ param: { name: "name", in: "path" }, example: "llama-server" }),
  action: z.enum(["start", "stop", "restart", "install"]).openapi({ param: { name: "action", in: "path" } }),
});

const engineActionRoute = createRoute({
  method: "post",
  path: "/{name}/{action}",
  tags: ["Engines"],
  summary: "Start, stop, restart or install one engine",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: EngineActionParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: EngineActionResultSchema } }, description: "Not yet spec'd upstream; passed through as the client returns it." },
    ...errorResponses({ 403: "Not owner/admin" }),
    ...STACK_ERROR_RESPONSES,
  },
});
enginesRoutes.openapi(engineActionRoute, async (c) => {
  const { name, action } = c.req.valid("param");
  try {
    return c.json(await getStackClient().engineAction(name, action), 200);
  } catch (err) {
    const failure = classifyStackError(err);
    return c.json(failure.body, failure.status);
  }
});
