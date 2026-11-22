import { homePort } from "@/lib/ports";

/**
 * The coding gateway as a sandbox reaches it on the host-only sandbox network. Home mounts the gateway at /code/v1 on its own port (app.ts), so the address is the
 * sandbox network's gateway host plus Home's port. `MAIPAI_SANDBOX_GATEWAY_URL` replaces the whole address; `MAIPAI_SANDBOX_GATEWAY_HOST` replaces the host. The default
 * host is the gateway of the Stack's own sandbox network (maipai-sandbox-net, 192.168.128.0/24, measured 2026-11-21); it must match the Stack's sandbox network (STACK_SANDBOX_GATEWAY), which is not checked from here.
 * Declared as environment, not a household setting: a setting needs a spec key and copy in every language, which is its own change.
 */
export const DEFAULT_SANDBOX_GATEWAY_HOST = "192.168.128.1";
export function sandboxGatewayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const whole = env.MAIPAI_SANDBOX_GATEWAY_URL?.trim();
  if (whole) return whole.replace(/\/$/, "");
  return `http://${env.MAIPAI_SANDBOX_GATEWAY_HOST?.trim() || DEFAULT_SANDBOX_GATEWAY_HOST}:${homePort(env)}/code/v1`;
}
