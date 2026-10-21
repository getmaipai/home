// OPS-KEY-01: bearer-only routes for an assistant session holding a `settings` API key (made by an owner or admin in Settings).
// Never accepts a cookie session: the same reasoning as the turn and coding doors (middleware/auth.ts requireApiKey).
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireApiKey } from "@/middleware/auth";
import { operatorSettingsView, setOperatorSetting } from "@/lib/operatorSettings";
import { tryConsume } from "@/lib/rateLimiter";
import type { AppEnv } from "@/types";

export const operatorRoutes = new Hono<AppEnv>();

// A key is a long-lived bearer secret: a leaked one is slowed to 20 calls a minute, one bucket per key id.
const OPERATOR_CALLS_PER_MINUTE = 20;
const slow = (c: { json: (body: unknown, status: 429, headers: Record<string, string>) => Response; get: (key: "apiKey") => { id: string } | undefined }) =>
  tryConsume(`operator:key:${c.get("apiKey")?.id ?? "unknown"}`, { capacity: OPERATOR_CALLS_PER_MINUTE, refillPerSecond: OPERATOR_CALLS_PER_MINUTE / 60 })
    ? null
    : c.json({ error: "This key is sending requests too fast. Wait a minute and try again." }, 429, { "retry-after": "3" });

operatorRoutes.get("/settings", requireApiKey("settings"), (c) => slow(c as never) ?? c.json({ settings: operatorSettingsView() }));

operatorRoutes.put("/settings", requireApiKey("settings"), bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
  const limited = slow(c as never);
  if (limited) return limited;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Send JSON like {\"key\": \"chat.search_assist\", \"value\": \"rescue\"}." }, 400); }
  const { key, value } = (body ?? {}) as { key?: unknown; value?: unknown };
  if (typeof key !== "string" || value === undefined) return c.json({ error: "Send both a key and a value, like {\"key\": \"chat.search_assist\", \"value\": \"rescue\"}." }, 400);
  const result = setOperatorSetting(c.get("apiKey")?.id ?? "unknown", key, value);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ key: result.key, previous: result.previous, value: result.value });
});
