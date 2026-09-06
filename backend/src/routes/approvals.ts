// Step 7: "Ask to Install, Ask to Browse". Anyone signed in can ask
// (that's the whole point - a child or teen without the grant to just do
// the thing); deciding is for a grown-up, the same "adults" audience the
// approvals.requested notification already reaches.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { requestApproval, listApprovals, decideApproval } from "@/lib/approvals";

export const approvalsRoutes = apiRouter();

const ApprovalSchema = z.object({
  id: z.string(),
  kind: z.string(),
  personId: z.string(),
  details: z.record(z.string(), z.any()),
  status: z.enum(["pending", "approved", "denied"]),
  decidedByPersonId: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});

const createRoute_ = createRoute({
  method: "post",
  path: "/",
  tags: ["Approvals"],
  summary: "Ask for something I don't have the grant to just do",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ kind: z.string(), details: z.record(z.string(), z.any()).default({}) }),
        },
      },
    },
  },
  responses: {
    201: { content: { "application/json": { schema: ApprovalSchema } }, description: "Asked - every adult in the house is notified." },
    ...errorResponses({ 400: "Unknown approval kind", 401: "Not signed in" }),
  },
});
approvalsRoutes.openapi(createRoute_, async (c) => {
  const actor = c.get("person");
  const { kind, details } = c.req.valid("json");
  const result = await requestApproval(actor, kind, details);
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "invalid approval request" }, 400);
  return c.json(result.value, 201);
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Approvals"],
  summary: "The approval queue - every ask, decided or not",
  middleware: [requireRole("owner", "admin", "adult")] as const,
  request: { query: z.object({ status: z.enum(["pending", "approved", "denied"]).optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.array(ApprovalSchema) } }, description: "Oldest first." },
    ...errorResponses({ 403: "Only an adult decides these" }),
  },
});
approvalsRoutes.openapi(listRoute, (c) => {
  const { status } = c.req.valid("query");
  return c.json(listApprovals(status), 200);
});

function decideRoute(action: "approve" | "deny") {
  return createRoute({
    method: "post",
    path: `/{id}/${action}`,
    tags: ["Approvals"],
    summary: action === "approve" ? "Approve a pending ask" : "Deny a pending ask",
    middleware: [requireRole("owner", "admin", "adult")] as const,
    request: { params: idParamSchema("id", "approval-a1b2c3") },
    responses: {
      200: { content: { "application/json": { schema: ApprovalSchema } }, description: "Decided." },
      ...errorResponses({
        400: "Already decided",
        403: "Only an adult other than the requester decides these",
        404: "No such approval",
      }),
    },
  });
}

function decideStatus(status: 200 | 201 | 400 | 403 | 404): 400 | 403 | 404 {
  if (status === 403) return 403;
  if (status === 404) return 404;
  return 400;
}

approvalsRoutes.openapi(decideRoute("approve"), (c) => {
  const actor = c.get("person");
  const result = decideApproval(actor, c.req.valid("param").id, "approved");
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "could not decide" }, decideStatus(result.status));
  return c.json(result.value, 200);
});

approvalsRoutes.openapi(decideRoute("deny"), (c) => {
  const actor = c.get("person");
  const result = decideApproval(actor, c.req.valid("param").id, "denied");
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "could not decide" }, decideStatus(result.status));
  return c.json(result.value, 200);
});
