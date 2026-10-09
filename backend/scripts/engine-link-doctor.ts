import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isHouseholdNetworkHost } from "@maipai/core/src/net";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getTailscaleStatus } from "@/lib/tailscale";
import { getLinkKeyPaths, knownHostsName } from "@/lib/stack/linkKeys";
import { createStackClient } from "@/lib/stack/client";
import { STACK_CONTRACT_MIN, STACK_CONTRACT_MAX } from "@/lib/stack/contract";

type Hop = { id: number; pass: boolean; detail?: string; fix: string };
type DoctorDependencies = {
  settings: () => { selected: boolean; host: string; sshPort: number; localPort: number; allowTailnet: boolean };
  resolve: (host: string) => Promise<string[]>;
  portOpen: (host: string, port: number) => Promise<boolean>;
  allowed: (address: string, opts: { allowTailnet: boolean }) => Promise<boolean>;
  tailscale: () => Promise<boolean>;
  keyFiles: () => { privateKey: boolean; knownHosts: boolean };
  hostKey: (host: string, port: number) => Promise<boolean>;
  authenticate: (host: string, port: number, address?: string) => Promise<boolean>;
  forward: (port: number) => Promise<boolean>;
  health: (port: number) => Promise<{ ok: boolean; version: string }>;
  roles: (port: number) => Promise<Array<{ id: string; state: { state: string } }>>;
  gpu: (port: number) => Promise<boolean>;
  completion: (port: number) => Promise<number>;
};

export type EngineLinkDoctorDependencies = DoctorDependencies;

const tailnetIp = (address: string) => {
  const octets = address.split(".").map(Number);
  return (octets.length === 4 && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127)
    || address.toLowerCase().startsWith("fd7a:115c:a1e0:");
};

/** True when the known_hosts file holds a key for this host, asked the way ssh filed it (bare host on port 22, `[host]:port` otherwise). */
export function hostKeyPinned(host: string, port: number, knownHostsFile: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn("ssh-keygen", ["-F", knownHostsName(host, port), "-f", knownHostsFile], { stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

/** Whether the pairing's key files exist, at the paths the pairing wrote and the tunnel reads (`getLinkKeyPaths`). */
export function engineLinkKeyFiles(): { privateKey: boolean; knownHosts: boolean } {
  const { privateKeyPath, knownHostsPath } = getLinkKeyPaths();
  return { privateKey: existsSync(privateKeyPath), knownHosts: existsSync(knownHostsPath) };
}

const defaults: DoctorDependencies = {
  settings: () => ({
    selected: getHouseholdSettingValue("engines.stack.where") === "another_computer",
    host: String(getHouseholdSettingValue("engines.stack.remote.host") ?? "").trim(),
    sshPort: Number(getHouseholdSettingValue("engines.stack.remote.ssh_port") ?? 22),
    localPort: Number(getHouseholdSettingValue("engines.stack.remote.local_port") ?? 8771),
    allowTailnet: getHouseholdSettingValue("engines.stack.remote.allow_tailnet") === true,
  }),
  resolve: async (host) => (await lookup(host, { all: true })).map(({ address }) => address),
  portOpen: async (host, port) => {
    const net = await import("node:net");
    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      const finish = (open: boolean) => { socket.destroy(); resolve(open); };
      socket.setTimeout(2500, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
  },
  allowed: (address, opts) => isHouseholdNetworkHost(address, opts),
  tailscale: async () => (await getTailscaleStatus()).state === "running",
  keyFiles: engineLinkKeyFiles,
  hostKey: (host, port) => hostKeyPinned(host, port, getLinkKeyPaths().knownHostsPath),
  authenticate: async (host, port, address = host) => {
    const { privateKeyPath, knownHostsPath } = getLinkKeyPaths();
    const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHostsPath}`, "-o", `HostKeyAlias=${knownHostsName(host, port)}`, "-o", "IdentitiesOnly=yes", "-i", privateKeyPath, "-p", String(port), `maipai-stack@${address}`, "true"], { stdio: ["ignore", "ignore", "ignore"] });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("ssh check failed")));
    });
    return true;
  },
  forward: async (port) => {
    try { const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2500) }); return response.ok; }
    catch { return false; }
  },
  health: async (port) => {
    const result = await createStackClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 3000 }).healthz();
    return { ok: result.ok && Number(result.version) >= STACK_CONTRACT_MIN && Number(result.version) <= STACK_CONTRACT_MAX, version: result.version };
  },
  roles: async (port) => (await createStackClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 3000 }).roles()).roles,
  gpu: async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/stack/v1/hardware`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const body = await response.json() as { gpus?: unknown[]; graphics?: unknown[] };
    return (body.gpus?.length ?? body.graphics?.length ?? 0) > 0;
  },
  completion: async (port) => {
    const start = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "maipai", messages: [{ role: "user", content: "Reply with one token: OK" }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("completion failed");
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    if (!result.choices?.[0]?.message?.content?.trim()) throw new Error("empty completion");
    return Math.round(performance.now() - start);
  },
};

export async function runEngineLinkDoctor(deps: DoctorDependencies = defaults): Promise<Hop[]> {
  const config = deps.settings();
  const hops: Hop[] = [];
  const fix = (id: number, pass: boolean, failure: string, success = "No action needed.", detail?: string): Hop => ({ id, pass, ...(detail ? { detail } : {}), fix: pass ? success : failure });
  const complete = config.selected && Boolean(config.host) && Number.isInteger(config.sshPort) && config.sshPort > 0 && Number.isInteger(config.localPort) && config.localPort > 0;
  hops.push(fix(1, complete, "Set the remote engine address."));
  if (!complete) return hops.concat(Array.from({ length: 9 }, (_, i) => fix(i + 2, false, "Fix hop 1, then rerun doctor.")));

  let addresses: string[] = [];
  try { addresses = await deps.resolve(config.host); } catch { /* reported below */ }
  const decisions = await Promise.all(addresses.map(async (value) => ({ value, allowed: await deps.allowed(value, { allowTailnet: config.allowTailnet }) })));
  const selected = decisions.find((item) => item.allowed)?.value;
  const isTailnet = selected ? tailnetIp(selected) : addresses.some(tailnetIp);
  let hop2Detail: string;
  let hop2Failure: string;
  let hop2Pass = Boolean(selected);
  if (selected && isTailnet && config.allowTailnet && !(await deps.tailscale())) {
    hop2Pass = false;
    hop2Detail = "Tailscale is not connected on this computer.";
    hop2Failure = "Connect Tailscale on this computer.";
  }
  else if (selected) { hop2Detail = `path ${tailnetIp(selected) ? "tailnet" : "home"}`; hop2Failure = "Use the engine computer's home address."; }
  else if (isTailnet && !config.allowTailnet) { hop2Detail = "Turn on Reach the engine computer when away from home, or use the home address."; hop2Failure = "Enable away access or use the home address."; }
  else if (isTailnet && config.allowTailnet && !(await deps.tailscale())) { hop2Detail = "Tailscale is not connected on this computer."; hop2Failure = "Connect Tailscale on this computer."; }
  else { hop2Detail = "name did not resolve to an allowed address"; hop2Failure = "Use the engine computer's home address."; }
  hops.push(fix(2, hop2Pass, hop2Failure, "No action needed.", hop2Detail));
  if (!selected) return hops.concat(Array.from({ length: 8 }, (_, i) => fix(i + 3, false, "Fix hop 2, then rerun doctor.")));

  const portOpen = await deps.portOpen(selected, config.sshPort).catch(() => false);
  hops.push(fix(3, portOpen, `Open SSH port ${config.sshPort} on the engine computer.`));
  const files = deps.keyFiles();
  let hostMatches = false;
  // Keys are filed under the name the owner typed (what the pairing scanned and the tunnel's HostKeyAlias uses), not the resolved address.
  const keyName = knownHostsName(config.host, config.sshPort);
  if (portOpen && files.knownHosts) hostMatches = await deps.hostKey(config.host, config.sshPort).catch(() => false);
  const hop4Detail = hostMatches ? undefined : !portOpen ? `skipped: SSH port ${config.sshPort} is not open` : !files.knownHosts ? "no pinned engine computer key on this computer" : `looked up ${keyName} on SSH port ${config.sshPort} and found no pinned key`;
  hops.push(fix(4, hostMatches, "Pair again and confirm the engine computer's key.", "No action needed.", hop4Detail));
  let authenticated = false;
  if (portOpen && hostMatches && files.privateKey) authenticated = await deps.authenticate(config.host, config.sshPort, selected).catch(() => false);
  hops.push(fix(5, authenticated, "Pair this Home with the engine computer again."));
  if (!authenticated) return hops.concat(Array.from({ length: 5 }, (_, i) => fix(i + 6, false, "Fix hop 5, then rerun doctor.")));

  const tunnel = await deps.forward(config.localPort);
  hops.push(fix(6, tunnel, "Start the engine computer's SSH link."));
  if (!tunnel) return hops.concat(Array.from({ length: 4 }, (_, i) => fix(i + 7, false, "Fix hop 6, then rerun doctor.")));
  let health = false;
  try { health = (await deps.health(config.localPort)).ok; } catch { /* fail this hop */ }
  hops.push(fix(7, health, "Update the Stack on the engine computer."));
  let roleReady = false;
  try {
    const roles = await deps.roles(config.localPort);
    roleReady = roles.length > 0 && roles.every((role) => role.state.state === "ready");
  } catch { /* fail this hop */ }
  hops.push(fix(8, roleReady, "Install and start the configured engine roles."));
  let gpu = false;
  try { gpu = await deps.gpu(config.localPort); } catch { /* fail this hop */ }
  hops.push(fix(9, gpu, "Check the engine computer's NVIDIA driver and GPU."));
  try { const ms = await deps.completion(config.localPort); hops.push(fix(10, true, "Check the chat engine.", "No action needed.", `round trip ${ms} ms`)); }
  catch { hops.push(fix(10, false, "Start the chat engine and check its model.")); }
  return hops;
}

if (import.meta.main) {
  const hops = await runEngineLinkDoctor();
  for (const hop of hops) console.log(`${hop.pass ? "PASS" : "FAIL"} hop ${hop.id}${hop.detail ? `: ${hop.detail}` : ""} | Fix: ${hop.fix}`);
  if (hops.some((hop) => !hop.pass)) process.exitCode = 1;
}
