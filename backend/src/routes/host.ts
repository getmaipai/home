import { Hono } from "hono";
import { requireRole } from "@/middleware/auth";
import { detectHardware } from "@/lib/hardware";
import { recommend, CATALOG } from "@/lib/modelCatalog";
import { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import type { AppEnv } from "@/types";

export const hostRoutes = new Hono<AppEnv>();

// Owner/admin only: this is host-level operational data (what hardware is
// in the box, what model runs), the same posture backups.ts takes, not a
// per-person preference.
hostRoutes.get("/hardware", requireRole("owner", "admin"), async (c) => c.json(await detectHardware()));

const VALID_ROLES: ReadonlySet<string> = new Set(ModelCapabilities.shape.role.options);

hostRoutes.get("/models", requireRole("owner", "admin"), async (c) => {
  const role = c.req.query("role");
  if (!role || !VALID_ROLES.has(role)) {
    return c.json({ error: `role must be one of: ${[...VALID_ROLES].join(", ")}` }, 400);
  }
  const hw = await detectHardware();
  return c.json(recommend(role as (typeof CATALOG)[number]["role"], hw));
});
