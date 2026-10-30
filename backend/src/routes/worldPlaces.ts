import { createRoute, z } from "@hono/zod-openapi";
import { WorldPlace } from "@maipai/spec/gen/ts/world-place.js";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { createWorldPlace, deleteWorldPlace, listWorldPlaces, updateWorldPlace } from "@/lib/worldPlaces";

export const worldPlacesRoutes = apiRouter();

const edit = z.object({
  name: z.string().optional(),
  country: z.string().optional(),
  zone: z.string().optional(),
  position: z.number().int().min(0).optional(),
  source: z.enum(["hub", "local"]).optional(),
});

const list = createRoute({
  method: "get",
  path: "/",
  tags: ["World places"],
  summary: "List my world places",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(WorldPlace) } }, description: "Places" },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
worldPlacesRoutes.openapi(list, (c) => c.json(listWorldPlaces(c.get("person")), 200));

const create = createRoute({
  method: "post",
  path: "/",
  tags: ["World places"],
  summary: "Add a world place",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: edit } } } },
  responses: {
    201: { content: { "application/json": { schema: WorldPlace } }, description: "Created" },
    ...errorResponses({ 400: "Invalid place", 401: "Not signed in" }),
  },
});
worldPlacesRoutes.openapi(create, (c) => {
  const result = createWorldPlace(c.get("person"), c.req.valid("json"));
  return result.ok ? c.json(result.value, 201) : c.json({ error: result.error }, 400);
});

const patch = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["World places"],
  summary: "Update my world place",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "place-abcdef"),
    body: { content: { "application/json": { schema: edit } } },
  },
  responses: {
    200: { content: { "application/json": { schema: WorldPlace } }, description: "Updated" },
    ...errorResponses({ 400: "Invalid place", 401: "Not signed in", 404: "No such place" }),
  },
});
worldPlacesRoutes.openapi(patch, (c) => {
  const result = updateWorldPlace(c.get("person"), c.req.valid("param").id, c.req.valid("json"));
  return result.ok ? c.json(result.value, 200) : c.json({ error: result.error }, result.status);
});

const del = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["World places"],
  summary: "Delete my world place",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "place-abcdef") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Deleted" },
    ...errorResponses({ 401: "Not signed in", 404: "No such place" }),
  },
});
worldPlacesRoutes.openapi(del, (c) => {
  const result = deleteWorldPlace(c.get("person"), c.req.valid("param").id);
  return result.ok ? c.json(result.value, 200) : c.json({ error: result.error }, 404);
});
