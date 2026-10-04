// THIN-1E (rule 6): the admin's read of a failed turn's raw details, the
// one place they leave the hub. Owner/admin only, like the other
// machine-internal reads (performance.ts); lib/turnErrorDetail.ts reads
// the stored turn row and redacts credentials.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { canAccessPerson } from "@/lib/access";
import { canReadErrorDetail, turnErrorDetail, turnOwnerId } from "@/lib/turnErrorDetail";

export const turnErrorDetailRoutes = apiRouter();

const DetailSchema = z.object({
  turn_id: z.string(),
  tools: z.array(z.object({
    tool_id: z.string(),
    call_id: z.string(),
    kind: z.enum(["unavailable", "timed_out", "found_nothing", "errored"]),
    error_code: z.string().optional(),
    error_text: z.string().optional(),
    at: z.string().optional(),
    duration_ms: z.number().optional(),
  })),
  generations: z.array(z.object({
    reason: z.string(),
    error: z.string(),
    request_sent_ms: z.number(),
    offline_reason: z.string().optional(),
  })),
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["turn"],
  summary: "The raw error detail of a turn whose tool call or generation failed (owner/admin only)",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: DetailSchema } }, description: "The stored detail, credentials redacted; empty lists when nothing failed." },
    ...errorResponses({ 403: "Not owner/admin", 404: "No such turn" }),
  },
});

turnErrorDetailRoutes.openapi(getRoute, (c) => {
  // requireRole matches the role alone; a minor-aged admin record still reads nothing.
  if (!canReadErrorDetail(c.get("person"))) return c.json({ error: "Forbidden" }, 403);
  const turnId = c.req.valid("param").id;
  // An admin reaches only the turns of people an admin may reach (never a teen's or another adult's).
  const ownerId = turnOwnerId(turnId);
  if (ownerId && !canAccessPerson(c.get("person"), ownerId)) return c.json({ error: "Forbidden" }, 403);
  const detail = turnErrorDetail(turnId);
  if (!detail) return c.json({ error: "Not found" }, 404);
  return c.json(detail, 200);
});
