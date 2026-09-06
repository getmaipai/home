import { Hono } from "hono";
import { requireRole } from "@/middleware/auth";
import { listIssues, fixIssue, dismissIssue, type IssueOpResult } from "@/lib/issues";
import type { AppEnv } from "@/types";

export const repairsRoutes = new Hono<AppEnv>();

function fail<T>(result: Extract<IssueOpResult<T>, { ok: false }>) {
  return { body: { error: result.error }, status: result.status } as const;
}

// Owner/admin only, the same gate backups.ts uses: Health/Repairs spans
// the whole household's hub, not any one person's own data.
repairsRoutes.get("/", requireRole("owner", "admin"), (c) => {
  const includeResolved = c.req.query("include_resolved") === "true";
  return c.json(listIssues({ includeResolved }));
});

repairsRoutes.post("/:id/fix", requireRole("owner", "admin"), async (c) => {
  const result = await fixIssue(c.req.param("id"));
  if (!result.ok) {
    const { body, status } = fail(result);
    return c.json(body, status);
  }
  return c.json(result.value);
});

repairsRoutes.post("/:id/dismiss", requireRole("owner", "admin"), (c) => {
  const result = dismissIssue(c.req.param("id"));
  if (!result.ok) {
    const { body, status } = fail(result);
    return c.json(body, status);
  }
  return c.json(result.value);
});
