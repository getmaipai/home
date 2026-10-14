import { detectLanIps } from "@/lib/hubEndpoints";
import { onLeafRenewed } from "@/lib/householdCa";
import { rebindWithRetry } from "@/lib/serverRebind";
import { SERVER_IDLE_TIMEOUT_SECONDS } from "@/lib/serverConfig";
import type { websocket as HonoWebSocket } from "hono/bun";

export interface HouseholdTlsMaterial {
  certPem: string;
  keyPem: string;
}

export interface HomeListenerSet {
  port: number;
  tls: boolean;
  servers: Bun.Server<any>[];
  stop(): void;
}

type FetchHandler = (request: Request, server: any) => Response | Promise<Response>;

/**
 * Serves a fresh install on the ordinary all-interface HTTP listener.
 * Once a household leaf exists, HTTP stays available only on loopback,
 * while TLS binds each detected non-loopback address on the same port.
 */
export function startHomeListeners(options: {
  port: number;
  fetch: FetchHandler;
  websocket: typeof HonoWebSocket;
  tls?: HouseholdTlsMaterial | null;
  networkAddresses?: string[];
  exposure?: "loopback" | "lan";
}): HomeListenerSet {
  const { fetch } = options;
  const tls = options.tls ?? null;
  const exposure = options.exposure ?? "lan";
  const servers: Bun.Server<any>[] = [];
  let port = options.port;

  const serve = (hostname: string | undefined, withTls: boolean) => {
    const server = Bun.serve({
      ...(hostname ? { hostname } : {}),
      port,
      fetch,
      websocket: options.websocket,
      idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
      ...(withTls && tls ? { tls: { cert: tls.certPem, key: tls.keyPem } } : {}),
    });
    servers.push(server);
    port = server.port!;
  };

  try {
    if (exposure === "loopback") {
      serve("127.0.0.1", false);
      serve("::1", false);
    } else if (!tls) {
      serve(undefined, false);
    } else {
      // The specific-address binds can share a port: loopback gets plain
      // HTTP, and detected household addresses get HTTPS.
      serve("127.0.0.1", false);
      serve("::1", false);
      const addresses = [...new Set(options.networkAddresses ?? detectLanIps())]
        .filter((address) => address !== "127.0.0.1" && address !== "::1");
      for (const address of addresses) serve(address, true);
    }
  } catch (error) {
    for (const server of servers) server.stop(true);
    throw error;
  }

  return {
    port,
    tls: tls !== null,
    servers,
    stop() {
      for (const server of servers) server.stop(true);
    },
  };
}

/** The active leaf is minted by GET /api/setup/ca or renewed by Repairs.
 * Rebind the live listener group in place so a first mint takes effect
 * immediately, without restarting Home. */
export function attachHouseholdTlsRebind(options: {
  initial: HomeListenerSet;
  fetch: FetchHandler;
  websocket: typeof HonoWebSocket;
  networkAddresses?: () => string[];
  exposure?: "loopback" | "lan";
  onBound?: (listeners: HomeListenerSet) => void;
  onFailure?: (error: unknown) => void;
}): { current(): HomeListenerSet; stop(): void } {
  let listeners = options.initial;
  let active = true;

  onLeafRenewed((leaf) => {
    if (!active) return;
    // The mint may happen while a request is being handled by the HTTP
    // listener. Let that response leave before closing the old sockets.
    setTimeout(() => {
      if (!active) return;
      listeners.stop();
      void rebindWithRetry(() => startHomeListeners({
        port: listeners.port,
        fetch: options.fetch,
        websocket: options.websocket,
        tls: leaf,
        networkAddresses: options.networkAddresses?.(),
        exposure: options.exposure,
      }))
        .then(({ server: next }) => {
          if (!active) {
            next.stop();
            return;
          }
          listeners = next;
          options.onBound?.(next);
        })
        .catch((error: unknown) => options.onFailure?.(error));
    }, 25);
  });

  return {
    current: () => listeners,
    stop() {
      active = false;
      listeners.stop();
    },
  };
}
