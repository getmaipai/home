import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { restartChatAndWait } from "@/routes/host";
import { stopChatBackend } from "@/lib/llmSupervisor";
import { restartEmbedBackend, stopEmbedBackend, startEmbedBackendNow, getEmbedClient } from "@/lib/embedSupervisor";
import { restartBackgroundBackend, stopBackgroundBackend, startBackgroundBackendNow, getBackgroundClient } from "@/lib/backgroundSupervisor";

const RoleSchema = z.enum(["chat", "embed", "background"]).openapi({ param: { name: "role", in: "path" } });
const RestartResponseSchema = z.object({ role: RoleSchema, restarted: z.literal(true) });

type Action = "restart" | "stop" | "start";
type Actions = Record<"chat" | "embed" | "background", Record<Action, () => Promise<void>>>;
let testActions: Actions | null = null;
export function __setEngineRoleActionsForTests(actions: Actions | null): void { testActions = actions; }

const actions: Actions = {
  chat: { restart: restartChatAndWait, stop: stopChatBackend, start: restartChatAndWait },
  embed: { restart: async () => { await restartEmbedBackend(); void getEmbedClient().catch(() => {}); }, stop: stopEmbedBackend, start: async () => { void startEmbedBackendNow().catch(() => {}); } },
  background: { restart: async () => { await restartBackgroundBackend(); void getBackgroundClient().catch(() => {}); }, stop: stopBackgroundBackend, start: async () => { void startBackgroundBackendNow().catch(() => {}); } },
};

const restartRoute = createRoute({
  method: "post",
  path: "/{role}/restart",
  tags: ["Host"],
  summary: "Restart an engine role",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ role: RoleSchema }) },
  responses: {
    200: { content: { "application/json": { schema: RestartResponseSchema } }, description: "The engine restart was requested." },
    ...errorResponses({ 400: "Unknown engine role", 401: "Not signed in", 403: "Not owner/admin", 503: "The engine did not return in time" }),
  },
});

const stopRoute = createRoute({
  method: "post", path: "/{role}/stop", tags: ["Host"], summary: "Stop an engine role",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ role: RoleSchema }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ role: RoleSchema, stopped: z.literal(true) }) } }, description: "The engine was stopped." },
    ...errorResponses({ 400: "Unknown engine role", 401: "Not signed in", 403: "Not owner/admin", 503: "The engine could not be stopped" }),
  },
});

const startRoute = createRoute({
  method: "post", path: "/{role}/start", tags: ["Host"], summary: "Start an engine role",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ role: RoleSchema }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ role: RoleSchema, started: z.literal(true) }) } }, description: "The engine was started." },
    ...errorResponses({ 400: "Unknown engine role", 401: "Not signed in", 403: "Not owner/admin", 503: "The engine did not start" }),
  },
});

export const engineRolesRoutes = apiRouter();
engineRolesRoutes.openapi(restartRoute, async (c) => {
  const { role } = c.req.valid("param");
  try {
    await (testActions ?? actions)[role].restart();
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
  return c.json({ role, restarted: true as const }, 200);
});

engineRolesRoutes.openapi(stopRoute, async (c) => {
  const { role } = c.req.valid("param");
  try { await (testActions ?? actions)[role].stop(); }
  catch (err) { return c.json({ error: (err as Error).message }, 503); }
  return c.json({ role, stopped: true as const }, 200);
});

engineRolesRoutes.openapi(startRoute, async (c) => {
  const { role } = c.req.valid("param");
  try { await (testActions ?? actions)[role].start(); }
  catch (err) { return c.json({ error: (err as Error).message }, 503); }
  return c.json({ role, started: true as const }, 200);
});
