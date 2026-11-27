// STACK-MENU-SYNC-01 (slice 2): what the Stack tab "General" shows: where the Stack runs, whether it answers, its version and how many problems it
// reports. Home keeps none of it: every call reads the Stack (`/healthz` and `/stack/v1/health`) through the same forwarder the other Stack tabs use.
import { isRemoteStackSelected } from "@/lib/stackEngine";
import { forwardToStack, StackChoicesError } from "@/lib/stackChoicesForward";

export interface StackGeneral {
  where: "this_computer" | "another_computer";
  reachable: boolean;
  version: string | null;
  /** How many problems the Stack lists right now; null when it could not be asked. */
  problems: number | null;
  /** The Stack's own sentence (or Home's plain one) when it does not answer; null when it does. */
  reason: string | null;
}

/** One read of the Stack's state for the General tab. A Stack that does not answer is a normal answer here (reachable false), never an error. */
export async function readStackGeneral(): Promise<StackGeneral> {
  const where = isRemoteStackSelected() ? "another_computer" : "this_computer";
  try {
    const { body } = await forwardToStack("GET", "/healthz");
    const version = typeof (body as { version?: unknown } | null)?.version === "string" ? (body as { version: string }).version : null;
    let problems: number | null = null;
    try {
      const health = await forwardToStack("GET", "/stack/v1/health");
      const items = (health.body as { health?: unknown } | null)?.health;
      problems = Array.isArray(items) ? items.length : null;
    } catch { /* the version answered; the problem count is simply unknown */ }
    return { where, reachable: true, version, problems, reason: null };
  } catch (error) {
    const reason = error instanceof StackChoicesError ? error.message : "Home could not reach the Stack. Start it, then check again.";
    return { where, reachable: false, version: null, problems: null, reason };
  }
}
