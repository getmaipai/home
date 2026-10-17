// While an owner or admin has paused chat, the routes that start a reply
// answer with a plain 503 and Retry-After. Cancelling a turn stays open, and
// Settings is a different route, so the switch can always be turned back off.
// Timers, alarms and the emergency lines are not chat and never come through
// these routes.
import type { MiddlewareHandler } from "hono";
import { adminPauseLine } from "@/lib/failureCopy";
import { chatPausedByAdmin, chatPauseMessage } from "@/lib/chatPause";

export const CHAT_PAUSE_RETRY_AFTER_SECONDS = 300;

export const chatPauseGate: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (c.req.path.endsWith("/cancel")) return next();
  if (!chatPausedByAdmin()) return next();
  c.header("Retry-After", String(CHAT_PAUSE_RETRY_AFTER_SECONDS));
  return c.json({ error: adminPauseLine(chatPauseMessage()), code: "chat_paused" }, 503);
};
