import { Hono } from "hono";
import { requireAuth, requireRole } from "@/middleware/auth";
import { listPackageIds, loadPackage, runSkill } from "@/lib/skills";
import { routingStats } from "@/lib/conversationHistory";
import type { AppEnv } from "@/types";

export const skillsRoutes = new Hono<AppEnv>();

skillsRoutes.get("/", requireAuth, async (c) => {
  const manifests = listPackageIds()
    .map((id) => loadPackage(id))
    .filter((r) => r.ok)
    .map((r) => (r as { ok: true; value: { manifest: unknown } }).value.manifest);
  return c.json(manifests);
});

// Owner/admin only: aggregate counts across every household member's
// turns, the same "systems metric, not personal history" gate
// hostRoutes.get("/hardware"|"/models") already use for the identical
// reason - unlike GET / above (any signed-in person can see what
// skills exist), this is the plan's own routing-quality measurement
// (4.5: "count fall-throughs... and decide on tier 2 from the eval
// number"), not something a household member browses casually.
skillsRoutes.get("/stats", requireRole("owner", "admin"), async (c) => {
  return c.json(routingStats());
});

skillsRoutes.post("/:id/run", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = runSkill(c.req.param("id"), actor, body);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value);
});
