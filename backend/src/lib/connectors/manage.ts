// HOUSE-02: add, rename, enable, disable and remove connector instances (the `integration` record, one per instance).
// Nothing here logs or audits an instance slug, label or address (design C3). Tokens go to the connector credential store.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { CONNECTOR_REF_PREFIX, deleteConnectorSecret, readConnectorSecret, writeConnectorSecret } from "./credentials";
import { DEFAULT_INSTANCE, instanceLanFetch, type ConnectorInstance, type ConnectorType, type InstanceDeps, type InstanceLanFetchResult } from "./instances";
import { getHouseholdSettingValue } from "@/lib/settings";
import { deleteExposure } from "@/lib/house/exposure";

export const MAX_INSTANCES_PER_TYPE = 8;
export type InstanceView = { type: ConnectorType; instance: string; label: string; address: string; enabled: boolean; virtual: boolean; hasToken: boolean };
export type ManageResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; message: string };

const NUMERIC_ADDRESS = /^http:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\/?$/;
const NAME: Record<ConnectorType, string> = { home_assistant: "Home Assistant", uptime_kuma: "Uptime Kuma", gitea: "Gitea", immich: "Immich", unifi: "UniFi", plex: "Plex" };
const noToken: ReadonlySet<ConnectorType> = new Set<ConnectorType>(["uptime_kuma"]);

export function checkAddress(type: ConnectorType, address: string): string | null {
  if (NUMERIC_ADDRESS.test(address.trim())) return null;
  return `The ${NAME[type]} address must be the numeric address of your ${NAME[type]} on your home network, for example http://192.0.2.10:8123. Type it in the Address box and save again.`;
}

export function slugFor(label: string): string {
  const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "");
  return base === "" ? "house" : base;
}

function rowsOf(type: ConnectorType) { return db.select().from(integrations).where(eq(integrations.type, type)).all(); }

function viewOf(row: typeof integrations.$inferSelect): InstanceView {
  return { type: row.type as ConnectorType, instance: row.instance, label: row.label, address: row.address, enabled: row.enabled, virtual: false, hasToken: noToken.has(row.type as ConnectorType) || credentialPresent(row.credentialRef) };
}
function credentialPresent(ref: string): boolean {
  const value = ref.startsWith(CONNECTOR_REF_PREFIX) ? readConnectorSecret(ref) : getHouseholdSettingValue(ref);
  return typeof value === "string" && value.trim() !== "";
}

/** Everything an admin sees in the list: enabled and disabled, not removed. A household with no record of the type still shows the virtual `default` Home Assistant. */
export function listInstanceViews(type: ConnectorType): InstanceView[] {
  const rows = rowsOf(type);
  if (rows.length === 0 && type === "home_assistant") {
    const address = getHouseholdSettingValue("home.base_url");
    return [{ type, instance: DEFAULT_INSTANCE, label: "Home", address: typeof address === "string" ? address : "", enabled: true, virtual: true, hasToken: credentialPresent("home.access_token") }];
  }
  return rows.filter((row) => row.deletedAt === null).map(viewOf).sort((a, b) => a.label.localeCompare(b.label) || a.instance.localeCompare(b.instance));
}

/** Turns the virtual `default` Home Assistant into a real record (the one-time migration), keeping the legacy keys as its credential reference. */
function materializeDefault(type: ConnectorType): void {
  if (type !== "home_assistant" || rowsOf(type).length > 0) return;
  const address = getHouseholdSettingValue("home.base_url");
  if (typeof address !== "string" || address.trim() === "") return;
  const stamp = new Date().toISOString();
  db.insert(integrations).values({ id: "integ-default-ha", type, instance: DEFAULT_INSTANCE, label: "Home", address: typeof address === "string" ? address : "", credentialRef: "home.access_token", options: "{}", enabled: true, deletedAt: null, provenance: "migrated:home.base_url", createdAt: stamp, updatedAt: stamp, hlc: nextHlc() }).run();
}

function find(type: ConnectorType, slug: string) {
  materializeDefault(type);
  return db.select().from(integrations).where(and(eq(integrations.type, type), eq(integrations.instance, slug), isNull(integrations.deletedAt))).get();
}

export function addInstance(input: { type: ConnectorType; label: string; address: string; token?: string | undefined }): ManageResult<InstanceView> {
  const label = input.label.trim();
  if (label === "" || label.length > 60) return { ok: false, status: 400, message: "Give this connection a name of 1 to 60 characters, for example Cabin." };
  const badAddress = checkAddress(input.type, input.address);
  if (badAddress) return { ok: false, status: 400, message: badAddress };
  const token = (input.token ?? "").trim();
  if (!noToken.has(input.type) && token === "") return { ok: false, status: 400, message: `Add a long-lived access token from ${NAME[input.type]}. Open your ${NAME[input.type]} profile, create one and paste it in the Token box.` };
  materializeDefault(input.type);
  const existing = rowsOf(input.type);
  if (existing.filter((row) => row.deletedAt === null).length >= MAX_INSTANCES_PER_TYPE) return { ok: false, status: 400, message: `You can connect up to ${MAX_INSTANCES_PER_TYPE} of these. Remove one you no longer use, then add this one.` };
  const taken = new Set(existing.map((row) => row.instance));
  // The first instance of a type is `default` (grants without a prefix mean it).
  const base = existing.length === 0 ? DEFAULT_INSTANCE : slugFor(label);
  let slug = base; let n = 2;
  while (taken.has(slug)) slug = `${base.slice(0, 24)}-${n++}`;
  const id = `integ-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const credentialRef = `${CONNECTOR_REF_PREFIX}${id}.token`;
  const stamp = new Date().toISOString();
  if (token !== "") writeConnectorSecret(credentialRef, token);
  db.insert(integrations).values({ id, type: input.type, instance: slug, label, address: input.address.trim(), credentialRef, options: "{}", enabled: true, deletedAt: null, provenance: "admin", createdAt: stamp, updatedAt: stamp, hlc: nextHlc() }).run();
  return { ok: true, value: viewOf(db.select().from(integrations).where(eq(integrations.id, id)).get()!) };
}

export function updateInstance(type: ConnectorType, slug: string, patch: { label?: string | undefined; address?: string | undefined; enabled?: boolean | undefined; token?: string | undefined }): ManageResult<InstanceView> {
  const row = find(type, slug);
  if (!row) return { ok: false, status: 404, message: "That connection no longer exists. Reload Settings, House and pick one from the list." };
  const set: Partial<typeof integrations.$inferInsert> = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (label === "" || label.length > 60) return { ok: false, status: 400, message: "Give this connection a name of 1 to 60 characters, for example Cabin." };
    set.label = label;
  }
  if (patch.address !== undefined) {
    const bad = checkAddress(type, patch.address);
    if (bad) return { ok: false, status: 400, message: bad };
    set.address = patch.address.trim();
  }
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  const token = patch.token?.trim() ?? "";
  if (token !== "") {
    // A migrated default keeps its legacy key; a new token for it moves to the connector store so the settings key stays untouched.
    let ref = row.credentialRef;
    if (!ref.startsWith(CONNECTOR_REF_PREFIX)) { ref = `${CONNECTOR_REF_PREFIX}${row.id}.token`; set.credentialRef = ref; }
    writeConnectorSecret(ref, token);
  }
  db.update(integrations).set({ ...set, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(integrations.id, row.id)).run();
  return { ok: true, value: viewOf(db.select().from(integrations).where(eq(integrations.id, row.id)).get()!) };
}

/** Removing tombstones the record (the slug is never reused) and forgets the stored secret and exposure list. */
export function removeInstance(type: ConnectorType, slug: string): ManageResult<true> {
  const row = find(type, slug);
  if (!row) return { ok: false, status: 404, message: "That connection no longer exists. Reload Settings, House and pick one from the list." };
  if (row.credentialRef.startsWith(CONNECTOR_REF_PREFIX)) deleteConnectorSecret(row.credentialRef);
  deleteExposure(type, slug);
  const stamp = new Date().toISOString();
  db.update(integrations).set({ enabled: false, deletedAt: stamp, updatedAt: stamp, hlc: nextHlc() }).where(eq(integrations.id, row.id)).run();
  return { ok: true, value: true };
}

/** A connection for Test and the exposure editor: works on a disabled instance too, so an admin can check it before turning it on. */
export function connectionFor(type: ConnectorType, slug: string, deps: InstanceDeps = {}): { instance: ConnectorInstance; connection: InstanceLanFetchResult } | null {
  const view = listInstanceViews(type).find((item) => item.instance === slug);
  if (!view) return null;
  const row = view.virtual ? null : db.select().from(integrations).where(and(eq(integrations.type, type), eq(integrations.instance, slug), isNull(integrations.deletedAt))).get();
  const instance: ConnectorInstance = { type, instance: slug, label: view.label, address: view.address, credentialRef: row?.credentialRef ?? "home.access_token", options: {}, virtual: view.virtual };
  return { instance, connection: instanceLanFetch(instance, deps) };
}
