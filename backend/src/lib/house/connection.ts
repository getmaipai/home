import type { createLanFetch, LanFetchDeps } from "@/lib/lanFetch";
import { DEFAULT_INSTANCE, instanceLanFetch, listInstances, resolveInstance } from "@/lib/connectors/instances";

export type HouseLanFetchFailure = {
  ok: false;
  reason: "not_set" | "bad_address" | "no_token";
  message: string;
};

export type HouseLanFetchSuccess = {
  ok: true;
  lanFetch: ReturnType<typeof createLanFetch>;
  token: string;
  host: string;
  port: number;
};

export type HouseLanFetchResult = HouseLanFetchSuccess | HouseLanFetchFailure;

export type HouseLanFetchDeps = {
  read?: (key: string) => unknown;
  fetch?: LanFetchDeps["fetch"];
  allowDelete?: boolean;
};

/** The default Home Assistant instance, resolved through the connector helper (the settings keys are read through as `default` until an `integration` record exists). */
export function houseLanFetch(deps: HouseLanFetchDeps = {}): HouseLanFetchResult {
  return houseInstanceLanFetch(DEFAULT_INSTANCE, deps);
}

/** One Home Assistant instance by slug. An unknown or disabled slug reads as not set. */
export function houseInstanceLanFetch(slug: string, deps: HouseLanFetchDeps = {}): HouseLanFetchResult {
  const instance = resolveInstance("home_assistant", slug, deps);
  if (!instance) return { ok: false, reason: "not_set", message: "Set the Home Assistant address in Settings, House before connecting." };
  return instanceLanFetch(instance, deps);
}

/** True when at least one enabled Home Assistant instance has a usable address and token. */
export function houseAnyConnected(deps: HouseLanFetchDeps = {}): boolean {
  return listInstances("home_assistant", deps).some((instance) => instanceLanFetch(instance, deps).ok);
}
