// Step 7: Grant - subject/action/effect, never inferred. Writes require
// people.grant specifically (not people.manage): "held apart... editing
// a name and handing out authority are different powers, and the
// second is how a household is taken over" (grant-actions.json's own
// comment on people.grant).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth, requireRoleOrGrant } from "@/middleware/auth";
import { createGrant, listGrants, revokeGrant } from "@/lib/grants";
import { Grant } from "@maipai/spec/gen/ts/grant.js";

export const grantsRoutes = apiRouter();

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Grants"],
  summary: "Grants on my own profile, or (owner/admin/people.grant) on anyone's",
  middleware: [requireAuth] as const,
  request: { query: z.object({ person: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.array(Grant) } }, description: "Every active or expired grant, oldest first." },
    ...errorResponses({ 401: "Not signed in", 403: "Not allowed to see this person's grants" }),
  },
});
grantsRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const { person } = c.req.valid("query");
  const targetId = person ?? actor.id;
  const canSeeOthers = actor.role === "owner" || actor.role === "admin";
  if (targetId !== actor.id && !canSeeOthers) {
    return c.json({ error: "not allowed to see this person's grants" }, 403);
  }
  return c.json(listGrants(targetId), 200);
});

const createRoute_ = createRoute({
  method: "post",
  path: "/",
  tags: ["Grants"],
  summary: "Grant or deny a person one action",
  middleware: [requireRoleOrGrant(["owner", "admin"], "people.grant")] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            person: z.string(),
            action: z.string(),
            effect: z.enum(["allow", "deny"]),
            valid_from: z.string().nullable().optional(),
            valid_to: z.string().nullable().optional(),
            reason: z.string().nullable().optional(),
            acknowledged_at: z.string().nullable().optional(),
            acknowledged_by_person_id: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { content: { "application/json": { schema: Grant } }, description: "Granted." },
    ...errorResponses({ 400: "Unknown action, unknown person, or an invalid grant", 403: "Not allowed to grant" }),
  },
});
grantsRoutes.openapi(createRoute_, (c) => {
  const actor = c.get("person");
  const result = createGrant(actor, c.req.valid("json"));
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "invalid grant" }, 400);
  return c.json(result.value, 201);
});

const revokeRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Grants"],
  summary: "Revoke a grant",
  middleware: [requireRoleOrGrant(["owner", "admin"], "people.grant")] as const,
  request: { params: idParamSchema("id", "grant-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Revoked." },
    ...errorResponses({ 403: "Not allowed to revoke grants", 404: "No such grant" }),
  },
});
grantsRoutes.openapi(revokeRoute, (c) => {
  const result = revokeGrant(c.req.valid("param").id);
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "no such grant" }, 404);
  return c.json(result.value, 200);
});
