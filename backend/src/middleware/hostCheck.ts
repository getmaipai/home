import type { MiddlewareHandler } from "hono";
import { networkInterfaces } from "node:os";
import { listHubEndpoints } from "@/lib/hubEndpoints";
import { parseHostName } from "@/middleware/setupLocalOnly";
import { TRUST_PROXY } from "@/lib/trustProxy";
import { getHouseholdLeafForServer } from "@/lib/householdCa";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const TLS_NAMES = new Set(["maipai.local"]);
let cachedHosts = new Set<string>();
let cachedAt = 0;

async function allowedHosts(): Promise<Set<string>> {
  if (Date.now() - cachedAt < 60_000) return cachedHosts;
  const next = new Set([...LOCAL, ...TLS_NAMES]);
  try {
    const cert = getHouseholdLeafForServer().cert;
    for (const name of cert.match(/DNS:[^,\n]+/g) ?? []) {
      const host = name.slice(4).trim().toLowerCase();
      if (host && host !== "*.ts.net") next.add(host);
    }
  } catch { /* no household TLS leaf yet */ }
  // Every address this machine holds (LAN, Tailscale utun, link-local): a device that reaches the hub by raw IP typed it itself.
  for (const list of Object.values(networkInterfaces())) for (const iface of list ?? []) next.add(iface.address.toLowerCase());
  for (const endpoint of await listHubEndpoints()) {
    try { next.add(parseHostName(new URL(endpoint.url).host) ?? ""); } catch { /* malformed endpoints are not routable */ }
  }
  const configuredOrigin = process.env.APP_ORIGIN ?? process.env.PUBLIC_ORIGIN;
  if (configuredOrigin) {
    const value = configuredOrigin;
    try { next.add(parseHostName(new URL(value).host) ?? ""); } catch { /* ignore malformed configuration */ }
  }
  next.delete("");
  cachedHosts = next;
  cachedAt = Date.now();
  return next;
}

export const hostCheck: MiddlewareHandler = async (c, next) => {
  // First-run setup has its own stricter local-only Host response (403); let
  // that route guard preserve its established response contract.
  if (c.req.path === "/api/auth/setup" || c.req.path.startsWith("/api/setup/")) return next();
  const allowed = await allowedHosts();
  const host = parseHostName(c.req.header("host") ?? new URL(c.req.url).host);
  const forwarded = TRUST_PROXY ? c.req.header("x-forwarded-host")?.split(",")[0]?.trim() : undefined;
  const forwardedHost = parseHostName(forwarded);
  if ((host && allowed.has(host)) || (forwardedHost && allowed.has(forwardedHost))) return next();
  // A Tailscale MagicDNS name resolves only inside the household's tailnet (the household TLS leaf already carries *.ts.net),
  // so a page on the open internet cannot rebind one to this hub: the live hub is reached by exactly such a name.
  if (host?.endsWith(".ts.net") || forwardedHost?.endsWith(".ts.net")) return next();
  return c.json({ error: "This address is not one Home answers to.", next: "Open Home by its own address: the one shown under Settings, Advanced, Network and access." }, 421);
};

export function __resetHostCheckForTests(): void { cachedHosts = new Set(); cachedAt = 0; }
