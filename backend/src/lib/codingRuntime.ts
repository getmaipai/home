// CODE-AGENT-01 (slice three): wires the real pieces at startup: the Stack's sandbox, the OpenCode driver and the Max lease. Until the gateway address for
// sandboxes and a session key exist the agent reports "not ready", so a message is refused with a plain line and no sandbox is started.
import { createStackSandbox } from "@/lib/codingSandbox";
import { createOpenCodeAgent } from "@/lib/codingOpencode";
import { setCodingRuntime } from "@/lib/codingTurns";
import { settleSessionsAtStartup } from "@/lib/codingSessions";
import { getChatLease } from "@/lib/chatLeaseRuntime";
import { getStackClient } from "@/lib/stackEngine";
import { createSessionKey } from "@/lib/apiKeys";
import { messageBudgetMs } from "@/lib/codingTurns";
import { homePort } from "@/lib/ports";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

/**
 * The coding gateway as a sandbox reaches it on the host-only sandbox network. Home mounts the gateway at /code/v1 on its own port (app.ts), so the address is the
 * sandbox network's gateway host plus Home's port. `MAIPAI_SANDBOX_GATEWAY_URL` replaces the whole address; `MAIPAI_SANDBOX_GATEWAY_HOST` replaces the host. The default
 * host is the container system's usual host-only gateway; it must match the Stack's sandbox network (STACK_SANDBOX_GATEWAY), which is not checked from here.
 * Declared as environment, not a household setting: a setting needs a spec key and copy in every language, which is its own change.
 */
export const DEFAULT_SANDBOX_GATEWAY_HOST = "192.168.64.1";
export function sandboxGatewayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const whole = env.MAIPAI_SANDBOX_GATEWAY_URL?.trim();
  if (whole) return whole.replace(/\/$/, "");
  return `http://${env.MAIPAI_SANDBOX_GATEWAY_HOST?.trim() || DEFAULT_SANDBOX_GATEWAY_HOST}:${homePort(env)}/code/v1`;
}
const gatewayUrl = (): string | null => sandboxGatewayUrl();

/** A turn's key: the turn's wall-clock budget plus ten minutes, minted for the session's owner, never stored anywhere but the key table (hashed). */
export function mintSessionKeyFor(input: { personId: string; sessionId: string; tier?: "standard" | "boost" | "max" }): string | null {
  const person = db.select().from(people).where(eq(people.id, input.personId)).get() as PersonRow | undefined;
  if (!person) return null;
  try { return createSessionKey(person, input.sessionId, messageBudgetMs(person) + 10 * 60_000, input.tier ?? "standard"); } catch { return null; }
}

export function startCodingRuntime(): void {
  settleSessionsAtStartup();
  const sandbox = createStackSandbox(() => getStackClient());
  const agent = createOpenCodeAgent({ sandbox, gatewayUrl, canMintKeys: () => true, sessionKey: async (who) => mintSessionKeyFor(who) });
  setCodingRuntime({ agent, sandbox, lease: getChatLease });
}
