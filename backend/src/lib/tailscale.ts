// Reads an existing Tailscale installation and provisions Home's HTTPS
// certificate only after an owner/admin explicitly enables away access.
// Home never installs the Tailscale app or signs anyone in.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { protectSecretPath } from "@/lib/secretPaths";
import { raiseIssue, resolveIssue, registerFixHandler } from "@/lib/issues";
import { notifyTsLeafRenewed } from "@/lib/tailscaleTls";
import { getHouseholdSettingValue, setValue } from "@/lib/settings";
import { listActivePeople } from "@/lib/access";

const execFileAsync = promisify(execFile);

export type TailscaleState = "not_installed" | "stopped" | "running";

export interface TailscaleStatus {
  state: TailscaleState;
  /** MagicDNS name (e.g. "hub.tailnetname.ts.net"), when running. */
  dnsName: string | null;
  /** Tailnet IPv4/IPv6 addresses, when running. */
  ips: string[];
  installed?: boolean;
  signedIn?: boolean;
  httpsEnabled?: boolean;
  machineName?: string | null;
}

interface TailscaleStatusJson {
  BackendState?: string;
  Self?: { DNSName?: string; TailscaleIPs?: string[]; HostName?: string; UserID?: number };
  User?: Record<string, { ID?: number; LoginName?: string }>;
  Health?: string[];
}

// Pure interpretation, split from the process spawn so it's unit-testable
// against synthetic `tailscale status --json` output without needing the
// real binary installed on whatever machine runs the test suite (the same
// split lib/dirtyBoot.ts's own OS-signal parsing already uses).
export function interpretTailscaleStatusJson(stdout: string): TailscaleStatus {
  const parsed = JSON.parse(stdout) as TailscaleStatusJson;
  if (parsed.BackendState !== "Running") {
    return { state: "stopped", dnsName: null, ips: [], installed: true, signedIn: false, httpsEnabled: false, machineName: null };
  }
  const dnsName = parsed.Self?.DNSName?.replace(/\.$/, "") ?? null;
  const ips = parsed.Self?.TailscaleIPs ?? [];
  const signedIn = Boolean(parsed.Self?.UserID && parsed.User?.[String(parsed.Self.UserID)]);
  const httpsEnabled = Boolean(dnsName?.endsWith(".ts.net") && !parsed.Health?.some((item) => /https.*disabled/i.test(item)));
  return { state: "running", dnsName, ips, installed: true, signedIn, httpsEnabled, machineName: parsed.Self?.HostName ?? dnsName?.split(".")[0] ?? null };
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
    return { state: "not_installed", dnsName: null, ips: [], installed: false, signedIn: false, httpsEnabled: false, machineName: null };
  }
}

const TS_CERT_PATH = join(dataDir, "keys", "tailscale-cert.pem");
const TS_KEY_PATH = join(dataDir, "keys", "tailscale-key.pem");
let renewalActive = false;

export interface TsCert { certPem: string; keyPem: string; name: string }
export function getTailscaleLeafForServer(): TsCert | null {
  if (!existsSync(TS_CERT_PATH) || !existsSync(TS_KEY_PATH)) return null;
  return { certPem: readFileSync(TS_CERT_PATH, "utf8"), keyPem: readFileSync(TS_KEY_PATH, "utf8"), name: "*.ts.net" };
}

export async function ensureTailscaleCert(): Promise<TsCert> {
  const status = await getTailscaleStatus();
  if (!status.installed || !status.signedIn || !status.httpsEnabled || !status.dnsName) throw new Error("Sign in to Tailscale and enable HTTPS certificates first.");
  mkdirSync(join(dataDir, "keys"), { recursive: true, mode: 0o700 });
  const certPath = join(dataDir, "keys", "tailscale-cert-source.pem");
  const keyPath = join(dataDir, "keys", "tailscale-key-source.pem");
  try { await execFileAsync("tailscale", ["cert", "--cert-file", certPath, "--key-file", keyPath, status.dnsName], { timeout: 30_000 }); }
  catch (error) { rmSync(certPath, { force: true }); rmSync(keyPath, { force: true }); throw error; }
  const certPem = readFileSync(certPath, "utf8");
  const keyPem = readFileSync(keyPath, "utf8");
  try {
    writeFileSync(TS_CERT_PATH, certPem, { mode: 0o644 });
    writeFileSync(TS_KEY_PATH, keyPem, { mode: 0o600 });
    protectSecretPath(TS_KEY_PATH);
  } finally { rmSync(certPath, { force: true }); rmSync(keyPath, { force: true }); }
  chmodSync(TS_KEY_PATH, 0o600); protectSecretPath(TS_KEY_PATH);
  renewalActive = getHouseholdSettingValue("network.tailnet_access") === true;
  notifyTsLeafRenewed({ certPem, keyPem, name: status.dnsName });
  resolveIssue("tailscale", "cert_renewal_failed");
  return { certPem, keyPem, name: status.dnsName };
}

export function setTailscaleRenewalActive(active: boolean): void { renewalActive = active; }
export function isTailscaleRenewalActive(): boolean { return renewalActive; }
export function syncTailscaleRenewalSetting(): void {
  const enabled = getHouseholdSettingValue("network.tailnet_access") === true;
  renewalActive = enabled;
  if (enabled) registerFixHandler("renew_tailscale_cert", async () => { if (renewalActive) await ensureTailscaleCert(); });
}
export async function renewTailscaleCert(): Promise<void> {
  if (!renewalActive) return;
  registerFixHandler("renew_tailscale_cert", async () => { if (renewalActive) await ensureTailscaleCert(); });
  try {
    const status = await getTailscaleStatus();
    const cert = getTailscaleLeafForServer();
    if (!cert || (status.dnsName && !cert.certPem.includes(status.dnsName))) await ensureTailscaleCert();
  }
  catch (error) {
    await raiseIssue({ source: "tailscale", key: "cert_renewal_failed", severity: "warning", title: "Home's away certificate could not be renewed", detail: "The Tailscale HTTPS certificate could not be renewed. Check the connection and try again.", fix: { label: "Renew certificate", action: "renew_tailscale_cert" } });
    throw error;
  }
}

export async function turnOnTailscaleAccess(actor: { id: string; role: string }, settingAlreadyWritten = false): Promise<TsCert> {
  const cert = await ensureTailscaleCert();
  if (!settingAlreadyWritten) {
    const owner = listActivePeople().find((person) => person.role === "owner");
    if (!owner) throw new Error("Create the owner account before enabling away access.");
    const saved = setValue(owner, "household", "network.tailnet_access", true);
    if (!saved.ok) throw new Error(saved.error);
  }
  renewalActive = true;
  return cert;
}
