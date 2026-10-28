// OPS-KEY-01: bearer-only routes for an assistant session holding a `settings` API key (made by an owner or admin in Settings).
// Never accepts a cookie session: the same reasoning as the turn and coding doors (middleware/auth.ts requireApiKey).
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireApiKey } from "@/middleware/auth";
import { operatorSettingsView, setOperatorSetting } from "@/lib/operatorSettings";
import { DEFAULT_TURNS, MAX_TURNS, engineState, runCacheProbe, summaryView, turnsView } from "@/lib/operatorDiagnose";
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

// DIAG-KEY-01 (docs/dev/diagnose-api.md): read-only, numbers only, under a `diagnose` key. Same bearer-only door and the same per-key limit.
const count = (raw: string | undefined, fallback: number, max: number) => {
  const n = raw === undefined ? fallback : Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : null;
};
const badCount = (name: string, max: number) => ({ error: `Send ${name} as a whole number from 1 to ${max}, for example ?${name}=10.` });
operatorRoutes.use("/diagnose/*", requireApiKey("diagnose"));

operatorRoutes.get("/diagnose/turns", (c) => {
  const limited = slow(c as never); if (limited) return limited;
  const limit = count(c.req.query("limit"), DEFAULT_TURNS, MAX_TURNS);
  return limit === null ? c.json(badCount("limit", MAX_TURNS), 400) : c.json({ turns: turnsView(limit) });
});

operatorRoutes.get("/diagnose/summary", (c) => {
  const limited = slow(c as never); if (limited) return limited;
  const turns = count(c.req.query("turns"), 20, MAX_TURNS);
  return turns === null ? c.json(badCount("turns", MAX_TURNS), 400) : c.json(summaryView(turns));
});

operatorRoutes.get("/diagnose/engines", async (c) => {
  const limited = slow(c as never); if (limited) return limited;
  try { return c.json(await engineState()); } catch { return c.json({ error: "The engine service did not answer. Check that it is running on the status page and try again." }, 503); }
});

operatorRoutes.post("/diagnose/cache-probe", async (c) => {
  const limited = slow(c as never); if (limited) return limited;
  const result = await runCacheProbe();
  return result.ok ? c.json({ calls: result.calls }) : c.json({ error: result.error }, result.status);
});
