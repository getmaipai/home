// Step 7: "anything the household knows about" (Entity, platform plan
// chapter 3) - person/pet/place/organization/thing, NOT an account.
// lib/entities.ts holds the rules; this is only the HTTP boundary.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listEntities, getEntity, createEntity, updateEntity, deleteEntity } from "@/lib/entities";
import { Entity } from "@maipai/spec/gen/ts/entity.js";

export const entitiesRoutes = apiRouter();

const KIND = z.enum(["person", "pet", "place", "organization", "thing"]);
const SCOPE = z.enum(["household", "person"]);

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Entities"],
  summary: "Everything the household (or, filtered, just me) knows about",
  middleware: [requireAuth] as const,
  request: { query: z.object({ kind: KIND.optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.array(Entity) } }, description: "Household-scoped entities, plus this person's own person-scoped ones." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
entitiesRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const { kind } = c.req.valid("query");
  return c.json(listEntities(actor, kind), 200);
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Entities"],
  summary: "One entity",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "ent-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: Entity } }, description: "Found." },
    ...errorResponses({ 401: "Not signed in", 404: "No such entity" }),
  },
});
entitiesRoutes.openapi(getRoute, (c) => {
  const actor = c.get("person");
  const result = getEntity(actor, c.req.valid("param").id);
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "no such entity" }, 404);
  return c.json(result.value, 200);
});

const createRoute_ = createRoute({
  method: "post",
  path: "/",
  tags: ["Entities"],
  summary: "Add an entity the household (or just me) knows about",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            kind: KIND,
            name: z.string().min(1).max(200),
            aliases: z.array(z.string().min(1).max(200)).optional(),
            description: z.string().nullable().optional(),
            place_kind: z.enum(["map", "area"]).nullable().optional(),
            parent_id: z.string().nullable().optional(),
            account_person_id: z.string().nullable().optional(),
            scope: SCOPE.optional(),
            person: z.string().nullable().optional(),
            sensitive: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { content: { "application/json": { schema: Entity } }, description: "Created." },
    ...errorResponses({ 400: "Invalid entity", 401: "Not signed in" }),
  },
});
entitiesRoutes.openapi(createRoute_, (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const result = createEntity(actor, body);
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "invalid entity" }, 400);
  return c.json(result.value, 201);
});

const patchRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Entities"],
  summary: "Edit an entity's name, aliases, description, containment, or sensitivity",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "ent-a1b2c3"),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).max(200).optional(),
            aliases: z.array(z.string().min(1).max(200)).optional(),
            description: z.string().nullable().optional(),
            parent_id: z.string().nullable().optional(),
            sensitive: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: Entity } }, description: "Updated." },
    ...errorResponses({ 400: "Invalid edit", 401: "Not signed in", 404: "No such entity" }),
  },
});
entitiesRoutes.openapi(patchRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const result = updateEntity(actor, id, c.req.valid("json"));
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "invalid edit" }, result.status === 404 ? 404 : 400);
  return c.json(result.value, 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Entities"],
  summary: "Remove an entity",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "ent-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Removed." },
    ...errorResponses({ 401: "Not signed in", 404: "No such entity" }),
  },
});
entitiesRoutes.openapi(deleteRoute, (c) => {
  const actor = c.get("person");
  const result = deleteEntity(actor, c.req.valid("param").id);
  if (!result.ok || !result.value) return c.json({ error: result.error ?? "no such entity" }, 404);
  return c.json(result.value, 200);
});
