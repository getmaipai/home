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
import { listIssues, fixIssue, dismissIssue, raiseIssue, resolveIssue } from "@/lib/issues";
import { syncStackHealthIssues } from "@/lib/stackHealthSync";
import { syncLicenceIssue } from "@/lib/licenceRepair";
import { Issue } from "@maipai/spec/gen/ts/issue.js";
import { runSetupChecks, healthItems, type SetupCheck } from "@/setup/checks/checks";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getSetupState } from "@/lib/setupState";

export const repairsRoutes = apiRouter();
let setupChecksRunner: () => Promise<SetupCheck[]> = () => runSetupChecks();
export function __setRepairsSetupChecksRunnerForTests(runner: (() => Promise<SetupCheck[]>) | null): void {
  setupChecksRunner = runner ?? (() => runSetupChecks());
}

const reviewRoute = createRoute({
  method: "get", path: "/review", tags: ["Repairs"], summary: "Read setup choices for review",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ engine: z.unknown(), checks: z.array(z.object({ id: z.string(), title: z.string(), state: z.enum(["green", "amber", "red", "idle"]), text: z.string() })) }) } }, description: "Current setting values and saved check rows." }, ...errorResponses({ 403: "Not owner/admin" }) },
});
repairsRoutes.openapi(reviewRoute, (c) => {
  const state = getSetupState();
  return c.json({ engine: getHouseholdSettingValue("engines.stack.where") ?? state.engine.where, checks: state.checks.map((item) => ({ id: item.code.replace(/^setup\./, ""), title: item.title, state: item.severity === "error" ? "red" as const : item.severity === "warning" ? "amber" as const : "green" as const, text: item.text })) }, 200);
});

const checksRoute = createRoute({
  method: "post", path: "/checks", tags: ["Repairs"], summary: "Check computers again",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.array(z.object({ id: z.string(), title: z.string(), state: z.enum(["green", "amber", "red", "idle"]), text: z.string() })) } }, description: "New checks and matching Health issues." }, ...errorResponses({ 403: "Not owner/admin" }) },
});
repairsRoutes.openapi(checksRoute, async (c) => {
  const rows = await setupChecksRunner();
  const items = healthItems(rows);
  const byCode = new Map(items.map((item) => [item.code, item]));
  const seen = new Set(rows.map((row) => `setup.${row.id}`));
  for (const row of rows) {
    const code = `setup.${row.id}`;
    const item = byCode.get(code);
    if (item) await raiseIssue({ source: "setup", key: code, severity: item.severity === "critical" ? "error" : item.severity, title: item.title, detail: item.text, fix: item.fix ? { label: item.fix.label, action: item.fix.action } : null });
    else if (row.state === "green" || row.state === "idle") resolveIssue("setup", code);
  }
  for (const issue of listIssues()) if (issue.source === "setup" && issue.key.startsWith("setup.") && !seen.has(issue.key)) resolveIssue("setup", issue.key);
  return c.json(rows.map(({ id, title, state, text }) => ({ id, title, state, text })), 200);
});

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
repairsRoutes.openapi(listRoute, async (c) => {
  await syncStackHealthIssues();
  await syncLicenceIssue().catch(() => undefined);
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
