// While the AI is still downloading, the routes that need it answer with a
// plain 503 the app turns into "still getting ready", instead of a raw
// engine failure. It only ever refuses; it never opens a route that a
// person, age or surface gate would have closed. With no install running
// (no jobs, or no Stack configured) it steps aside and the route behaves
// exactly as before.
import type { MiddlewareHandler } from "hono";
import { getInstallStatus, type InstallStatus } from "@/lib/installStatus";

export type InstallNeed = "chat" | "all";

export function installGate(need: InstallNeed, read: () => Promise<InstallStatus> = getInstallStatus): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
    const install = await read();
    if (install.state === "none" || install.state === "ready") return next();
    const open = need === "chat" ? install.chatReady : install.complete;
    if (open) return next();
    const what = need === "chat" ? "The AI is still downloading." : "This needs the whole AI, which is still downloading.";
    return c.json({ error: `${what} It will work as soon as the download finishes.`, code: "ai_installing", install: { state: install.state, percent: install.percent } }, 503);
  };
}
