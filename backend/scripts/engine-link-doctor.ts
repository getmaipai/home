import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isHouseholdNetworkHost } from "@maipai/core/src/net";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getTailscaleStatus } from "@/lib/tailscale";
import { getLinkKeyPaths, getLinkSshAskpassEnvironment, knownHostsName } from "@/lib/stack/linkKeys";
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
  health: (port: number) => Promise<{ ok: boolean; version: string; contract?: number }>;
  roles: (port: number) => Promise<Array<{ id: string; state: { state: string } }>>;
  gpu: (port: number) => Promise<boolean>;
  /** Role ids whose `stack.engines.<role>.host_url` is bound to an engine the owner already runs (in effect, not just saved). */
  boundRoles: (port: number) => Promise<string[]>;
  /** A real round trip to one role through the Stack; resolves to ms, throws when the engine did not answer. */
  probeRole: (port: number, role: string) => Promise<number>;
};

/** Roles Home needs before chat works at all; any other role joins the list only when its engine is bound. */
export const REQUIRED_ROLES = ["chat", "vision"] as const;

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

/**
 * STACK-LINK-ASKPASS-01: the ssh arguments for hop 5. No `BatchMode=yes`: it disables the askpass prompt, so the pairing's
 * passphrase-protected key was never unlocked. One prompt, no password or keyboard-interactive fallback (a bad key fails fast),
 * and `-v` so the verdict can be read from what ssh says about authentication.
 */
export function authenticateSshArgs(host: string, port: number, address: string, privateKeyPath: string, knownHostsPath: string): string[] {
  return ["-v", "-T", "-o", "NumberOfPasswordPrompts=1", "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHostsPath}`, "-o", `HostKeyAlias=${knownHostsName(host, port)}`, "-o", "IdentitiesOnly=yes", "-i", privateKeyPath, "-p", String(port), `maipai-stack@${address}`, "true"];
}

/**
 * Whether `ssh -v` output shows the server accepted the key. The decision is on authentication, not on the command's exit code:
 * the box account `maipai-stack` has a no-login shell and a `restrict,permitopen` key, so `true` exits 1 even when sign-in worked.
 */
export function sshAuthenticated(stderr: string): boolean {
  return /Authenticated to\b/.test(stderr) || /Authentication succeeded \(publickey\)/.test(stderr);
}

function runSshAuth(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stderr = "";
    const child = spawn("ssh", args, { env, stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("ssh check timed out")); }, 15_000);
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", () => { clearTimeout(timer); resolve(stderr); });
  });
}

/**
 * Hop 7: the Stack's health reply, read the way the link reads it (`contract` against STACK_CONTRACT_MIN/MAX). `version` is the Stack's
 * release string ("0.1.0"), not a number: comparing it was always NaN, so hop 7 always failed. A request that does not return a Stack
 * health reply (a 404, a page, a dropped connection) throws, so the caller can tell that from a contract mismatch.
 */
export async function checkStackHealth(port: number): Promise<{ ok: boolean; version: string; contract?: number }> {
  const result = await createStackClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 3000 }).healthz();
  const contract = typeof result.contract === "number" && Number.isInteger(result.contract) ? result.contract : undefined;
  return { ok: result.ok === true && contract !== undefined && contract >= STACK_CONTRACT_MIN && contract <= STACK_CONTRACT_MAX, version: result.version, ...(contract !== undefined ? { contract } : {}) };
}

/** True when the Stack's /stack/v1/hardware reply shows an engine GPU: `hardware.cudaDevices`, or Apple silicon (the GPU is the engine there). The old top-level `gpus` and `graphics` stay as fallbacks. */
export function hasGpu(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const top = body as { hardware?: { cudaDevices?: unknown; isAppleSilicon?: unknown; gpus?: unknown; graphics?: unknown }; gpus?: unknown; graphics?: unknown };
  const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
  const hardware = top.hardware && typeof top.hardware === "object" ? top.hardware : {};
  return count(hardware.cudaDevices) > 0 || hardware.isAppleSilicon === true || count(hardware.gpus) > 0 || count(hardware.graphics) > 0 || count(top.gpus) > 0 || count(top.graphics) > 0;
}

export async function checkGpu(port: number): Promise<boolean> {
  const response = await fetch(`http://127.0.0.1:${port}/stack/v1/hardware`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!response?.ok) return false;
  return hasGpu(await response.json().catch(() => null));
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
    // The same environment the tunnel uses: the askpass helper supplies the key's passphrase.
    const stderr = await runSshAuth(authenticateSshArgs(host, port, address, privateKeyPath, knownHostsPath), getLinkSshAskpassEnvironment());
    return sshAuthenticated(stderr);
  },
  forward: async (port) => {
    try { const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2500) }); return response.ok; }
    catch { return false; }
  },
  health: checkStackHealth,
  roles: async (port) => (await createStackClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 3000 }).roles()).roles,
  gpu: checkGpu,
  boundRoles: async (port) => {
    const { settings } = await createStackClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 3000 }).settings();
    return boundRolesFromSettings(settings);
  },
  probeRole: probeStackRole,
};

/** Role ids whose `host_url` setting is in effect (non-empty). */
export function boundRolesFromSettings(settings: Array<{ key: string; in_effect?: unknown }>): string[] {
  const roles: string[] = [];
  for (const item of settings) {
    const match = /^stack\.engines\.([a-z0-9_-]+)\.host_url$/.exec(item.key);
    if (match && typeof item.in_effect === "string" && item.in_effect.trim() !== "") roles.push(match[1]!);
  }
  return roles;
}

/** True when a chat completion shows the engine answered: visible text, or reasoning text (thinking on and a small budget leaves `content` empty). */
export function completionAnswered(body: unknown): boolean {
  const message = (body as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }> } | null)?.choices?.[0]?.message;
  const text = (value: unknown) => typeof value === "string" && value.trim() !== "";
  return text(message?.content) || text(message?.reasoning_content);
}

/** Roles that speak the chat wire answer a one-token completion; the rest are checked by their id appearing in the Stack's model list. */
const CHAT_WIRE_ROLES = new Set(["chat", "coding", "judge", "router", "vision"]);

export async function probeStackRole(port: number, role: string): Promise<number> {
  const base = `http://127.0.0.1:${port}`;
  const start = performance.now();
  if (CHAT_WIRE_ROLES.has(role)) {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: role, messages: [{ role: "user", content: "Reply with one token: OK" }], max_tokens: 8, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`completion failed (${response.status})`);
    if (!completionAnswered(await response.json().catch(() => null))) throw new Error("empty completion");
  } else {
    const response = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json().catch(() => null) as { data?: Array<{ id?: string }> } | null;
    if (!response.ok || !body?.data?.some((model) => model.id === role)) throw new Error("role not listed");
  }
  return Math.round(performance.now() - start);
}

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
  hops.push(fix(5, authenticated, "The engine computer did not accept this Home's pairing key. Pair this Home with the engine computer again.", "No action needed.", authenticated ? undefined : !portOpen || !hostMatches || !files.privateKey ? "skipped: an earlier hop failed or this Home has no key" : "ssh did not report a successful sign-in with the pairing key"));
  if (!authenticated) return hops.concat(Array.from({ length: 5 }, (_, i) => fix(i + 6, false, "Fix hop 5, then rerun doctor.")));

  const tunnel = await deps.forward(config.localPort);
  hops.push(fix(6, tunnel, "Start the engine computer's SSH link."));
  if (!tunnel) return hops.concat(Array.from({ length: 4 }, (_, i) => fix(i + 7, false, "Fix hop 6, then rerun doctor.")));
  let health = false;
  let hop7Failure = "The Stack on the engine computer is a different version than this Home can use. Update the Stack on the engine computer, then rerun doctor.";
  try {
    const reply = await deps.health(config.localPort);
    health = reply.ok;
    const inRange = reply.contract !== undefined && reply.contract >= STACK_CONTRACT_MIN && reply.contract <= STACK_CONTRACT_MAX;
    if (!health && inRange) hop7Failure = "The Stack on the engine computer answered, but reported that it is not healthy. Check the Stack's status on the engine computer, then rerun doctor.";
    else if (!health) hop7Failure = `The Stack on the engine computer speaks ${reply.contract === undefined ? "an unknown contract" : `contract ${reply.contract}`}, and this Home needs contract ${STACK_CONTRACT_MIN === STACK_CONTRACT_MAX ? STACK_CONTRACT_MIN : `${STACK_CONTRACT_MIN} to ${STACK_CONTRACT_MAX}`}. Update the Stack on the engine computer, then rerun doctor.`;
  } catch { hop7Failure = "The SSH tunnel is up, but what answered on it was not a Stack health reply. Check that the Stack is running on the engine computer, then rerun doctor."; }
  hops.push(fix(7, health, hop7Failure));
  const probes = new Map<string, Promise<number>>();
  const probe = (role: string) => { if (!probes.has(role)) probes.set(role, deps.probeRole(config.localPort, role)); return probes.get(role)!; };
  let roleReady = false;
  let hop8Detail: string | undefined;
  let hop8Failure = "Install and start the configured engine roles.";
  try {
    const roles = await deps.roles(config.localPort);
    const bound = await deps.boundRoles(config.localPort).catch(() => null);
    if (!bound) throw new Error("settings");
    const needed = [...new Set<string>([...REQUIRED_ROLES, ...bound])];
    const problems: string[] = [];
    const notes: string[] = [];
    for (const id of needed) {
      const state = roles.find((role) => role.id === id)?.state.state;
      if (state === "ready") continue;
      if (bound.includes(id)) {
        const ok = await probe(id).then(() => true, () => false);
        if (ok) notes.push(`${id} bound to your own engine, answered a ${CHAT_WIRE_ROLES.has(id) ? "test completion" : "models check"} (the Stack reports ${state ?? "no state"} for a bound engine)`);
        else problems.push(`${id} is bound to your own engine, which did not answer`);
      } else problems.push(`${id} is ${state ?? "missing"} and has no engine bound`);
    }
    roleReady = problems.length === 0;
    hop8Detail = (roleReady ? notes : problems).join("; ") || undefined;
    if (!roleReady) hop8Failure = `Home needs ${problems.join("; ")}. Install the role in the Stack, or start your own engine and check its Server URL setting in the Stack, then rerun doctor.`;
  } catch (error) {
    if (error instanceof Error && error.message === "settings") { hop8Failure = "Home could not read which engines the Stack has bound to your own servers. Check that the Stack is running on the engine computer, then rerun doctor."; hop8Detail = "the Stack settings request failed"; }
  }
  hops.push(fix(8, roleReady, hop8Failure, "No action needed.", hop8Detail));
  let gpu = false;
  try { gpu = await deps.gpu(config.localPort); } catch { /* fail this hop */ }
  hops.push(fix(9, gpu, "Check the engine computer's NVIDIA driver and GPU."));
  try { const ms = await probe("chat"); hops.push(fix(10, true, "", "No action needed.", `round trip ${ms} ms (role chat)`)); }
  catch (error) { hops.push(fix(10, false, "The chat engine did not answer a test message through the Stack. Check that the engine server on the engine computer is running and that the Stack's chat Server URL points at it, then rerun doctor.", "", error instanceof Error ? error.message : undefined)); }
  return hops;
}

if (import.meta.main) {
  const hops = await runEngineLinkDoctor();
  for (const hop of hops) console.log(`${hop.pass ? "PASS" : "FAIL"} hop ${hop.id}${hop.detail ? `: ${hop.detail}` : ""} | Fix: ${hop.fix}`);
  if (hops.some((hop) => !hop.pass)) process.exitCode = 1;
}
