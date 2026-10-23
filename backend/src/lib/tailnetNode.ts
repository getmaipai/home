// CODE-API-01: coding from one of the household's own devices over Tailscale Serve. Serve is a proxy on this computer: the hub's socket peer is loopback and the
// request carries x-forwarded-* headers, which the transport rules in codeGate.ts refuse as "a proxy". This is the one exception, and it is
// narrow: the request must come from loopback, carry only the three headers Serve adds, name a tailnet source address once, and Tailscale itself
// (the local daemon's whois) must say that address is one of this household's own devices: the same Tailscale account as this computer, not a tagged
// device. The API key check is not touched and still runs after it.
// Fails closed: no socket, no answer from Tailscale, a login that does not match, or anything unexpected all mean "refused".
import { existsSync, readdirSync } from "node:fs";
import type { Context } from "hono";
import { getClientIp as rawPeerAddress } from "@maipai/core/src/secretThrottle";
import { isPublicHost, isTailnetAddress, PROXY_HEADERS } from "@/lib/codeGate";
import { getHouseholdSettingValue } from "@/lib/settings";

export interface TailnetNode { name: string; login: string | null }
export type WhoisLookup = (address: string) => Promise<TailnetNode | null>;

/** The three forwarding headers Serve itself adds. Any other proxy header means another proxy is in the path. */
const SERVE_HEADERS = new Set(["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]);
const CACHE_MS = 30_000;

/** The local Tailscale daemon's socket: TAILSCALE_SOCKET when set, else the standard one, else the user-mode daemon's under a home folder (how this Mac runs it). */
const socketCandidates = (): string[] => [
  ...(process.env.TAILSCALE_SOCKET ? [process.env.TAILSCALE_SOCKET] : []),
  "/var/run/tailscaled.socket",
  ...(() => { try { return readdirSync("/Users").map((user) => `/Users/${user}/Library/Application Support/tailscale-user/tailscaled.sock`); } catch { return []; } })(),
];
const socketPath = (): string => socketCandidates().find((path) => existsSync(path)) ?? "/var/run/tailscaled.socket";

/** Tailscale's own answer for an address, from the local daemon (LocalAPI over its unix socket). Null on any problem. */
export async function whoisViaSocket(address: string): Promise<TailnetNode | null> {
  try {
    const res = await fetch(`http://local-tailscaled.sock/localapi/v0/whois?addr=${encodeURIComponent(`${address}:0`)}`, { unix: socketPath(), signal: AbortSignal.timeout(2000) } as RequestInit);
    if (!res.ok) return null;
    const body = await res.json() as { Node?: { ComputedName?: unknown; Name?: unknown; Tags?: unknown }; UserProfile?: { LoginName?: unknown } };
    const node = body.Node;
    if (!node) return null;
    // A tagged device has no owner login to compare; it is never accepted here.
    if (Array.isArray(node.Tags) && node.Tags.length > 0) return null;
    const computed = typeof node.ComputedName === "string" && node.ComputedName ? node.ComputedName : typeof node.Name === "string" ? node.Name.split(".")[0] ?? "" : "";
    if (!computed) return null;
    return { name: computed.toLowerCase(), login: typeof body.UserProfile?.LoginName === "string" ? body.UserProfile.LoginName.toLowerCase() : null };
  } catch { return null; }
}

/** The Tailscale account this computer is signed in to, from the daemon's own status. Null on any problem. */
export async function selfLoginViaSocket(): Promise<string | null> {
  try {
    const res = await fetch("http://local-tailscaled.sock/localapi/v0/status?peers=false", { unix: socketPath(), signal: AbortSignal.timeout(2000) } as RequestInit);
    if (!res.ok) return null;
    const body = await res.json() as { Self?: { UserID?: unknown }; User?: Record<string, { LoginName?: unknown }> };
    const id = body.Self?.UserID;
    const login = id !== undefined ? body.User?.[String(id)]?.LoginName : undefined;
    return typeof login === "string" && login ? login.toLowerCase() : null;
  } catch { return null; }
}

let selfLogin: () => Promise<string | null> = selfLoginViaSocket;
let selfCache: { at: number; login: string | null } | null = null;
export function __setSelfLoginForTests(fn: (() => Promise<string | null>) | null): void { selfLogin = fn ?? selfLoginViaSocket; selfCache = null; }
async function ownLogin(): Promise<string | null> {
  if (selfCache && Date.now() - selfCache.at < CACHE_MS) return selfCache.login;
  const login = await selfLogin();
  selfCache = { at: Date.now(), login };
  return login;
}

let lookup: WhoisLookup = whoisViaSocket;
const cache = new Map<string, { at: number; node: TailnetNode | null }>();
export function __setWhoisForTests(fn: WhoisLookup | null): void { lookup = fn ?? whoisViaSocket; cache.clear(); }

async function nodeFor(address: string): Promise<TailnetNode | null> {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.node;
  const node = await lookup(address);
  cache.set(address, { at: Date.now(), node });
  return node;
}

const loopback = (address: string): boolean => /^(::1|(::ffff:)?127\.)/i.test(address);

/** True when this request came through Tailscale Serve from one of this household's own devices. Never throws. */
export async function tailnetServeAllows(c: Context): Promise<boolean> {
  try {
    if (getHouseholdSettingValue("coding.api.away") !== true) return false;
    if (isPublicHost(c)) return false;
    if (!loopback(rawPeerAddress(c, { trustProxy: false }) ?? "")) return false;
    if (PROXY_HEADERS.some((name) => !SERVE_HEADERS.has(name) && c.req.header(name) !== undefined)) return false;
    if (c.req.header("x-forwarded-proto")?.toLowerCase() !== "https") return false;
    const source = c.req.header("x-forwarded-for")?.trim();
    // One address only: a list means more than one hop, so the first entry cannot be trusted as the device.
    if (!source || source.includes(",") || !isTailnetAddress(source)) return false;
    const node = await nodeFor(source);
    // Only this household's own devices: the same account as this computer. A device on another account, or a tagged one (no login), is refused.
    const own = await ownLogin();
    if (!node || !node.login || !own || node.login !== own) return false;
    const header = c.req.header("tailscale-user-login")?.trim().toLowerCase();
    if (header !== undefined && header !== node.login) return false;
    return true;
  } catch { return false; }
}
