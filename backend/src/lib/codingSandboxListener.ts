// The sandbox's own door to the coding gateway. A sandbox sits on the host-only sandbox network and cannot speak the household's HTTPS (no CA, no name), while
// the main listener serves every non-loopback address as HTTPS once the household certificate exists. So Home serves /code/v1, and nothing else, over plain
// http on ONE address: the sandbox bridge (the Stack's host-only network gateway), on its own port. It is never bound to the LAN, the tailnet or loopback; a
// request whose source is not in the bridge's /24, or whose path is not /code/v1, is refused here before the app sees it; and what passes goes through the same
// gate chain as any gateway request (key, scope, tier, floors in routes/codeGateway.ts, plus the transport check in lib/codeGate.ts, which stays strict).
import { sandboxGatewayUrl } from "@/lib/codingGatewayAddress";
import { appendLogLine } from "@/lib/log";

export type SandboxFetch = (request: Request, server: unknown) => Response | Promise<Response>;

/** The address a sandbox is served on: the gateway host of the configured sandbox gateway address. Null when it is not an IPv4 address. */
export function sandboxBridgeAddress(url: string = sandboxGatewayUrl()): string | null {
  try { const host = new URL(url).hostname; return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ? host : null; } catch { return null; }
}
export function sandboxBridgePort(url: string = sandboxGatewayUrl()): number | null {
  try { const port = Number(new URL(url).port); return Number.isInteger(port) && port > 0 && port < 65536 ? port : null; } catch { return null; }
}
/** True when the peer is in the bridge address's /24 (an IPv4-mapped IPv6 form is accepted). */
export function inBridgeNetwork(peer: string | undefined, bridge: string): boolean {
  if (!peer) return false;
  const a = peer.replace(/^::ffff:/i, "").split("."); const b = bridge.split(".");
  return a.length === 4 && b.length === 4 && a.every((n) => /^\d{1,3}$/.test(n)) && a.slice(0, 3).join(".") === b.slice(0, 3).join(".");
}

/** The wrapper in front of the app: refuses a source outside the bridge /24 and any path outside /code/v1. Exported for tests. */
export function guardSandboxRequest(bridge: string, inner: SandboxFetch, peerOf: (request: Request, server: unknown) => string | undefined): SandboxFetch {
  return (request, server) => {
    if (!inBridgeNetwork(peerOf(request, server), bridge)) return new Response(JSON.stringify({ error: "This address serves Code sandboxes only." }), { status: 403, headers: { "content-type": "application/json" } });
    const path = new URL(request.url).pathname;
    if (path !== "/code/v1" && !path.startsWith("/code/v1/")) return new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers: { "content-type": "application/json" } });
    return inner(request, server);
  };
}

let handler: SandboxFetch | null = null;
let server: { stop(force?: boolean): void } | null = null;
/** index.ts gives the listener the app's fetch once; nothing is bound until a Code turn needs it. */
export function configureSandboxListener(fetch: SandboxFetch): void { handler = fetch; }

/** Binds the bridge listener if it is not up. A rebind right after a release can find the port still closing, and the bridge address can lag a sandbox start, so it retries for about 5 s. False when it still cannot be (no bridge address, not configured): the turn then fails with gateway_unreachable. */
export async function ensureSandboxListener(attempts = 25, waitMs = 200): Promise<boolean> {
  if (server) return true;
  const bridge = sandboxBridgeAddress(); const port = sandboxBridgePort();
  if (!handler || !bridge || !port) return false;
  const guarded = guardSandboxRequest(bridge, handler, (request, srv) => (srv as { requestIP?: (r: Request) => { address: string } | null } | null)?.requestIP?.(request)?.address);
  for (let i = 0; i < attempts; i++) {
    if (server) return true;
    try {
      server = Bun.serve({ hostname: bridge, port, fetch: guarded as never, idleTimeout: 120 });
      appendLogLine(`coding sandbox_listener_up port=${port} try=${i + 1}`);
      return true;
    } catch (e) { server = null; if (i === attempts - 1) appendLogLine(`coding sandbox_listener_failed ${String((e as Error)?.message ?? e).slice(0, 120)}`); else await Bun.sleep(waitMs); }
  }
  return false;
}
/** Stops the listener (Coding turned off, Home stopping, or a turn found it dead so the next one rebinds). */
export function stopSandboxListener(): void { try { server?.stop(true); } catch { /* already gone */ } server = null; }
