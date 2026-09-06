// The hub's address book: every URL a client can use to reach this
// server (session-f-platform-and-trust.md step 5, ported from the
// archived legacy hub with its own reasoning kept). Two sources, merged:
//   - detected   LAN IPv4 addresses and the Tailscale MagicDNS name,
//                refreshed on read (a DHCP lease change or a tailnet
//                reconnect must not strand a client)
//   - managed    rows an admin typed in Settings -> Server -> Addresses,
//                each with its own name and priority (db/schema.ts's
//                hubEndpoints table)
//
// Clients pull the merged list, cache it to disk, and walk it in
// priority order.
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { hubEndpoints } from "@/db/schema";
import { getTailscaleStatus } from "@/lib/tailscale";
import { newEndpointId } from "@/lib/id";
import { isPrivateOrLoopbackIpv4, isCgnatIpv4 } from "@/lib/ssrfGuard";

export type EndpointKind = "lan" | "overlay" | "public";
export type EndpointSource = "detected" | "managed";

export interface HubEndpoint {
  id: string;
  name: string;
  url: string;
  kind: EndpointKind;
  priority: number;
  enabled: boolean;
  source: EndpointSource;
}

const port = Number(process.env.PORT ?? 8787);

// Detected addresses sort ahead of typed ones by default: on the home
// network the LAN IP is the fastest path and the one least likely to
// depend on anything else being up. An admin who disagrees just gives
// their own row a lower number.
const DETECTED_LAN_PRIORITY = 10;
const DETECTED_TAILNET_PRIORITY = 60;

/** Normalize what a human typed into an origin we can compare and store. */
export function normalizeEndpointUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!url.hostname) return null;
  // Keep the origin only: a path would be silently prepended to every API call.
  return url.origin;
}

/** Guess where an address works, so a client can skip candidates that
 * cannot possibly answer on its current network. An admin can override
 * it on a managed row. */
export function guessEndpointKind(url: string): EndpointKind {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "lan";
  }
  if (host.endsWith(".ts.net")) return "overlay";
  if (host.endsWith(".local") || host === "localhost") return "lan";
  // Checked BEFORE the private/loopback check below (code review,
  // 2026-09-06): ssrfGuard.ts's own isPrivateOrLoopbackIpv4() now also
  // treats 100.64.0.0/10 as private, for the OPPOSITE reason this file
  // cares about it (SEC-3: refusing a package's host.fetch from landing
  // on the hub's own tailnet address). Here it means the opposite thing -
  // a legitimate way a CLIENT reaches the hub, "overlay" - so this has to
  // win before the private-range check would otherwise catch it as "lan".
  // Shares ssrfGuard.ts's own isCgnatIpv4() range check rather than a
  // second, independently-typed regex for the identical range (a review,
  // 2026-09-06, found the first version of this fix left one here).
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    if (isCgnatIpv4(a!, b!)) return "overlay"; // CGNAT range Tailscale uses
  }
  // Reuses ssrfGuard.ts's own hardened private/loopback/link-local check
  // (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x link-local, 0.x) - a
  // code review (2026-09-06) found this file had its own narrower regex
  // that missed 169.254.0.0/16 (link-local, includes the cloud-metadata
  // address 169.254.169.254) and 0.0.0.0/8 entirely, misclassifying both
  // as "public".
  if (isIP(host) === 4 && isPrivateOrLoopbackIpv4(host)) return "lan";
  if (host.includes(".")) return "public";
  return "lan";
}

// A code review (2026-09-06) found this re-implementing the exact same
// "parse the hostname, then classify it" steps guessEndpointKind() above
// already does - a second copy of the same logic, in the same file, that
// the next fix to one of them (this file's own history already has one:
// the 169.254.0.0/16 miss) can silently forget to apply to the other.
// guessEndpointKind() itself only ever sees a bare dotted-quad IPv4
// address here (detectLanIps() below is the only caller), so "lan" is
// exactly what "private" meant.
function isPrivate(url: string): boolean {
  return guessEndpointKind(url) === "lan";
}

/** Every non-internal, non-public IPv4 address on this machine, private
 * ranges first - exported for lib/householdCa.ts, whose leaf certificate
 * has to cover the same addresses this file offers clients, without
 * duplicating the detection logic a second time.
 *
 * A code review (2026-09-06) found the first version only excluded
 * `a.internal` addresses (loopback), never actually-public ones - a
 * machine with a NIC bound directly to a public IPv4 address (a cloud
 * VM, a box on an unfiltered WAN port) would have that address baked
 * into the household CA's leaf certificate SAN and offered to clients as
 * a candidate address, silently expanding "trust on the LAN"'s scope
 * past the LAN. `guessEndpointKind()`'s own classification (already the
 * one place that decision is made) is reused rather than a second
 * definition of "public." */
export function detectLanIps(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (guessEndpointKind(`http://${a.address}`) === "public") continue;
      out.push(a.address);
    }
  }
  // Private ranges first: on a machine with a VPN or Docker bridge up,
  // the 192.168/10.x address is the one a phone in the house can
  // actually route to.
  return out.sort((a, b) => Number(isPrivate(`http://${b}`)) - Number(isPrivate(`http://${a}`)));
}

function detectLanUrls(): string[] {
  return detectLanIps().map((ip) => `http://${ip}:${port}`);
}

async function detectTailnetUrls(): Promise<string[]> {
  const status = await getTailscaleStatus();
  if (status.state !== "running") return [];
  // MagicDNS name first (stable across reconnects), the tailnet IP as backup.
  const hosts = [status.dnsName, ...status.ips].filter((h): h is string => !!h);
  return hosts.map((h) => `http://${h.includes(":") ? `[${h}]` : h}:${port}`);
}

function toHubEndpoint(row: typeof hubEndpoints.$inferSelect): HubEndpoint {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    kind: row.kind as EndpointKind,
    priority: row.priority,
    enabled: row.enabled,
    source: "managed",
  };
}

/** Admin-managed rows, in priority order. */
export function listManagedEndpoints(): HubEndpoint[] {
  return db.select().from(hubEndpoints).orderBy(asc(hubEndpoints.priority)).all().map(toHubEndpoint);
}

/** The full address book a client should cache: detected plus managed,
 * deduped by URL (a managed row wins, because it carries the name the
 * admin chose) and sorted by priority. Disabled rows are dropped here,
 * not shipped to clients. */
export async function listHubEndpoints(opts: { includeDisabled?: boolean } = {}): Promise<HubEndpoint[]> {
  const managed = listManagedEndpoints();
  const claimed = new Set(managed.map((e) => e.url));

  const detected: HubEndpoint[] = [];
  for (const url of detectLanUrls()) {
    if (claimed.has(url)) continue;
    claimed.add(url);
    // Every non-internal interface shows up here, including a Tailscale
    // one: classify by address rather than by "we found it on an
    // interface", or the tailnet IP would be offered to clients as a
    // home-network address and probed first on cellular.
    const kind = guessEndpointKind(url);
    detected.push({
      id: `detected:${url}`,
      name: kind === "overlay" ? "Tailscale" : "This network",
      url,
      kind,
      priority: kind === "overlay" ? DETECTED_TAILNET_PRIORITY : DETECTED_LAN_PRIORITY,
      enabled: true,
      source: "detected",
    });
  }
  for (const url of await detectTailnetUrls()) {
    if (claimed.has(url)) continue;
    claimed.add(url);
    detected.push({
      id: `detected:${url}`,
      name: "Tailscale",
      url,
      kind: "overlay",
      priority: DETECTED_TAILNET_PRIORITY,
      enabled: true,
      source: "detected",
    });
  }

  return [...managed, ...detected]
    .filter((e) => opts.includeDisabled || e.enabled)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

// A code review (2026-09-06) found the first version started at 10 -
// identical to DETECTED_LAN_PRIORITY above, so a fresh install's first
// managed row tied with the detected LAN entry for priority, leaving
// which one won purely to the sort's alphabetical tiebreak rather than
// this file's own stated design ("detected addresses sort ahead of
// typed ones by default"). Starting past DETECTED_LAN_PRIORITY restores
// that: an admin who genuinely wants a managed row to win still can, by
// reordering it to a lower number explicitly (reorderEndpoints()).
export function nextEndpointPriority(): number {
  const rows = db.select({ priority: hubEndpoints.priority }).from(hubEndpoints).all();
  const max = rows.reduce((m, r) => Math.max(m, r.priority), DETECTED_LAN_PRIORITY);
  return max + 10;
}

export interface AddEndpointResult {
  ok: boolean;
  error?: string;
  value?: HubEndpoint;
}

/** Adds a managed row. Refuses an unparseable URL rather than storing
 * garbage a client would fail to connect to later with no useful error
 * at the time it mattered. */
export function addManagedEndpoint(name: string, rawUrl: string, kind?: EndpointKind): AddEndpointResult {
  const url = normalizeEndpointUrl(rawUrl);
  if (!url) return { ok: false, error: `not a valid address: ${rawUrl}` };
  const id = newEndpointId();
  const resolvedName = name.trim().slice(0, 60) || url;
  const resolvedKind = kind ?? guessEndpointKind(url);
  const priority = nextEndpointPriority();
  const now = new Date().toISOString();
  db.insert(hubEndpoints)
    .values({ id, name: resolvedName, url, kind: resolvedKind, priority, enabled: true, createdAt: now, updatedAt: now })
    .run();
  return { ok: true, value: { id, name: resolvedName, url, kind: resolvedKind, priority, enabled: true, source: "managed" } };
}

export function removeManagedEndpoint(id: string): boolean {
  const existing = db.select({ id: hubEndpoints.id }).from(hubEndpoints).where(eq(hubEndpoints.id, id)).get();
  if (!existing) return false;
  db.delete(hubEndpoints).where(eq(hubEndpoints.id, id)).run();
  return true;
}

/** Reorder: assign 10, 20, 30... in the given id order. Ids not in the
 * list keep their current priority and simply sort after (they get
 * pushed past the end). */
export function reorderEndpoints(orderedIds: string[]): void {
  const now = new Date().toISOString();
  let priority = 10;
  for (const id of orderedIds) {
    db.update(hubEndpoints).set({ priority, updatedAt: now }).where(eq(hubEndpoints.id, id)).run();
    priority += 10;
  }
}
