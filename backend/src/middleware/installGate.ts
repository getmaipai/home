// While the AI is still downloading, the routes that need it answer with a
// plain 503 the app turns into "still getting ready", instead of a raw
// engine failure. It only ever refuses; it never opens a route that a
// person, age or surface gate would have closed. With no install running
// (no jobs, or no Stack configured) it steps aside and the route behaves
// exactly as before.
import type { MiddlewareHandler } from "hono";
import { getInstallStatus, type InstallStatus } from "@/lib/installStatus";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";

export type InstallNeed = "chat" | "all";

/** A role the Stack can serve right now: its own model is on disk. A download
 * of an upgrade, a replacement engine or a projector never makes it unusable
 * (rule S6: the role's state is the one definition, the install job is not). */
export async function stackRoleUsable(roles: readonly string[]): Promise<boolean> {
  if (!isStackConfigured()) return false;
  try {
    const { roles: rows } = await getStackClient().roles();
    return rows.some((row) => roles.includes(row.id) && (row.state.state === "ready" || row.state.state === "installed" || row.state.state === "loaded"));
  } catch { return false; }
}

const DEFAULT_ROLES: Record<InstallNeed, readonly string[]> = { chat: ["chat"], all: [] };

/** `roles` names the Stack roles that can answer this route; any one of them
 * being usable opens it, whatever downloads are running. */
export function installGate(need: InstallNeed, read: () => Promise<InstallStatus> = getInstallStatus, roles: readonly string[] = DEFAULT_ROLES[need], usable: (roles: readonly string[]) => Promise<boolean> = stackRoleUsable): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
    const install = await read();
    if (install.state === "none" || install.state === "ready") return next();
    const open = need === "chat" ? install.chatReady : install.complete;
    if (open) return next();
    if (roles.length > 0 && await usable(roles)) return next();
    const what = need === "chat" ? "The AI is still downloading." : "This needs the whole AI, which is still downloading.";
    return c.json({ error: `${what} It will work as soon as the download finishes.`, code: "ai_installing", install: { state: install.state, percent: install.percent } }, 503);
  };
}
