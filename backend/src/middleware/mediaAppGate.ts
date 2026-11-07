// AUDIT-DUP-ROUTES-01: the one check that a signed-in person may use a media app (installed, visible, past the index floor).
// It was a three-line prelude pasted into 57 handlers that answered `return next()`; a forgotten line fell through to the next
// router in silence. Now a router mounts it once per path prefix, and a person without the app gets the same 404 the generic
// plugin data route already gave for an app that is not there ("no such app"), on every gated route, never a fall-through.
import { createMiddleware } from "hono/factory";
import type { Hono } from "hono";
import { mediaAppAllowed } from "@/lib/media/appHost";
import { requireAuth } from "@/middleware/auth";
import type { AppEnv } from "@/types";

export const MEDIA_APP_REFUSAL = "no such app";

/** Signs the caller in (401 otherwise), then lets only a person who has the app through. */
export function mediaAppGate(appId: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    let refused: Response | undefined;
    const early = await requireAuth(c, async () => {
      if (!mediaAppAllowed(c.get("person"), appId)) { refused = c.json({ error: MEDIA_APP_REFUSAL }, 404); return; }
      await next();
    });
    return early ?? refused;
  });
}

/** Mounts the gate on each path pattern of a router; call it before the router's handlers are registered. */
export function gateMediaApp(routes: Hono<AppEnv>, appId: string, paths: readonly string[]): void {
  for (const path of paths) routes.use(path, mediaAppGate(appId));
}
