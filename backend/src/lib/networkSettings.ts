import { getHouseholdSettingSource, getHouseholdSettingValue } from "@/lib/settings";
import { DEFAULT_HOME_PORT } from "@/lib/ports";

export const LAN_EXPOSURE_SETTING = "network.lan_exposure";
export const HUB_PORT_SETTING = "network.hub_port";

/** The process port remains the development/installer default until an
 * administrator has saved a port. An explicit setting takes effect on the
 * next Home restart. */
export function configuredHubPort(): number {
  if (getHouseholdSettingSource(HUB_PORT_SETTING) !== undefined) {
    return Number(getHouseholdSettingValue(HUB_PORT_SETTING));
  }
  return Number(process.env.PORT ?? getHouseholdSettingValue(HUB_PORT_SETTING) ?? DEFAULT_HOME_PORT);
}

export function configuredLanExposure(): "loopback" | "lan" {
  return getHouseholdSettingValue(LAN_EXPOSURE_SETTING) === "loopback" ? "loopback" : "lan";
}

/** Returns false if any listener address Home will need is already held.
 * Settings routes skip the active port for port writes because Home itself
 * holds it until the scheduled service restart. */
export function canBindHubPort(port: number, exposure: "loopback" | "lan", addresses: string[] = []): boolean {
  const hosts: Array<string | undefined> = exposure === "loopback"
    ? ["127.0.0.1", "::1"]
    : [undefined, "127.0.0.1", "::1", ...addresses];
  for (const hostname of [...new Set(hosts)]) {
    let server: Bun.Server<any> | undefined;
    try {
      server = Bun.serve({ ...(hostname ? { hostname } : {}), port, fetch: () => new Response(null) });
    } catch {
      return false;
    } finally {
      server?.stop(true);
    }
  }
  return true;
}

export const HUB_PORT_IN_USE_MESSAGE = "That port is already in use. Choose a free port, then save again.";
