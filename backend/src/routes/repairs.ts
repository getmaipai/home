// Session F, step 4: the worked @hono/zod-openapi example other sessions
// copy (docs/dev/session-f.md has the full pattern write-up). The
// shape: apiRouter() instead of new Hono(), createRoute() per endpoint
// (method, path, `middleware` for the existing auth chain unchanged,
// `request`/`responses` schemas), `.openapi(route, handler)` instead of
// `.get/.post(path, middleware, handler)`. Response schemas reuse the
// real generated spec type (`Issue` from @maipai/spec) rather than
// re-describing its shape by hand - the same "one definition" reasoning
// lib/issues.ts's own toIssue() already applies at the lib layer, now
// carried through to the API's own documented shape too.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { listIssues, fixIssue, dismissIssue } from "@/lib/issues";
import { Issue } from "@maipai/spec/gen/ts/issue.js";

export const repairsRoutes = apiRouter();

const IdParamSchema = idParamSchema("id", "issue-a1b2c3");

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Repairs"],
  summary: "List Repairs issues",
  description: "Owner/admin only: Health/Repairs spans the whole household's hub, not any one person's own data.",
  middleware: [requireRole("owner", "admin")] as const,
  request: {
    query: z.object({
      include_resolved: z
        .enum(["true", "false"])
        .optional()
        .openapi({ param: { name: "include_resolved", in: "query" } }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(Issue) } },
      description: "Unresolved-and-undismissed issues by default; every issue ever raised when include_resolved=true.",
    },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});
repairsRoutes.openapi(listRoute, (c) => {
  const includeResolved = c.req.valid("query").include_resolved === "true";
  return c.json(listIssues({ includeResolved }), 200);
});

const fixRoute = createRoute({
  method: "post",
  path: "/{id}/fix",
  tags: ["Repairs"],
  summary: "Run an issue's one-click fix",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/json": { schema: Issue } }, description: "The fix ran and the issue resolved." },
    ...errorResponses({ 400: "This issue has no fix, or no handler is registered for its action", 403: "Not owner/admin", 404: "No such issue" }),
  },
});
repairsRoutes.openapi(fixRoute, async (c) => {
  const result = await fixIssue(c.req.valid("param").id);
  if (!result.ok) {
    return result.status === 400 ? c.json({ error: result.error }, 400) : c.json({ error: result.error }, 404);
  }
  return c.json(result.value, 200);
});

const dismissRoute = createRoute({
  method: "post",
  path: "/{id}/dismiss",
  tags: ["Repairs"],
  summary: "Dismiss an issue without running its fix",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Dismissed." },
    ...errorResponses({ 403: "Not owner/admin", 404: "No such issue" }),
  },
});
repairsRoutes.openapi(dismissRoute, (c) => {
  const result = dismissIssue(c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.value, 200);
});
