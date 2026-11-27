// The link to the Stack's own admin page, for Home's Settings page. Home never proxies the admin page; it only says where it is: on this
// computer over loopback, and over Tailscale when the Stack has remote access turned on and this computer actually has a Tailscale address.
import os from "node:os";
import { getStackUrl, isRemoteStackSelected } from "@/lib/stackEngine";
import { forwardToStack } from "@/lib/stackChoicesForward";

const DEFAULT_PORT = 8770;

export interface AdminLinkInput {
  port: number;
  onThisComputer: boolean;
  remoteOn: boolean;
  tailscaleAddress: string | null;
}

export interface AdminLink {
  local_url: string | null;
  remote_url: string | null;
  reason: string | null;
}

/** The links and the plain reason. Loopback only when the Stack runs here; the remote link only when remote access is on and an address exists. */
export function buildAdminLink({ port, onThisComputer, remoteOn, tailscaleAddress }: AdminLinkInput): AdminLink {
  if (!onThisComputer) return { local_url: null, remote_url: null, reason: "The Stack runs on another computer. Open its admin page on that computer." };
  const local_url = `http://127.0.0.1:${port}/admin/`;
  const remote_url = remoteOn && tailscaleAddress ? `http://${tailscaleAddress}:${port}/admin/` : null;
  const reason = remoteOn && !tailscaleAddress
    ? "Remote access is on in the Stack's settings, but this computer has no Tailscale address yet. Open this page on the computer that runs MaiPai."
    : "The Stack's admin page opens only on the computer that runs MaiPai. Open it there, or turn on \"Also serve the admin page on Tailscale\" in the Stack's settings.";
  return { local_url, remote_url, reason };
}

/** Whether the Stack's settings say remote access (Tailscale) is in effect. Any failure to ask counts as off. */
async function readRemoteOn(): Promise<boolean> {
  try {
    const { body } = await forwardToStack("GET", "/stack/v1/settings");
    const settings = (body as { settings?: unknown } | null)?.settings;
    if (!Array.isArray(settings)) return false;
    const entry = settings.find((s) => (s as { key?: unknown })?.key === "stack.admin.tailscale");
    return (entry as { in_effect?: unknown } | undefined)?.in_effect === true;
  } catch {
    return false;
  }
}

/** The first non-internal IPv4 address inside 100.64.0.0/10 (first octet 100, second 64 to 127), or null. */
function detectTailscaleAddress(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const [first = 0, second = -1] = a.address.split(".").map(Number);
      if (first === 100 && second >= 64 && second <= 127) return a.address;
    }
  }
  return null;
}

/** Reads what `buildAdminLink` needs from the live machine: the Stack's port, whether the Stack runs here, remote access, and this computer's Tailscale address. */
export async function readAdminLink(): Promise<AdminLink> {
  let port = DEFAULT_PORT;
  try {
    const url = getStackUrl();
    if (url) port = Number(new URL(url).port) || DEFAULT_PORT;
  } catch {
    // An unreadable engine link keeps the default port.
  }
  const onThisComputer = !isRemoteStackSelected();
  const remoteOn = await readRemoteOn();
  const tailscaleAddress = detectTailscaleAddress();
  return buildAdminLink({ port, onThisComputer, remoteOn, tailscaleAddress });
}
