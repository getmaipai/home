import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { createCommand, listCommands, deleteCommand, type CommandOpResult } from "@/lib/commands";
import type { AppEnv } from "@/types";

export const commandsRoutes = new Hono<AppEnv>();

function fail<T>(result: Extract<CommandOpResult<T>, { ok: false }>) {
  return { body: { error: result.error }, status: result.status } as const;
}

// Household-wide read, same "any signed-in person can see what exists"
// gate pluginsRoutes.get("/") already uses - createCommand/deleteCommand
// carry their own, tighter role checks below.
commandsRoutes.get("/", requireAuth, async (c) => {
  return c.json(listCommands());
});

commandsRoutes.post("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as {
    trigger?: unknown;
    minRole?: unknown;
    action?: unknown;
  };
  const result = createCommand(
    actor,
    typeof body.trigger === "string" ? body.trigger : "",
    typeof body.minRole === "string" ? body.minRole : "",
    body.action,
  );
  if (!result.ok) {
    const { body: errBody, status } = fail(result);
    return c.json(errBody, status);
  }
  return c.json(result.value);
});

commandsRoutes.delete("/:id", requireAuth, async (c) => {
  const actor = c.get("person");
  const result = deleteCommand(actor, c.req.param("id"));
  if (!result.ok) {
    const { body, status } = fail(result);
    return c.json(body, status);
  }
  return c.json(result.value);
});
