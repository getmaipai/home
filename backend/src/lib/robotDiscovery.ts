// ROBOT-DEVICE-01 (bot/docs/dev/design-reachy-mini-2026-09-27.md sections 9
// and 10): the Devices page's "Add a robot" flow finds a robot advertised
// on the LAN before an admin ever types anything. The daemon advertises
// itself as `_reachy-mini._tcp.local` with a TXT record naming its
// robot_name, model, version and hardware id (Pollen's own
// reachy_mini.utils.discovery, verified against bot's own running
// simulator on 2026-09-27: "mDNS service registered: reachy_mini on port
// 8000"). This mirrors lib/mdns.ts's own posture on the advertise side: a
// network that filters multicast, or any browser failure, is "found
// nothing" for the admin to retry, never a 500.
import { Bonjour } from "bonjour-service";

// bonjour-service's own `type` option omits the leading underscore and
// the `._tcp` suffix; it builds `_reachy-mini._tcp.local` from this same
// way lib/mdns.ts's own `type: "maipai"` becomes `_maipai._tcp.local`.
const SERVICE_TYPE = "reachy-mini";

export interface DiscoveredRobot {
  /** The daemon's own robot_name (its advertised name, "reachy_mini" by default). */
  name: string;
  /** The mDNS hostname the daemon answers on (e.g. "reachy-mini.local"). */
  host: string;
  port: number;
  addresses: string[];
  model: string | null;
  daemonVersion: string | null;
  /** The unit's hardware id, when the daemon reports one (absent in simulation). */
  unitId: string | null;
}

function toDiscoveredRobot(service: {
  name: string;
  host: string;
  port: number;
  addresses?: string[];
  txt?: unknown;
}): DiscoveredRobot {
  const txt = (service.txt ?? {}) as Record<string, string>;
  return {
    name: txt.robot_name ?? service.name,
    host: service.host,
    port: service.port,
    addresses: service.addresses ?? [],
    model: txt.model ?? null,
    daemonVersion: txt.version ?? null,
    unitId: txt.unit_id ?? null,
  };
}

/**
 * Browses the LAN for `_reachy-mini._tcp` for `windowMs`, then returns
 * whatever answered. Best-effort: a network that filters multicast, or
 * any browser failure, returns an empty list, never throws.
 */
export async function discoverRobots(windowMs = 2000): Promise<DiscoveredRobot[]> {
  const found = new Map<string, DiscoveredRobot>();
  let bonjour: Bonjour | null = null;
  try {
    bonjour = new Bonjour();
    const browser = bonjour.find({ type: SERVICE_TYPE });
    browser.on("up", (service) => {
      found.set(service.fqdn, toDiscoveredRobot(service));
    });
    await new Promise<void>((resolve) => setTimeout(resolve, windowMs));
    browser.stop();
  } catch (err) {
    console.error(`[robot-discovery] failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    bonjour?.destroy();
  }
  return Array.from(found.values());
}
