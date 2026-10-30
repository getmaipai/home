import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { PlaceSearchUnavailable, resolvePlace, searchPlaces } from "@/lib/places";
import { nearestLocalPlace, searchLocalPlaces } from "@/lib/gazetteer";

export const placesRoutes = apiRouter();

const resolved = z.object({
  label: z.string(), area: z.string().nullable(), lat: z.number().nullable(), lon: z.number().nullable(),
  precision: z.enum(["exact", "area"]).nullable(), from: z.enum(["named", "saved", "current", "household", "none"]),
});

const resolveRoute = createRoute({
  method: "post", path: "/resolve", tags: ["Places"], summary: "Resolve the place for a location surface",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ surface: z.enum(["weather", "maps"]), named: z.string().max(200).nullable().optional(), current: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), area: z.string().max(200).nullable().optional() }).nullable().optional() }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: resolved } }, description: "Resolved place; request coordinates are not persisted." }, ...errorResponses({ 401: "Not signed in" }) },
});
placesRoutes.openapi(resolveRoute, async (c) => {
  const person = c.get("person");
  const body = c.req.valid("json");
  return c.json(await resolvePlace({ person, surface: body.surface, named: body.named, current: body.current }), 200);
});

const searchRoute = createRoute({
  method: "get", path: "/search", tags: ["Places"], summary: "Search for map places",
  middleware: [requireAuth] as const,
  request: { query: z.object({ q: z.string().max(200) }) },
  responses: { 200: { content: { "application/json": { schema: z.array(z.object({ name: z.string(), area: z.string().nullable(), lat: z.number(), lon: z.number() })) } }, description: "Geocoding candidates, coarsened for a child." }, ...errorResponses({ 401: "Not signed in", 502: "The place search service could not be reached; an empty list means it answered with no match" }) },
});
placesRoutes.openapi(searchRoute, async (c) => {
  try {
    return c.json(await searchPlaces(c.req.valid("query").q, c.get("person")), 200);
  } catch (error) {
    if (!(error instanceof PlaceSearchUnavailable)) throw error;
    return c.json({ error: "Place search is not available right now. Check that this computer is online, then try again.", code: "down" }, 502);
  }
});

const localShape = z.object({ name: z.string(), area: z.string().nullable(), lat: z.number(), lon: z.number(), country: z.string(), zone: z.string() });
const localSearchRoute = createRoute({
  method: "get", path: "/local-search", tags: ["Places"], summary: "Find a city by name in the offline gazetteer",
  middleware: [requireAuth] as const,
  request: { query: z.object({ q: z.string().max(200) }) },
  responses: { 200: { content: { "application/json": { schema: z.array(localShape) } }, description: "Up to five cities, coordinates rounded to 2 decimals. Nothing leaves the home." }, ...errorResponses({ 401: "Not signed in" }) },
});
placesRoutes.openapi(localSearchRoute, (c) => c.json(searchLocalPlaces(c.req.valid("query").q), 200));

const nearestRoute = createRoute({
  method: "get", path: "/nearest", tags: ["Places"], summary: "Name the city nearest a point, offline",
  middleware: [requireAuth] as const,
  request: { query: z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) }) },
  responses: { 200: { content: { "application/json": { schema: localShape.nullable() } }, description: "The nearest city within 150 km, or null. The point is not stored or logged." }, ...errorResponses({ 401: "Not signed in" }) },
});
placesRoutes.openapi(nearestRoute, (c) => { const q = c.req.valid("query"); return c.json(nearestLocalPlace(q.lat, q.lon), 200); });
