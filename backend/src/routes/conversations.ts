import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { list, exportPerson } from "@/lib/conversationHistory";
import type { AppEnv } from "@/types";

export const conversationsRoutes = new Hono<AppEnv>();

// list() enforces the real visibility rule (self, or owner/admin for a
// child) internally and returns an empty result rather than an error for
// anyone else's target: a household member asking for someone they can't
// see gets "nothing here," matching memory.ts's list()/recall() browsing
// precedent. export is a privileged single-target action (memory.ts's own
// exportPerson() precedent), so it returns a real 403 instead.
conversationsRoutes.get("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const person = c.req.query("person");
  return c.json(list(actor, person));
});

conversationsRoutes.get("/export", requireAuth, async (c) => {
  const actor = c.get("person");
  const person = c.req.query("person") ?? actor.id;
  const result = exportPerson(actor, person);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value);
});
