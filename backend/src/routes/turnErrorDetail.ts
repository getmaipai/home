// THIN-1E (rule 6): the admin's read of a failed turn's raw details, the
// one place they leave the hub besides the admin's own stream error event. Owner/admin only, like the other
// machine-internal reads (performance.ts); lib/turnErrorDetail.ts reads
// the stored turn row and redacts credentials.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { canAccessPerson } from "@/lib/access";
import { canReadErrorDetail, missingTurnErrorDetail, turnErrorDetail, turnOwnerId } from "@/lib/turnErrorDetail";

export const turnErrorDetailRoutes = apiRouter();

const DetailSchema = z.object({
  turn_id: z.string(),
  found: z.boolean(),
  advice: z.object({ cause: z.string(), next_step: z.string(), repairs: z.boolean() }).optional(),
  tools: z.array(z.object({
    tool_id: z.string(),
    call_id: z.string(),
    kind: z.enum(["unavailable", "timed_out", "found_nothing", "errored", "bad_arguments"]),
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
    http_status: z.number().optional(),
    state: z.string().optional(),
    raw_body: z.string().optional(),
    engine_id: z.string().optional(),
    model_id: z.string().optional(),
    failed_ms: z.number().optional(),
    failed_at: z.string().optional(),
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
    200: { content: { "application/json": { schema: DetailSchema } }, description: "The stored detail, credentials redacted; empty lists when nothing failed; `found: false` when no row was stored for the turn." },
    ...errorResponses({ 403: "Not owner/admin" }),
  },
});

turnErrorDetailRoutes.openapi(getRoute, (c) => {
  // requireRole matches the role alone; a minor-aged admin record still reads nothing.
  if (!canReadErrorDetail(c.get("person"))) return c.json({ error: "Forbidden" }, 403);
  const turnId = c.req.valid("param").id;
  // An admin reaches only the turns of people an admin may reach (never a teen's or another adult's).
  const ownerId = turnOwnerId(turnId);
  if (ownerId && !canAccessPerson(c.get("person"), ownerId)) return c.json({ error: "Forbidden" }, 403);
  // CHAT-CALM-ERRORS-01b: a turn with no stored row (a temporary chat, a
  // turn that stopped before it was logged) is reported as such, never as
  // a failed read; the id alone reveals nothing an admin could not send.
  return c.json(turnErrorDetail(turnId) ?? missingTurnErrorDetail(turnId), 200);
});
