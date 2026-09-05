import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { privacyPageData } from "@/lib/privacy";
import type { AppEnv } from "@/types";

export const privacyRoutes = new Hono<AppEnv>();

// Any signed-in household member, deliberately not owner/admin only.
// This is the page that tells a family what leaves their house; gating
// it behind an admin role would make the promise checkable only by the
// person who already knows. Nothing here is personal data or a secret:
// it is the same table the manifests already declare in the open.
privacyRoutes.get("/", requireAuth, (c) => {
  return c.json(privacyPageData());
});
