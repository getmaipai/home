// CANARY-01: the Status page's "Last checked" row and the admin "Run checks now" button.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { canaryStatus, runNow } from "@/lib/canary/runner";
import { realDeps } from "@/lib/canary/probes";

export const canaryRoutes = apiRouter();

const Status = z.object({
  running: z.boolean(),
  last_checked_at: z.string().nullable(),
  groups: z.array(z.object({ group: z.enum(["chat", "tools", "search", "voice", "pictures"]), label: z.string(), state: z.enum(["pass", "fail", "unknown"]) })),
  checks: z.array(z.object({
    id: z.string(), name: z.string(), group: z.enum(["chat", "tools", "search", "voice", "pictures"]),
    state: z.enum(["pass", "fail", "skipped", "unknown"]), at: z.string().nullable(), duration_ms: z.number().nullable(), first_token_ms: z.number().nullable(), note: z.string().nullable(),
  })),
});

const statusRoute = createRoute({
  method: "get", path: "/", tags: ["Status"], summary: "Read the latest health check results",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: Status } }, description: "Pass or fail per group, and per check." }, ...errorResponses({ 401: "Not signed in", 403: "Owner or admin only" }) },
});
canaryRoutes.openapi(statusRoute, (c) => c.json(canaryStatus(), 200));

const RunInput = z.object({ include_search: z.boolean().optional(), include_picture: z.boolean().optional() });
const runRoute = createRoute({
  method: "post", path: "/run", tags: ["Status"], summary: "Run the health checks now",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: RunInput } }, required: false } },
  responses: {
    200: { content: { "application/json": { schema: Status } }, description: "The results after the run." },
    409: { description: "A run is already going, or one just finished." },
    ...errorResponses({ 401: "Not signed in", 403: "Owner or admin only" }),
  },
});
canaryRoutes.openapi(runRoute, async (c) => {
  const body = await c.req.json().catch(() => ({})) as { include_search?: boolean; include_picture?: boolean };
  const run = await runNow(realDeps, { includeSearch: body.include_search === true, includeImage: body.include_picture === true });
  if (!run.ok) return c.json({ error: run.reason === "busy" ? "The checks are already running." : "The checks just ran. Wait half a minute and try again." }, 409);
  return c.json(canaryStatus(), 200);
});
