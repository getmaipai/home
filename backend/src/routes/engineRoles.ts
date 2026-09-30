import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { restartChatAndWait } from "@/routes/host";
import { restartEmbedBackend, getEmbedClient } from "@/lib/embedSupervisor";
import { restartTtsBackend, getTtsClient } from "@/lib/ttsSupervisor";
import { restartBackgroundBackend, getBackgroundClient } from "@/lib/backgroundSupervisor";

const RoleSchema = z.enum(["chat", "embed", "voice", "background"]).openapi({ param: { name: "role", in: "path" } });
const RestartResponseSchema = z.object({ role: RoleSchema, restarted: z.literal(true) });

type Actions = Record<"chat" | "embed" | "voice" | "background", () => Promise<void>>;
let testActions: Actions | null = null;
export function __setEngineRoleActionsForTests(actions: Actions | null): void { testActions = actions; }

const actions: Actions = {
  chat: restartChatAndWait,
  embed: async () => { await restartEmbedBackend(); void getEmbedClient().catch(() => {}); },
  voice: async () => { await restartTtsBackend(); void getTtsClient().catch(() => {}); },
  background: async () => { await restartBackgroundBackend(); void getBackgroundClient().catch(() => {}); },
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
    ...errorResponses({ 400: "Unknown engine role", 401: "Not signed in", 403: "Not owner/admin", 503: "The chat engine did not return in time" }),
  },
});

export const engineRolesRoutes = apiRouter();
engineRolesRoutes.openapi(restartRoute, async (c) => {
  const { role } = c.req.valid("param");
  try {
    await (testActions ?? actions)[role]();
  } catch (err) {
    if (role === "chat") return c.json({ error: (err as Error).message }, 503);
    throw err;
  }
  return c.json({ role, restarted: true as const }, 200);
});
