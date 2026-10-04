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
import { raiseIssue, resolveIssue } from "@/lib/issues";

const SERVICE_TYPE = "maipai";
const ISSUE_SOURCE = "mdns";
const ISSUE_KEY = "advertise_failed";
/** How long the pre-publish check listens for an existing holder of the
 * name. bonjour-service's own probe waits about 750ms (3 queries, 250ms
 * apart); this matches it with a little headroom for a slow network. */
const NAME_CHECK_MS = 1_200;

/** The host label the service record points at (MDNS-HOST-01). Without an
 * explicit `host`, bonjour-service defaults it to os.hostname() and announces
 * A/AAAA records for the machine's OWN .local name (dist/lib/service.js line
 * 32, RecordA/RecordAAAA); macOS's mDNSResponder reads that as a conflict on
 * its own host name and renames the computer ("-2"). Our own label never
 * claims the machine's name. */
export function mdnsHostLabel(): string {
  return `maipai-${getHubInstanceId().slice(0, 8).toLowerCase()}.local`;
}

/** Only the one real hub advertises: MAIPAI_MDNS=off turns it off, =on forces
 * it on, and unset means off under NODE_ENV=test and for a scratch Home (the
 * one-hub-lock opt-out env every throwaway launcher already sets). */
function mdnsEnabled(): boolean {
  const flag = process.env.MAIPAI_MDNS?.trim().toLowerCase();
  if (flag === "off") return false;
  if (flag === "on") return true;
  return process.env.NODE_ENV !== "test" && !process.env.MAIPAI_TEST_ALLOW_MULTIPLE_HUBS;
}

let bonjour: Bonjour | null = null;
let service: Service | null = null;

export interface AdvertiseOptions {
  port: number;
  tls: boolean;
}

/** This hub's DNS-SD instance name: the display name plus the first four
 * characters of its instance id, so two households that both kept the
 * default name do not collide, and the same hub keeps the same name across
 * restarts. Clients read the display name from TXT `name`, never from this. */
function instanceName(): string {
  // A DNS label is at most 63 bytes; leave room for "-xxxx" and " (2)".
  let shown = getHubName();
  while (Buffer.byteLength(shown) > 54) shown = shown.slice(0, -1);
  return `${shown}-${getHubInstanceId().slice(0, 4)}`;
}

/** Whether a different hub already holds this instance name on the LAN.
 * An announcement carrying this hub's own id (a stale one from before a
 * restart) does not count: it is us, and the new one replaces it.
 *
 * Why this exists instead of letting the library probe: on a clash
 * bonjour-service's own probe calls service.stop() and only console.log()s
 * an Error from inside its callback (dist/lib/registry.js line 32), so
 * nothing throws and nothing can be detected afterwards. Worse, that stop()
 * sends goodbye records (ttl 0) for the very name the other host owns,
 * which would knock the other hub off the network. We look first, with a
 * plain browse, and publish with the library's probe off (line 38-39). */
async function nameTakenByAnother(b: Bonjour, name: string): Promise<boolean> {
  const ownId = getHubInstanceId();
  let taken = false;
  const browser = b.find({ type: SERVICE_TYPE }, (svc) => {
    if (svc.name === name && svc.txt?.id !== ownId) taken = true;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, NAME_CHECK_MS));
  browser.stop();
  return taken;
}

/** Best-effort: a network that filters multicast, or any other responder
 * failure, means no auto-discovery - never a boot failure. Safe to call
 * more than once (stops any previous advertisement first), the same
 * shape a leaf-certificate renewal or a port change would need to
 * re-advertise with updated TXT fields. Tries the hub's own instance
 * name, then once more with the Bonjour " (2)" suffix; if both are taken
 * (or the responder fails) it raises a Repairs issue instead of staying
 * silent (#193). */
export async function advertiseMdns(opts: AdvertiseOptions): Promise<void> {
  let mine: Bonjour | null = null;
  try {
    await stopMdnsAdvertisement();
    if (!mdnsEnabled()) return;
    const b = new Bonjour();
    bonjour = b;
    mine = b;
    const base = instanceName();
    for (const name of [base, `${base} (2)`]) {
      const taken = await nameTakenByAnother(b, name);
      if (bonjour !== b) return; // stopped or restarted while we were checking
      if (taken) continue;
      service = b.publish({
        name,
        type: SERVICE_TYPE,
        port: opts.port,
        host: mdnsHostLabel(),
        probe: false,
        txt: {
          id: getHubInstanceId(),
          name: getHubName(),
          tls: opts.tls ? "1" : "0",
          v: "1",
        },
      });
      console.log(`[mdns] advertising ${name} on host ${mdnsHostLabel()}`);
      resolveIssue(ISSUE_SOURCE, ISSUE_KEY);
      return;
    }
    if (bonjour !== b) return;
    await stopMdnsAdvertisement();
    await raiseAdvertiseIssue(`Both "${base}" and "${base} (2)" are already in use on the network.`);
  } catch (err) {
    // A newer advertiseMdns() call tore our Bonjour instance down mid-check;
    // that is a restart, not a failure worth a Repairs issue.
    if (bonjour !== mine) return;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mdns] failed to advertise: ${message}`);
    await raiseAdvertiseIssue(message);
  }
}

async function raiseAdvertiseIssue(detail: string): Promise<void> {
  console.error(`[mdns] not advertising: ${detail}`);
  try {
    await raiseIssue({
      source: ISSUE_SOURCE,
      key: ISSUE_KEY,
      severity: "warning",
      title: "Other devices on your network can't find this hub automatically",
      detail: `The hub could not announce itself on your home network, so apps will not find it on their own until you type its address. ${detail} Restarting the hub, or giving it a different name, usually clears this.`,
    });
  } catch (err) {
    console.error(`[mdns] could not record the Repairs issue: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function stopMdnsAdvertisement(): Promise<void> {
  const b = bonjour;
  if (!b) return;
  bonjour = null;
  service = null;
  await new Promise<void>((resolve) => b.unpublishAll(() => resolve()));
  b.destroy();
}

/** Test-only / diagnostic: whether an advertisement is currently active. */
export function isMdnsAdvertising(): boolean {
  return service !== null;
}
