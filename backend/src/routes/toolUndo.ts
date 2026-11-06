import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { runUndo } from "@/lib/toolUndo";
import { houseUndoRunner } from "@/lib/house/undoRunner";

export const toolUndoRoutes = apiRouter();
const undo = createRoute({
  method: "post",
  path: "/{id}",
  tags: ["Tools"],
  summary: "Undo a recent tool action",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "turn-a1b2c3") },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
      description: "Undone",
    },
    ...errorResponses({
      401: "Not signed in",
      404: "No such undo",
      409: "Undo expired or used",
    }),
  },
});

toolUndoRoutes.openapi(undo, async (c) => {
  const actor = c.get("person");
  const result = await runUndo(actor, c.req.valid("param").id, new Date(), houseUndoRunner(actor));
  if (result.ok) return c.json({ ok: true as const }, 200);
  if (result.status === 404) return c.json({ error: result.error }, 404);
  return c.json({ error: result.error }, 409);
});
