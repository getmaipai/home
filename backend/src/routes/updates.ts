// Step 10: the updates projection (app only - see lib/updates.ts's own
// header for scope and why packages/models/sidecars aren't here).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRoleOrGrant } from "@/middleware/auth";
import { cachedUpdateProjection, checkForAppUpdate } from "@/lib/updates";
import { isStackConfigured } from "@/lib/stackEngine";
import { getStackUpdatesState, checkStackUpdates, applyStackEngineUpdate, rollbackStackEngine, sweepStackStorage, runStackReadinessCheck } from "@/lib/stackUpdates";

export const updatesRoutes = apiRouter();

const UpdateAssetSchema = z.object({ name: z.string(), url: z.string(), digest: z.string().nullable() });
const UpdateProjectionSchema = z.object({
  installed: z.string(),
  latest: z.string().nullable(),
  summary: z.string().nullable(),
  url: z.string().nullable(),
  assets: z.array(UpdateAssetSchema),
  channel: z.literal("stable"),
  progress: z.null(),
  needs: z.array(z.string()),
  blockedBy: z.string().nullable(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
});

// HOME-STACK-05: the Stack's own engine/model rows, read through when
// engines.stack.url is configured - null otherwise (the flag this
// whole item is gated on, org-wide "nothing changes when it's empty").
const StackEngineUpdateSchema = z.object({ name: z.string(), installed: z.string().nullable(), available: z.string().nullable(), availableKnown: z.boolean(), lastChecked: z.string().nullable(), notes: z.string().nullable() });
const StackModelUpdateSchema = z.object({ id: z.string(), installed: z.string(), available: z.string().nullable() });
const StackUpdatesSchema = z.object({
  checksEnabled: z.boolean(),
  engines: z.array(StackEngineUpdateSchema),
  models: z.object({ lastChecked: z.string().nullable(), entries: z.array(StackModelUpdateSchema) }),
});
// Additive to the existing flat UpdateProjectionSchema shape (org
// CLAUDE.md > Compatibility: never repurpose a field a client relies
// on) - every pre-existing field stays exactly where it was; `stack` is
// new and null for every household without one, which is every
// household today.
// stackError is additive too: null whenever stack itself is non-null,
// or when there's simply no Stack configured; set only when a Stack IS
// configured but the read failed, so the page can say why the section
// is missing instead of looking like there was never a Stack at all.
const UpdatesResponseSchema = UpdateProjectionSchema.extend({ stack: StackUpdatesSchema.nullable(), stackError: z.string().nullable() });

// Every signed-in person can see whether an update is available -
// informational, the same reach GET /api/health already has.
const getRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Updates"],
  summary: "The last known update check result (app, plus the Stack's when configured)",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: UpdatesResponseSchema } }, description: "app is cached (does not itself call GitHub); stack is a live read, null when no Stack is configured." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
updatesRoutes.openapi(getRoute, async (c) => {
  const app = cachedUpdateProjection();
  if (!isStackConfigured()) return c.json({ ...app, stack: null, stackError: null }, 200);
  const stack = await getStackUpdatesState();
  if (!stack.ok) return c.json({ ...app, stack: null, stackError: stack.error }, 200);
  return c.json({ ...app, stack: { checksEnabled: stack.value.checksEnabled, engines: stack.value.engines, models: stack.value.models }, stackError: null }, 200);
});

// Owner/admin (or a backups.run grant, the closest existing action to
// "routine maintenance click") may force a fresh check rather than
// waiting for the daily job - a real network call, so narrower than the
// read above.
const checkRoute = createRoute({
  method: "post",
  path: "/check",
  tags: ["Updates"],
  summary: "Check GitHub for a new release right now",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: UpdateProjectionSchema } }, description: "The fresh result." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
updatesRoutes.openapi(checkRoute, async (c) => c.json(await checkForAppUpdate(), 200));

const nameParamSchema = z.object({ name: z.string().openapi({ param: { name: "name", in: "path" }, example: "llama-server" }) });

const stackCheckRoute = createRoute({
  method: "post",
  path: "/stack/check",
  tags: ["Updates"],
  summary: "Ask the Stack to read the Catalog index now",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: StackUpdatesSchema } }, description: "The state after the check." },
    ...errorResponses({ 403: "Not owner/admin", 503: "The Stack did not answer" }),
  },
});
updatesRoutes.openapi(stackCheckRoute, async (c) => {
  const result = await checkStackUpdates();
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ checksEnabled: result.value.checksEnabled, engines: result.value.engines, models: result.value.models }, 200);
});

const stackApplyRoute = createRoute({
  method: "post",
  path: "/stack/engines/{name}/apply",
  tags: ["Updates"],
  summary: "Stage, drain, swap and check the Stack's available engine build",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  request: { params: nameParamSchema },
  responses: {
    200: { content: { "application/json": { schema: z.object({ applied: z.boolean(), tag: z.string().nullable(), previous: z.string().nullable() }) } }, description: "What changed." },
    ...errorResponses({ 403: "Not owner/admin", 503: "The Stack did not answer, or the swap failed and was rolled back" }),
  },
});
updatesRoutes.openapi(stackApplyRoute, async (c) => {
  const result = await applyStackEngineUpdate(c.req.valid("param").name);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});

const stackRollbackRoute = createRoute({
  method: "post",
  path: "/stack/engines/{name}/rollback",
  tags: ["Updates"],
  summary: "Go back to an installed engine build",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  request: { params: nameParamSchema, body: { content: { "application/json": { schema: z.object({ tag: z.string() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.literal(true), tag: z.string() }) } }, description: "Rolled back." },
    ...errorResponses({ 403: "Not owner/admin", 503: "The Stack did not answer, or the tag is not installed" }),
  },
});
updatesRoutes.openapi(stackRollbackRoute, async (c) => {
  const { name } = c.req.valid("param");
  const { tag } = c.req.valid("json");
  const result = await rollbackStackEngine(name, tag);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});

const stackSweepRoute = createRoute({
  method: "post",
  path: "/stack/sweep",
  tags: ["Updates"],
  summary: "Prune the Stack's orphaned blobs past their grace period",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ removed: z.array(z.string()) }) } }, description: "The digests removed." },
    ...errorResponses({ 403: "Not owner/admin", 503: "The Stack did not answer" }),
  },
});
updatesRoutes.openapi(stackSweepRoute, async (c) => {
  const result = await sweepStackStorage();
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});

const stackReadinessCheckRoute = createRoute({
  method: "post",
  path: "/stack/readiness-check",
  tags: ["Updates"],
  summary: "Run the Stack's readiness check now",
  middleware: [requireRoleOrGrant(["owner", "admin"], "backups.run")] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ at: z.string(), ok: z.boolean(), reason: z.string().nullable() }) } }, description: "The run's headline result." },
    ...errorResponses({ 403: "Not owner/admin", 503: "The Stack did not answer" }),
  },
});
updatesRoutes.openapi(stackReadinessCheckRoute, async (c) => {
  const result = await runStackReadinessCheck();
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ at: result.value.at, ok: result.value.ok, reason: result.value.reason }, 200);
});
