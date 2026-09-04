import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { runTurn, type Surface } from "@/lib/turnEngine";
import type { AppEnv } from "@/types";

export const turnRoutes = new Hono<AppEnv>();

// Any signed-in person, no role gate: a household member's own
// conversation turn isn't a privileged action, the same posture
// /api/safety/check and /api/llm/chat already take. This is the real
// caller those two routes' comments named as "ahead of the turn engine";
// they stay useful in their own right (diagnostics, direct model/safety
// checks) now that this one exists.
turnRoutes.post("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { surface?: string; text?: string; thinking?: boolean };
  const surface = (body.surface ?? "chat") as Surface;
  const result = await runTurn(actor, surface, body.text ?? "", { thinking: body.thinking });
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  return c.json(result.value);
});
