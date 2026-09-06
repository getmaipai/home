// Tailscale as an optional overlay-network address, detected never
// installed (session-f-platform-and-trust.md step 5: "detects an
// existing daemon and never installs one silently"). A household that
// already runs Tailscale gets its MagicDNS name and tailnet IP offered
// as an extra address in lib/hubEndpoints.ts's book; a household that
// doesn't is completely unaffected - this never spawns, configures, or
// prompts to install anything.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type TailscaleState = "not_installed" | "stopped" | "running";

export interface TailscaleStatus {
  state: TailscaleState;
  /** MagicDNS name (e.g. "hub.tailnetname.ts.net"), when running. */
  dnsName: string | null;
  /** Tailnet IPv4/IPv6 addresses, when running. */
  ips: string[];
}

interface TailscaleStatusJson {
  BackendState?: string;
  Self?: { DNSName?: string; TailscaleIPs?: string[] };
}

// Pure interpretation, split from the process spawn so it's unit-testable
// against synthetic `tailscale status --json` output without needing the
// real binary installed on whatever machine runs the test suite (the same
// split lib/dirtyBoot.ts's own OS-signal parsing already uses).
export function interpretTailscaleStatusJson(stdout: string): TailscaleStatus {
  const parsed = JSON.parse(stdout) as TailscaleStatusJson;
  if (parsed.BackendState !== "Running") {
    return { state: "stopped", dnsName: null, ips: [] };
  }
  const dnsName = parsed.Self?.DNSName?.replace(/\.$/, "") ?? null;
  const ips = parsed.Self?.TailscaleIPs ?? [];
  return { state: "running", dnsName, ips };
}

/** Best-effort: any missing binary, timeout, or unparseable output reports
 * "not_installed" rather than throwing - the same "a query failure is
 * never a false alarm" posture lib/dirtyBoot.ts's OS queries already
 * take. */
export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], { timeout: 5_000 });
    return interpretTailscaleStatusJson(stdout);
  } catch {
    return { state: "not_installed", dnsName: null, ips: [] };
  }
}
