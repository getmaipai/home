// The link to the Stack's own admin page, for Home's Settings page. Home never proxies the admin page; it only says where it is: on this computer over
// loopback, and from any other computer over the tailnet when the Stack really listens there. The Stack alone knows that (`GET /stack/v1/admin-access`:
// the setting only takes effect at its next start, and nothing is bound when the computer has no Tailscale address), so Home uses the Stack's own
// answer and keeps none of it. Home and the Stack run on the same computer, so the tailnet address is the one Home itself is reached on.
import { getStackUrl, isRemoteStackSelected } from "@/lib/stackEngine";
import { forwardToStack } from "@/lib/stackChoicesForward";
import { getTailscaleStatus } from "@/lib/tailscale";

const DEFAULT_PORT = 8770;
const SETTING = "stack.admin.tailscale";

export type RemoteAdminState = "listening" | "restart_pending" | "no_address" | "off" | "unknown";

export interface AdminLink {
  local_url: string | null;
  /** The sign-in page on the tailnet address, only while the Stack listens there. */
  remote_url: string | null;
  /** Why there is no remote link, in plain words with the next step; null when there is one. */
  reason: string | null;
  remote_state: RemoteAdminState;
  /** True when Home can turn the Stack's Tailscale setting on for the person (state off). */
  can_turn_on: boolean;
}

export interface AdminLinkInput {
  port: number;
  onThisComputer: boolean;
  /** What the Stack reports about its Tailscale listener; null when it could not be asked. */
  access: { state: RemoteAdminState; url: string | null; message: string | null } | null;
}

const ASK_FAILED = "Home could not ask the Stack where its admin page is. Check that the Stack is running, then try again.";

/** The links and the plain reason. The local link only when the Stack runs on this computer; the remote link only while the Stack says it listens on the tailnet. */
export function buildAdminLink({ port, onThisComputer, access }: AdminLinkInput): AdminLink {
  const local_url = onThisComputer ? `http://127.0.0.1:${port}/admin/` : null;
  if (!access) return { local_url, remote_url: null, reason: ASK_FAILED, remote_state: "unknown", can_turn_on: false };
  const remote_url = access.state === "listening" ? access.url : null;
  return { local_url, remote_url, reason: remote_url ? null : access.message, remote_state: access.state, can_turn_on: access.state === "off" };
}

interface Reported { state: RemoteAdminState; url: string | null; message: string | null }

const defaultProbe = async (url: string): Promise<boolean> => {
  try { return (await fetch(`${url.replace(/admin\/$/, "")}healthz`, { signal: AbortSignal.timeout(1_500) })).ok; } catch { return false; }
};
let probe: (url: string) => Promise<boolean> = defaultProbe;
const defaultAddress = async (): Promise<string | null> => (await getTailscaleStatus()).ips.find((ip) => !ip.includes(":")) ?? null;
let tailnetAddress: () => Promise<string | null> = defaultAddress;
export function __setAdminLinkSeamsForTests(seams: { probe?: (url: string) => Promise<boolean>; address?: () => Promise<string | null> } | null): void { probe = seams?.probe ?? defaultProbe; tailnetAddress = seams?.address ?? defaultAddress; }
const NOT_LISTENING = "The setting is on, but the Stack is not listening on your tailnet yet. Restart the Stack, then this link works from any computer on your tailnet.";

/** The Stack's own report. An older Stack without that route is read from its settings instead (in effect means listening on this computer's tailnet address). */
async function readAccess(port: number): Promise<Reported | null> {
  try {
    const { body } = await forwardToStack("GET", "/stack/v1/admin-access");
    const t = (body as { tailscale?: { state?: unknown; url?: unknown; message?: unknown } } | null)?.tailscale;
    if (t && typeof t.state === "string") return { state: t.state as RemoteAdminState, url: typeof t.url === "string" ? t.url : null, message: typeof t.message === "string" ? t.message : null };
  } catch { /* an older Stack has no such route: fall through to its settings */ }
  try {
    const { body } = await forwardToStack("GET", "/stack/v1/settings");
    const settings = (body as { settings?: unknown } | null)?.settings;
    const entry = Array.isArray(settings) ? settings.find((s) => (s as { key?: unknown })?.key === SETTING) as { in_effect?: unknown; pending?: unknown } | undefined : undefined;
    if (!entry) return null;
    if (entry.in_effect === true) {
      const address = await tailnetAddress();
      if (address) {
        // An older Stack cannot say whether it bound the address, so ask the address itself before offering it.
        const url = `http://${address}:${port}/admin/`;
        return (await probe(url)) ? { state: "listening", url, message: null } : { state: "restart_pending", url: null, message: NOT_LISTENING };
      }
      return { state: "no_address", url: null, message: "The setting is on, but this computer has no Tailscale address. Sign in to Tailscale on this computer, then restart the Stack." };
    }
    if (entry.pending === true) return { state: "restart_pending", url: null, message: "The setting is on and takes effect when the Stack restarts. Restart the Stack, then this link works from any computer on your tailnet." };
    return { state: "off", url: null, message: "Turn on \"Admin page over Tailscale\" to open the admin page from another computer." };
  } catch {
    return null;
  }
}

/** Reads what `buildAdminLink` needs from the live machine: the Stack's port, whether it runs here, and what it says about its tailnet listener. */
export async function readAdminLink(): Promise<AdminLink> {
  let port = DEFAULT_PORT;
  try {
    const url = getStackUrl();
    if (url) port = Number(new URL(url).port) || DEFAULT_PORT;
  } catch {
    // An unreadable engine link keeps the default port.
  }
  return buildAdminLink({ port, onThisComputer: !isRemoteStackSelected(), access: await readAccess(port) });
}

/** Turns the Stack's "Admin page over Tailscale" setting on (the Stack stores it as pending until its next start) and answers the new link state. */
export async function turnOnRemoteAdmin(): Promise<AdminLink> {
  await forwardToStack("PUT", "/stack/v1/settings", { [SETTING]: true });
  return readAdminLink();
}
