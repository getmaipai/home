import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { listPackageIds, loadPackage, runSkill } from "@/lib/skills";
import type { AppEnv } from "@/types";

export const skillsRoutes = new Hono<AppEnv>();

skillsRoutes.get("/", requireAuth, async (c) => {
  const manifests = listPackageIds()
    .map((id) => loadPackage(id))
    .filter((r) => r.ok)
    .map((r) => (r as { ok: true; value: { manifest: unknown } }).value.manifest);
  return c.json(manifests);
});

skillsRoutes.post("/:id/run", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = runSkill(c.req.param("id"), actor, body);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value);
});
