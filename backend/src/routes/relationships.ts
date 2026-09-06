// Step 7: the Relationship half of chapter 3. Writes go through
// requireRoleOrGrant(["owner","admin"], "relationships.manage") - the
// grant vocabulary's own relationships.manage exists for exactly this,
// so a household can let e.g. an adult state relationships without
// making them an admin. Reads stay requireAuth: seeing who's who is not
// the sensitive half, stating or correcting it is.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth, requireRoleOrGrant } from "@/middleware/auth";
import { listRelationships, createRelationship, updateRelationship, deleteRelationship } from "@/lib/relationships";
import { Relationship } from "@maipai/spec/gen/ts/relationship.js";

export const relationshipsRoutes = apiRouter();

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Relationships"],
  summary: "Relationships the household (or just me) has stated",
  middleware: [requireAuth] as const,
  request: { query: z.object({ entityId: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.array(Relationship) } }, description: "Both directions of every edge this actor may see." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
relationshipsRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const { entityId } = c.req.valid("query");
  return c.json(listRelationships(actor, entityId), 200);
});

const createRoute_ = createRoute({
  method: "post",
  path: "/",
  tags: ["Relationships"],
  summary: "State a relationship between two entities",
  middleware: [requireRoleOrGrant(["owner", "admin"], "relationships.manage")] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            type: z.string(),
            from_id: z.string(),
            to_id: z.string(),
            status: z.string().optional(),
            valid_from: z.string().nullable().optional(),
            valid_to: z.string().nullable().optional(),
            note: z.string().nullable().optional(),
            scope: z.enum(["household", "person"]).optional(),
            person: z.string().nullable().optional(),
            sensitive: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { content: { "application/json": { schema: Relationship } }, description: "Stated. Its inverse edge (parent_of alongside child_of) is stored automatically." },
    ...errorResponses({ 400: "Invalid relationship, or an unknown type/entity", 403: "Not allowed to state relationships" }),
  },
});
relationshipsRoutes.openapi(createRoute_, (c) => {
  const actor = c.get("person");
  const result = createRelationship(actor, c.req.valid("json"));
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "invalid relationship" }, 400);
  return c.json(result.value, 201);
});

const patchRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Relationships"],
  summary: "End or requalify a relationship (never re-type or re-point it)",
  middleware: [requireRoleOrGrant(["owner", "admin"], "relationships.manage")] as const,
  request: {
    params: idParamSchema("id", "rel-a1b2c3"),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            status: z.string().optional(),
            valid_to: z.string().nullable().optional(),
            note: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: Relationship } }, description: "Updated, along with its stored inverse." },
    ...errorResponses({ 400: "Invalid edit", 403: "Not allowed to edit relationships", 404: "No such relationship" }),
  },
});
relationshipsRoutes.openapi(patchRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const result = updateRelationship(actor, id, c.req.valid("json"));
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "invalid edit" }, result.status === 404 ? 404 : 400);
  return c.json(result.value, 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Relationships"],
  summary: "Remove a relationship and its stored inverse",
  middleware: [requireRoleOrGrant(["owner", "admin"], "relationships.manage")] as const,
  request: { params: idParamSchema("id", "rel-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Removed." },
    ...errorResponses({ 403: "Not allowed to remove relationships", 404: "No such relationship" }),
  },
});
relationshipsRoutes.openapi(deleteRoute, (c) => {
  const actor = c.get("person");
  const result = deleteRelationship(actor, c.req.valid("param").id);
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "no such relationship" }, 404);
  return c.json(result.value, 200);
});
