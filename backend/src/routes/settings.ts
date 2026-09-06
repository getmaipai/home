import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listValues, setValue, resetValue } from "@/lib/settings";
import { getRegistry } from "@/lib/settingsRegistry";
import { issueApiToken, revokeApiToken } from "@/lib/apiToken";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const settingsRoutes = apiRouter();

// `value` is genuinely arbitrary JSON (its real shape depends on the
// key's selector in the registry, validated at the lib layer, not by
// this schema) - `z.unknown()` documents that honestly rather than
// pretending a narrower type.
const ResolvedSettingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.enum(["user", "default", "package", "sync"]),
  label: z.string(),
  help: z.string().optional(),
  level: z.enum(["basic", "advanced", "expert"]),
  secret: z.boolean(),
  isSet: z.boolean().optional(),
});

// The registry itself: declarative metadata (labels, defaults, help), not
// a person's data. Gated behind sign-in for consistency with the rest of
// the API rather than any real sensitivity concern.
const registryRoute = createRoute({
  method: "get",
  path: "/registry",
  tags: ["Settings"],
  summary: "Every declared settings key's metadata",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(SettingsKey) } }, description: "The full registry." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
settingsRoutes.openapi(registryRoute, (c) => c.json(getRegistry(), 200));

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Settings"],
  summary: "Resolved settings values for a scope",
  middleware: [requireAuth] as const,
  request: {
    query: z.object({
      scope: z.string().openapi({ param: { name: "scope", in: "query" }, example: "household" }),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: z.array(ResolvedSettingSchema) } }, description: "Every key resolved for this scope." },
    ...errorResponses({ 400: "Invalid scope, or scope is missing", 401: "Not signed in", 403: "Not allowed to read this scope" }),
  },
});
settingsRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const result = listValues(actor, c.req.valid("query").scope);
  // A code review (2026-09-06) found a "settingsErrorResponse(result)"
  // helper here that every call site immediately destructured back into
  // an identical c.json(...) call - pure indirection removed in favor of
  // this direct ternary, which type-checks the same way
  // lib/openapi.ts's errorResponses() comment already explains (the
  // literal status resolves per-branch either way).
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  return c.json(result.value, 200);
});

const putRoute = createRoute({
  method: "put",
  path: "/",
  tags: ["Settings"],
  summary: "Set one settings value",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ scope: z.string(), key: z.string(), value: z.unknown() }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: ResolvedSettingSchema } }, description: "The value as stored." },
    ...errorResponses({ 400: "Invalid scope/key/value, or a newer value already exists", 401: "Not signed in", 403: "Not allowed to write this scope" }),
  },
});
settingsRoutes.openapi(putRoute, (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  if (body.value === undefined) return c.json({ error: "scope, key, and value are required" }, 400);
  const result = setValue(actor, body.scope, body.key, body.value);
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  return c.json(result.value, 200);
});

const resetRoute = createRoute({
  method: "post",
  path: "/reset",
  tags: ["Settings"],
  summary: "Reset one settings value to its default",
  middleware: [requireAuth] as const,
  request: {
    body: { content: { "application/json": { schema: z.object({ scope: z.string(), key: z.string() }) } } },
  },
  responses: {
    // `success: true` was this route's whole response body before the
    // richer ResolvedSetting body landed; a code review (2026-09-04)
    // flagged replacing it outright as a repurposed field under
    // CLAUDE.md > Compatibility's "API changes are additive" rule (no
    // current caller reads it, but the rule exists for the clients that
    // will) - kept alongside the richer body rather than dropped, so the
    // schema below is the ResolvedSetting shape plus that one extra field.
    200: {
      content: { "application/json": { schema: ResolvedSettingSchema.extend({ success: z.literal(true) }) } },
      description: "Reset to default.",
    },
    ...errorResponses({ 400: "Invalid scope/key", 401: "Not signed in", 403: "Not allowed to write this scope" }),
  },
});
settingsRoutes.openapi(resetRoute, (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const result = resetValue(actor, body.scope, body.key);
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 403);
  }
  return c.json({ ...result.value, success: true as const }, 200);
});

// Session C step 8 (session-c-brain-and-voice.md): the interim per-person
// API token (lib/apiToken.ts's own header has the full reasoning) that
// authenticates POST /v1/chat/completions and the Wyoming satellite
// server until F's real device tokens (session-f-platform-and-trust.md
// step 6) land. Not modeled as a settings key despite the plan's own
// "API token setting" phrasing: a settings value round-trips (readable
// back through GET), which is exactly wrong for a bearer credential -
// this generates and returns the raw token EXACTLY ONCE, the same
// personal-access-token UX every service with this kind of credential
// uses, and never again after that.
const apiTokenGenerateRoute = createRoute({
  method: "post",
  path: "/api-token",
  tags: ["Settings"],
  summary: "Generate a new API token for the signed-in person, replacing any existing one",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ token: z.string() }) } },
      description: "The raw token - shown exactly once. It cannot be retrieved again; generate a new one to rotate.",
    },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
settingsRoutes.openapi(apiTokenGenerateRoute, (c) => {
  const actor = c.get("person");
  return c.json({ token: issueApiToken(actor.id) }, 200);
});

const apiTokenRevokeRoute = createRoute({
  method: "delete",
  path: "/api-token",
  tags: ["Settings"],
  summary: "Revoke the signed-in person's API token, if one exists",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Revoked (or there was none)." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
settingsRoutes.openapi(apiTokenRevokeRoute, (c) => {
  const actor = c.get("person");
  revokeApiToken(actor.id);
  return c.json({ success: true as const }, 200);
});
