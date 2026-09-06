// Advertises this hub on the LAN as `_maipai._tcp.local` (session-f-
// platform-and-trust.md step 5), so a client on the same network -
// another device in the household, a future MaiPai Go build - can find
// it without anyone typing an IP address. `bonjour-service` (MIT, an
// actively maintained fork of the old `bonjour` package) is a pure-JS
// mDNS/DNS-SD responder, per this step's own "a pure-JS responder"
// requirement - no native mDNS daemon dependency (Bonjour on macOS,
// Avahi on Linux) needed for the hub to announce itself, though a
// household that already has one running alongside it is unaffected
// (multiple responders advertising the same service is normal on a real
// network).
//
// TXT record fields (this file's own design - the platform plan's
// exact field list for this wasn't available in this checkout; see
// docs/dev/session-f.md's step 5 section for that call): `id` (this
// hub's instance id, so a client that already trusts one hub's identity
// can tell it apart from a different box also answering on this name),
// `name` (the household's chosen display name), `tls` ("1" once a
// leaf certificate exists and the server is actually terminating TLS,
// "0" otherwise - a client needs to know which scheme to try first),
// `v` (this TXT record shape's own version, "1" today, so a future
// field addition/rename doesn't have to guess what an old hub is
// still sending).
import { Bonjour, type Service } from "bonjour-service";
import { getHubInstanceId, getHubName } from "@/lib/hubIdentity";

const SERVICE_TYPE = "maipai";

let bonjour: Bonjour | null = null;
let service: Service | null = null;

export interface AdvertiseOptions {
  port: number;
  tls: boolean;
}

/** Best-effort: a network that filters multicast, or any other responder
 * failure, means no auto-discovery - never a boot failure. Safe to call
 * more than once (stops any previous advertisement first), the same
 * shape a leaf-certificate renewal or a port change would need to
 * re-advertise with updated TXT fields. */
export async function advertiseMdns(opts: AdvertiseOptions): Promise<void> {
  try {
    await stopMdnsAdvertisement();
    bonjour = new Bonjour();
    service = bonjour.publish({
      name: getHubName(),
      type: SERVICE_TYPE,
      port: opts.port,
      txt: {
        id: getHubInstanceId(),
        name: getHubName(),
        tls: opts.tls ? "1" : "0",
        v: "1",
      },
    });
  } catch (err) {
    console.error(`[mdns] failed to advertise: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function stopMdnsAdvertisement(): Promise<void> {
  if (!bonjour) return;
  await new Promise<void>((resolve) => bonjour!.unpublishAll(() => resolve()));
  bonjour.destroy();
  bonjour = null;
  service = null;
}

/** Test-only / diagnostic: whether an advertisement is currently active. */
export function isMdnsAdvertising(): boolean {
  return service !== null;
}
