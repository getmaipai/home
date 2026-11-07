// CONN-INSTANCES-01: the one place that lists, resolves and connects to the instances of a connector type.
// Instances are `integration` records (spec). A household with no home_assistant record still has one virtual instance,
// `default`, read through from the existing settings keys, so nothing that works today stops working.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { createLanFetch, type LanFetchDeps } from "@/lib/lanFetch";
import { getHouseholdSettingValue } from "@/lib/settings";

export type ConnectorType = "home_assistant" | "uptime_kuma" | "gitea" | "immich" | "unifi" | "plex";
export const DEFAULT_INSTANCE = "default";
/** What callers see of an instance. It never carries the secret: `credentialRef` names where the credentials center keeps it. */
export type ConnectorInstance = {
  type: ConnectorType;
  instance: string;
  label: string;
  address: string;
  credentialRef: string;
  /** Per-type options (Uptime Kuma: `status_page`). Virtual default instances carry none. */
  options: Record<string, string>;
  virtual: boolean;
};

export type InstanceDeps = {
  /** Reads a household setting (address for the virtual default, secret by reference). */
  read?: (key: string) => unknown;
  fetch?: LanFetchDeps["fetch"];
  /** Lets the connection send DELETE (default false). */
  allowDelete?: boolean;
};

export type InstanceLanFetchFailure = { ok: false; reason: "not_set" | "bad_address" | "no_token"; message: string };
export type InstanceLanFetchSuccess = { ok: true; lanFetch: ReturnType<typeof createLanFetch>; token: string; host: string; port: number };
export type InstanceLanFetchResult = InstanceLanFetchSuccess | InstanceLanFetchFailure;

const DEFAULT_PORT: Record<ConnectorType, number> = { home_assistant: 8123, uptime_kuma: 3001, gitea: 3000, immich: 2283, unifi: 443, plex: 32400 };
const NAME: Record<ConnectorType, string> = { home_assistant: "Home Assistant", uptime_kuma: "Uptime Kuma", gitea: "Gitea", immich: "Immich", unifi: "UniFi", plex: "Plex" };

function parseOptions(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}

/** Types whose instances need no secret: they read a public status page. */
const NO_CREDENTIAL: ReadonlySet<ConnectorType> = new Set<ConnectorType>(["uptime_kuma"]);

function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split(".");
  return parts.length === 4 && parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

/** Live (enabled, not removed) instances of a type, sorted by label. With no record of the type, Home Assistant has the virtual `default`. */
export function listInstances(type: ConnectorType, deps: InstanceDeps = {}): ConnectorInstance[] {
  const rows = db.select().from(integrations).where(and(eq(integrations.type, type), isNull(integrations.deletedAt))).all();
  const anyRecord = rows.length > 0 || db.select({ id: integrations.id }).from(integrations).where(eq(integrations.type, type)).get() !== undefined;
  if (!anyRecord && type === "home_assistant") {
    const read = deps.read ?? getHouseholdSettingValue;
    const address = read("home.base_url");
    return [{ type, instance: DEFAULT_INSTANCE, label: "Home", address: typeof address === "string" ? address : "", credentialRef: "home.access_token", options: {}, virtual: true }];
  }
  return rows.filter((row) => row.enabled)
    .map((row): ConnectorInstance => ({ type, instance: row.instance, label: row.label, address: row.address, credentialRef: row.credentialRef, options: parseOptions(row.options), virtual: false }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.instance.localeCompare(b.instance));
}

/** One instance by slug (the `default` one when no slug is given); null when it does not exist or is not enabled. */
export function resolveInstance(type: ConnectorType, slug?: string, deps: InstanceDeps = {}): ConnectorInstance | null {
  const wanted = slug === undefined || slug === "" ? DEFAULT_INSTANCE : slug;
  return listInstances(type, deps).find((item) => item.instance === wanted) ?? null;
}

/** The same shape `houseLanFetch()` always had, built on this instance's own host and port only. The token is read by reference and only returned inside the success result. */
export function instanceLanFetch(instance: ConnectorInstance, deps: InstanceDeps = {}): InstanceLanFetchResult {
  const read = deps.read ?? getHouseholdSettingValue;
  const name = NAME[instance.type];
  const baseUrl = instance.address;
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    return { ok: false, reason: "not_set", message: `Set the ${name} address in Settings, House before connecting.` };
  }
  const badAddress: InstanceLanFetchFailure = { ok: false, reason: "bad_address", message: `The ${name} address must be the numeric address of your ${name} on your home network, for example http://192.168.1.20:${DEFAULT_PORT[instance.type]}. Open Settings, House and fix it.` };

  let url: URL;
  try { url = new URL(baseUrl); } catch { return badAddress; }
  if (url.protocol !== "http:" || !isIpv4Literal(url.hostname) || url.username !== "" || url.password !== "" ||
      (url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "") return badAddress;

  const needsToken = !NO_CREDENTIAL.has(instance.type);
  const tokenValue = needsToken ? read(instance.credentialRef) : "";
  const token = typeof tokenValue === "string" ? tokenValue : "";
  if (needsToken && token.trim() === "") return { ok: false, reason: "no_token", message: `A ${name} access token is needed. Open Settings, House and add it.` };

  // The URL parser drops an explicit :80 (the http default), so check the text before falling back to the type's port.
  const explicit80 = url.port === "" && /^[a-z]+:\/\/[^/]+:80\/?$/i.test(baseUrl.trim());
  const port = url.port !== "" ? Number(url.port) : explicit80 ? 80 : DEFAULT_PORT[instance.type];
  try {
    const lanFetch = createLanFetch({ host: url.hostname, port, ...(deps.allowDelete ? { allowDelete: true } : {}) }, deps.fetch === undefined ? {} : { fetch: deps.fetch });
    return { ok: true, lanFetch, token, host: url.hostname, port };
  } catch { return badAddress; }
}
