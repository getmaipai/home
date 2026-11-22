// CODE-AGENT-01 (slice three): wires the real pieces at startup: the Stack's sandbox, the OpenCode driver and the Max lease. Until the gateway address for
// sandboxes and a session key exist the agent reports "not ready", so a message is refused with a plain line and no sandbox is started.
import { createStackSandbox } from "@/lib/codingSandbox";
import { createOpenCodeAgent } from "@/lib/codingOpencode";
import { setCodingRuntime } from "@/lib/codingTurns";
import { settleSessionsAtStartup } from "@/lib/codingSessions";
import { getChatLease } from "@/lib/chatLeaseRuntime";
import { getStackClient } from "@/lib/stackEngine";

/** The gateway as a sandbox reaches it on the host-only network (set by the sandbox setup; there is no default). */
const gatewayUrl = (): string | null => process.env.MAIPAI_SANDBOX_GATEWAY_URL?.trim() || null;

export function startCodingRuntime(): void {
  settleSessionsAtStartup();
  const sandbox = createStackSandbox(() => getStackClient());
  // TODO(CODE-KEYS session key): minting a `coding:session` key is a credentials change with its own review; until then no key exists and the agent is not ready.
  const agent = createOpenCodeAgent({ sandbox, gatewayUrl, canMintKeys: () => false, sessionKey: async () => null });
  setCodingRuntime({ agent, sandbox, lease: getChatLease });
}
