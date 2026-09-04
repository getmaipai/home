import { Hono, type Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import { listValues, setValue, resetValue, type SettingsOpResult } from "@/lib/settings";
import { getRegistry } from "@/lib/settingsRegistry";
import type { AppEnv } from "@/types";

export const settingsRoutes = new Hono<AppEnv>();

function fail(c: Context<AppEnv>, result: Extract<SettingsOpResult<unknown>, { ok: false }>) {
  return c.json({ error: result.error }, result.status);
}

// The registry itself: declarative metadata (labels, defaults, help), not
// a person's data. Gated behind sign-in for consistency with the rest of
// the API rather than any real sensitivity concern.
settingsRoutes.get("/registry", requireAuth, async (c) => {
  return c.json(getRegistry());
});

settingsRoutes.get("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const scope = new URL(c.req.url).searchParams.get("scope");
  if (!scope) return c.json({ error: "scope is required" }, 400);
  const result = listValues(actor, scope);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

settingsRoutes.put("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as {
    scope?: string;
    key?: string;
    value?: unknown;
  };
  if (!body.scope || !body.key || body.value === undefined) {
    return c.json({ error: "scope, key, and value are required" }, 400);
  }
  const result = setValue(actor, body.scope, body.key, body.value);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

settingsRoutes.post("/reset", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { scope?: string; key?: string };
  if (!body.scope || !body.key) return c.json({ error: "scope and key are required" }, 400);
  const result = resetValue(actor, body.scope, body.key);
  if (!result.ok) return fail(c, result);
  // `success: true` was this route's whole response body before today;
  // a code review (2026-09-04) flagged replacing it outright as a
  // repurposed field under CLAUDE.md > Compatibility's "API changes are
  // additive" rule (no current caller reads it - the frontend was updated
  // in the same commit - but the rule exists for the clients that will).
  // Kept alongside the richer body rather than dropped.
  return c.json({ ...result.value, success: true });
});
