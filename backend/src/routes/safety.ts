import { Hono } from "hono";
import { requireAuth, type Role } from "@/middleware/auth";
import { evaluateSafety } from "@/lib/safety";
import type { AppEnv } from "@/types";

export const safetyRoutes = new Hono<AppEnv>();

// No turn engine exists yet to call the safety layer on a real
// conversation turn (4.5 is later in the roadmap, see docs/dev.md), so
// this route is today's real caller: it checks the signed-in person's own
// text in their own speaker context. The turn engine will call
// evaluateSafety() directly once it exists; this route stays useful after
// that too (a dev/diagnostics surface, 4.13).
safetyRoutes.post("/check", requireAuth, async (c) => {
  const person = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  if (!body.text || typeof body.text !== "string") {
    return c.json({ error: "text is required" }, 400);
  }
  const result = evaluateSafety(body.text, person.role as Role);
  return c.json(result);
});
