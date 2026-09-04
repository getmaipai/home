import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { complete, type LlmMessage, type LlmRole } from "@/lib/llm";
import type { AppEnv } from "@/types";

export const llmRoutes = new Hono<AppEnv>();

// No turn engine exists yet to call the chat role internally (4.5), so
// this route is today's real caller, the same "provisional real caller
// ahead of the turn engine" pattern /api/safety/check set for the safety
// layer. Any signed-in person may call it (no role gate): a household
// chat request isn't a privileged action, the same posture
// /api/safety/check already takes for checking one's own text.
llmRoutes.post("/chat", requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    role?: string;
    messages?: LlmMessage[];
    temperature?: number;
    max_tokens?: number;
  };
  const role = (body.role ?? "chat") as LlmRole;
  const result = await complete(role, body.messages ?? [], {
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  });
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  return c.json(result.value);
});
