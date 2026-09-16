import { createRoute, z } from "@hono/zod-openapi";
import { requireAuth } from "@/middleware/auth";
import { createCommand, listCommands, deleteCommand, type CommandOpResult } from "@/lib/commands";
import type { AppEnv } from "@/types";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";

export const commandsRoutes = apiRouter();

const actionSchema = z.object({ kind: z.string(), text: z.string().optional(), speech: z.string().optional(), domain: z.string().optional(), service: z.string().optional(), target: z.record(z.string(), z.unknown()).optional(), data: z.record(z.string(), z.unknown()).optional() }).passthrough();
const commandSchema = z.object({ id: z.string(), creatorId: z.string(), trigger: z.string(), minRole: z.string(), action: actionSchema, createdAt: z.string() }).openapi("Command");
const commandInputSchema = z.object({ trigger: z.string(), minRole: z.string(), action: z.unknown() });
const idResponse = z.object({ id: z.string() });

const listRoute = createRoute({ method: "get", path: "/", tags: ["Commands"], summary: "List household commands", middleware: [requireAuth] as const, responses: { 200: { content: { "application/json": { schema: z.array(commandSchema) } }, description: "Household commands." }, ...errorResponses({ 401: "Not signed in" }) } });
const createRouteDef = createRoute({ method: "post", path: "/", tags: ["Commands"], summary: "Create a household command", middleware: [requireAuth] as const, request: { body: { content: { "application/json": { schema: commandInputSchema } } } }, responses: { 200: { content: { "application/json": { schema: commandSchema } }, description: "Created command." }, ...errorResponses({ 400: "Invalid command", 401: "Not signed in", 403: "Not allowed" }) } });
const deleteRoute = createRoute({ method: "delete", path: "/{id}", tags: ["Commands"], summary: "Delete a household command", middleware: [requireAuth] as const, request: { params: idParamSchema("id") }, responses: { 200: { content: { "application/json": { schema: idResponse } }, description: "Deleted command." }, ...errorResponses({ 401: "Not signed in", 403: "Not allowed", 404: "Unknown command" }) } });

function fail<T>(result: Extract<CommandOpResult<T>, { ok: false }>) {
  return { body: { error: result.error }, status: result.status } as const;
}

// Household-wide read, same "any signed-in person can see what exists"
// gate pluginsRoutes.get("/") already uses - createCommand/deleteCommand
// carry their own, tighter role checks below.
commandsRoutes.openapi(listRoute, (c) => {
  return c.json(listCommands(), 200);
});

commandsRoutes.openapi(createRouteDef, async (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const result = createCommand(
    actor,
    body.trigger,
    body.minRole,
    body.action,
  );
  if (!result.ok) {
    const { body: errBody, status } = fail(result);
    return c.json(errBody, status) as any;
  }
  return c.json(result.value, 200);
});

commandsRoutes.openapi(deleteRoute, (c) => {
  const actor = c.get("person");
  const result = deleteCommand(actor, c.req.valid("param").id);
  if (!result.ok) {
    const { body, status } = fail(result);
    return c.json(body, status) as any;
  }
  return c.json(result.value, 200);
});
