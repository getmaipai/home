import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { complete, embed, personWithinTurnBudget, type LlmMessage, type LlmRole } from "@/lib/llm";
import type { AppEnv } from "@/types";

export const llmRoutes = new Hono<AppEnv>();

const RATE_LIMIT_RESPONSE = { error: "Too many requests too quickly.", code: "turn_rate_limited" } as const;

// The turn engine (turnEngine.ts) is the real internal caller of the chat
// role today; this route is also a direct, provisional caller in its own
// right (diagnostics, a client that wants the model without a full turn),
// the same posture /api/safety/check takes for checking one's own text.
// Any signed-in person may call it (no role gate): a household chat
// request isn't a privileged action.
//
// Shares turn.ts's per-person budget (lib/llm.ts's personWithinTurnBudget,
// Session C step 0, wave-2.md): a turn's own reply generation goes
// through this identical model call, so a separate bucket here would
// just double the effective rate a person could burn against the engine.
llmRoutes.post("/chat", requireAuth, async (c) => {
  const actor = c.get("person");
  if (!personWithinTurnBudget(actor.id)) {
    return c.json(RATE_LIMIT_RESPONSE, 429);
  }
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

// Same posture as /chat above: any signed-in person, no role gate - the
// same "provisional real caller ahead of the turn engine" reasoning
// applies (nothing internal calls the embed role yet either; memory.ts's
// real vector recall and turnEngine.ts's routing match are both later,
// separate slices this one deliberately doesn't wire up).
llmRoutes.post("/embed", requireAuth, async (c) => {
  const actor = c.get("person");
  if (!personWithinTurnBudget(actor.id)) {
    return c.json(RATE_LIMIT_RESPONSE, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as { texts?: string[] };
  const result = await embed(body.texts ?? []);
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  return c.json(result.value);
});
