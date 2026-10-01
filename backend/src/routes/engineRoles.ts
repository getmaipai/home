import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";

const RoleSchema = z.enum(["chat"]).openapi({ param: { name: "role", in: "path" } });
const RestartResponseSchema = z.object({ role: RoleSchema, restarted: z.literal(true) });

const restartRoute = createRoute({
  method: "post",
  path: "/{role}/restart",
  tags: ["Host"],
  summary: "Restart an engine role",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ role: RoleSchema }) },
  responses: {
    200: { content: { "application/json": { schema: RestartResponseSchema } }, description: "The engine restart was requested." },
    ...errorResponses({ 400: "Unknown engine role", 401: "Not signed in", 403: "Not owner/admin", 409: "Model changes are made through the MaiPai Stack." }),
  },
});

const stopRoute = createRoute({
  method: "post", path: "/{role}/stop", tags: ["Host"], summary: "Stop an engine role",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ role: RoleSchema }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ role: RoleSchema, stopped: z.literal(true) }) } }, description: "The engine was stopped." },
    ...errorResponses({ 400: "Unknown engine role", 401: "Not signed in", 403: "Not owner/admin", 409: "Model changes are made through the MaiPai Stack." }),
  },
});

const startRoute = createRoute({
  method: "post", path: "/{role}/start", tags: ["Host"], summary: "Start an engine role",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ role: RoleSchema }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ role: RoleSchema, started: z.literal(true) }) } }, description: "The engine was started." },
    ...errorResponses({ 400: "Unknown engine role", 401: "Not signed in", 403: "Not owner/admin", 409: "Model changes are made through the MaiPai Stack." }),
  },
});

export const engineRolesRoutes = apiRouter();
engineRolesRoutes.openapi(restartRoute, async (c) => {
  return c.json({ error: "Model changes are made through the MaiPai Stack." }, 409);
});

engineRolesRoutes.openapi(stopRoute, async (c) => {
  return c.json({ error: "Model changes are made through the MaiPai Stack." }, 409);
});

engineRolesRoutes.openapi(startRoute, async (c) => {
  return c.json({ error: "Model changes are made through the MaiPai Stack." }, 409);
});
