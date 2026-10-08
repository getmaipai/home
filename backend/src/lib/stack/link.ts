import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { isHouseholdNetworkHost } from "@maipai/core/src/net";
import { LinkState, type LinkState as EngineLinkState } from "@maipai/spec/gen/ts/link-state";
import { STACK_CONTRACT_MAX, STACK_CONTRACT_MIN } from "./contract";
import { StackError } from "./errors";

export const LINK_PROBE_INTERVAL_MS = 10_000;
export const LINK_PROBE_TIMEOUT_MS = 3_000;
export const LINK_BACKOFF_BASE_MS = 1_000;
export const LINK_BACKOFF_CAP_MS = 60_000;
export const LINK_READY_RESET_MS = 60_000;
export const LINK_OFFLINE_AFTER_MS = 2 * 60_000;
const ROLE_PROBE_INTERVAL = 30_000;

export type LinkReason = NonNullable<EngineLinkState["reason"]>;
export interface LinkConfig {
  host: string;
  sshPort?: number;
  localPort?: number;
  allowTailnet?: boolean;
  privateKeyPath: string;
  knownHostsPath: string;
  env?: NodeJS.ProcessEnv;
}
export interface LinkDependencies {
  spawn: (command: string, args: string[], options: { env?: NodeJS.ProcessEnv; stdio: ["ignore", "ignore", "ignore"] }) => Pick<ChildProcess, "once" | "kill">;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => number;
  random: () => number;
  resolveHost: (host: string) => Promise<string[]>;
  hostAllowed: typeof isHouseholdNetworkHost;
  log: (event: string, fields: Record<string, unknown>) => void;
  onRoles?: () => Promise<boolean>;
}

const safeLog = (event: string, fields: Record<string, unknown>) => console.info(`[stack-link] ${event}`, fields);
const defaultDeps: LinkDependencies = {
  spawn: (command, args, options) => nodeSpawn(command, args, options),
  fetch,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
  now: () => Date.now(),
  random: () => Math.random(),
  resolveHost: async (host) => {
    const { lookup } = await import("node:dns/promises");
    return (await lookup(host, { all: true })).map(({ address }) => address);
  },
  hostAllowed: isHouseholdNetworkHost,
  log: safeLog,
};

export function fullJitterDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(LINK_BACKOFF_CAP_MS, LINK_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.floor(Math.max(0, Math.min(0.999999999, random())) * ceiling);
}

/** SSH's exit status is intentionally the only classifier input. Never parse stderr. */
export function mapSshFailure(code?: number | null, signal?: NodeJS.Signals | null): LinkReason {
  // OpenSSH uses 255 for authentication, host-key, DNS, and transport errors alike.
  // It is not safe evidence for any narrower reason.
  if (code === 255) return "link_refused";
  if (signal) return "link_refused";
  return "link_refused";
}

type Child = Pick<ChildProcess, "once" | "kill">;
export class EngineLink {
  private state: EngineLinkState = { state: "offline", reason: "link_stack_down", contract: String(STACK_CONTRACT_MIN) };
  private child: Child | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private offlineTimer: ReturnType<typeof setTimeout> | null = null;
  private roleTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private attempt = 0;
  private failures = 0;
  private readyAt: number | null = null;
  private notReadySince: number | null = null;
  private readonly deps: LinkDependencies;
  private readonly config: Required<Pick<LinkConfig, "sshPort" | "localPort" | "allowTailnet">> & LinkConfig;
  private generation = 0;
  private lastGood: { contract: string; rtt_ms: number; last_ok_at: string; path: "home" | "tailnet" } | null = null;
  private recentRtts: number[] = [];
  private rolesDegraded = false;

  constructor(config: LinkConfig, deps: Partial<LinkDependencies> = {}) {
    this.config = { sshPort: 22, localPort: 8771, allowTailnet: false, ...config };
    this.deps = { ...defaultDeps, ...deps };
  }
  snapshot(): EngineLinkState { return LinkState.parse(this.state); }
  isReady(): boolean { return this.state.state === "ready" || this.state.state === "degraded"; }
  pathInUse(): "home" | "tailnet" | null { return this.lastGood?.path ?? null; }
  assertReady(): void { if (!this.isReady()) throw new StackError("unreachable", "Stack link is unreachable"); }

  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    this.notReadySince = this.deps.now();
    this.setOfflineEscalation(generation);
    void this.connect(generation);
  }
  stop(): void {
    this.running = false;
    ++this.generation;
    this.clearTimers();
    this.killChild();
    this.notReadySince = null;
    this.setState({ state: "offline", reason: "link_stack_down", contract: this.state.contract });
  }
  /** Revalidate on every settings save; disabling tailnet while using it cuts the tunnel immediately. */
  updateSettings(config: Partial<Pick<LinkConfig, "host" | "sshPort" | "localPort" | "allowTailnet">>): void {
    const priorPath = this.lastGood?.path;
    Object.assign(this.config, config);
    const invalidated = priorPath === "tailnet" && config.allowTailnet === false;
    this.invalidate(invalidated ? "link_outside_home" : "link_stack_down", invalidated);
  }
  retry(): void { this.invalidate("link_stack_down", false); }

  private clearTimers(): void {
    for (const timer of [this.timer, this.offlineTimer, this.roleTimer]) if (timer) this.deps.clearTimeout(timer);
    this.timer = this.offlineTimer = this.roleTimer = null;
  }
  private killChild(): void { const child = this.child; this.child = null; if (child) child.kill("SIGTERM"); }
  private invalidate(reason: LinkReason, terminal: boolean): void {
    ++this.generation;
    this.clearTimers();
    this.killChild();
    this.failures = 0;
    this.readyAt = null;
    this.lastGood = null;
    this.recentRtts = [];
    this.notReadySince = this.deps.now();
    if (!this.running) { this.setState({ state: "offline", reason, contract: this.state.contract }); return; }
    const generation = this.generation;
    this.setOfflineEscalation(generation);
    if (terminal) this.setState({ state: "offline", reason, contract: this.state.contract });
    else void this.connect(generation);
  }
  private setOfflineEscalation(generation: number): void {
    if (this.offlineTimer) this.deps.clearTimeout(this.offlineTimer);
    const elapsed = this.notReadySince === null ? 0 : this.deps.now() - this.notReadySince;
    this.offlineTimer = this.deps.setTimeout(() => {
      if (!this.running || generation !== this.generation || this.isReady()) return;
      const reason = this.state.reason ?? "link_timeout";
      this.setState({ state: "offline", reason, contract: this.state.contract });
    }, Math.max(0, LINK_OFFLINE_AFTER_MS - elapsed));
  }
  private setState(state: EngineLinkState): void {
    const previous = this.state.state;
    this.state = LinkState.parse(state);
    if (previous !== state.state || this.state.reason !== state.reason) {
      this.deps.log("stack_link.state_changed", { from: previous, to: state.state, reason: state.reason, attempt: this.attempt, rtt_ms: state.rtt_ms });
    }
  }
  private async connect(generation: number): Promise<void> {
    if (!this.current(generation)) return;
    this.setState({ state: this.failures >= 2 ? "reconnecting" : "connecting", reason: this.state.reason ?? "link_timeout", contract: this.state.contract });
    let addresses: string[];
    try { addresses = await this.deps.resolveHost(this.config.host); } catch {
      if (!this.current(generation)) return;
      this.fail("link_dns", generation);
      return;
    }
    if (!this.current(generation)) return;
    let checked: Array<{ address: string; allowed: boolean }>;
    try { checked = await Promise.all(addresses.map(async (address) => ({ address, allowed: await this.deps.hostAllowed(address, { allowTailnet: this.config.allowTailnet }) }))); }
    catch { if (this.current(generation)) this.fail("link_outside_home", generation, true); return; }
    if (!this.current(generation)) return;
    const address = checked.find((item) => item.allowed)?.address;
    if (!address) { this.fail("link_outside_home", generation, true); return; }
    const path = this.isTailnetAddress(address) ? "tailnet" : "home";
    const args = ["-N", "-T", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${this.config.knownHostsPath}`, "-o", "IdentitiesOnly=yes", "-i", this.config.privateKeyPath, "-L", `127.0.0.1:${this.config.localPort}:127.0.0.1:8770`, "-p", String(this.config.sshPort), `maipai-stack@${address}`];
    let child: Child;
    try { child = this.deps.spawn("ssh", args, { env: this.config.env, stdio: ["ignore", "ignore", "ignore"] }); }
    catch (error) { this.fail(this.structuredReason(error) ?? "link_refused", generation); return; }
    this.child = child;
    child.once("exit", (code, signal) => {
      if (!this.current(generation) || this.child !== child) return;
      this.child = null;
      this.fail(mapSshFailure(typeof code === "number" ? code : null, signal), generation);
    });
    child.once("error", (error) => {
      if (!this.current(generation) || this.child !== child) return;
      this.child = null;
      this.fail(this.structuredReason(error) ?? "link_refused", generation);
    });
    await this.probe(generation, path);
  }
  private async probe(generation: number, path: "home" | "tailnet"): Promise<void> {
    if (!this.current(generation) || !this.child) return;
    const started = this.deps.now();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => { timeout = this.deps.setTimeout(() => reject(Object.assign(new Error("probe timed out"), { code: "ETIMEDOUT" })), LINK_PROBE_TIMEOUT_MS); });
    try {
      const response = await Promise.race([this.deps.fetch(`http://127.0.0.1:${this.config.localPort}/healthz`), timeoutPromise]);
      if (!this.current(generation) || !this.child) return;
      if (!response.ok) throw Object.assign(new Error("health probe failed"), { code: response.status === 503 ? "STACK_DOWN" : "ECONNREFUSED" });
      const health = await response.json() as { ok?: boolean; contract?: number };
      if (!this.current(generation) || !this.child) return;
      if (health.ok !== true || !Number.isInteger(health.contract)) throw new Error("stack_down");
      if (health.contract! < STACK_CONTRACT_MIN || health.contract! > STACK_CONTRACT_MAX) { this.fail("link_needs_update", generation, true, String(health.contract)); return; }
      const now = this.deps.now();
      const rtt = Math.max(0, Math.round(now - started));
      if (this.readyAt === null) this.readyAt = now;
      else if (now - this.readyAt >= LINK_READY_RESET_MS) this.attempt = 0;
      this.failures = 0;
      this.recentRtts.push(rtt);
      this.recentRtts = this.recentRtts.slice(-6);
      this.lastGood = { contract: String(health.contract), rtt_ms: rtt, last_ok_at: new Date(now).toISOString(), path };
      this.notReadySince = null;
      if (this.offlineTimer) this.deps.clearTimeout(this.offlineTimer);
      this.offlineTimer = null;
      this.setState({ state: this.isSlow() || this.rolesDegraded ? "degraded" : "ready", ...this.lastGood });
      this.scheduleProbe(generation, path);
      this.scheduleRoles(generation, path);
    } catch (error) {
      if (!this.current(generation)) return;
      const reason = this.structuredReason(error) ?? "link_stack_down";
      this.failedProbe(reason, generation);
    } finally { if (timeout) this.deps.clearTimeout(timeout); }
  }
  private failedProbe(reason: LinkReason, generation: number): void {
    this.failures++;
    if (this.notReadySince === null) this.notReadySince = this.deps.now();
    if (this.failures < 2 && this.isReady()) {
      const path = this.lastGood?.path ?? "home";
      this.setState({ state: "degraded", reason, ...(this.lastGood ?? { contract: this.state.contract }), });
      this.scheduleProbe(generation, path);
      return;
    }
    if (this.failures >= 2 && this.isReady()) this.setState({ state: "reconnecting", reason, contract: this.state.contract });
    this.fail(reason, generation);
  }
  private fail(reason: LinkReason, generation: number, terminal = false, contract = this.state.contract): void {
    if (!this.current(generation)) return;
    terminal ||= ["link_auth_refused", "link_host_key_changed", "link_needs_update", "link_not_paired", "link_outside_home"].includes(reason);
    const wasReady = this.isReady();
    this.killChild();
    this.readyAt = null;
    if (this.notReadySince === null) this.notReadySince = this.deps.now();
    if (terminal) { ++this.generation; this.setState({ state: "offline", reason, contract }); return; }
    const elapsed = this.deps.now() - this.notReadySince;
    const state = elapsed >= LINK_OFFLINE_AFTER_MS ? "offline" : wasReady || this.failures >= 2 ? "reconnecting" : "connecting";
    this.setState({ state, reason, contract });
    const delay = fullJitterDelay(this.attempt++, this.deps.random);
    const nextGeneration = ++this.generation;
    this.setOfflineEscalation(nextGeneration);
    this.schedule(() => void this.connect(nextGeneration), delay);
  }
  private scheduleProbe(generation: number, path: "home" | "tailnet"): void { this.timer = this.deps.setTimeout(() => void this.probe(generation, path), LINK_PROBE_INTERVAL_MS); }
  private scheduleRoles(generation: number, path: "home" | "tailnet"): void {
    if (!this.deps.onRoles || this.roleTimer) return;
    this.roleTimer = this.deps.setTimeout(async () => {
      this.roleTimer = null;
      if (!this.current(generation)) return;
      try {
        const rolesReady = await this.deps.onRoles!();
        if (!this.current(generation) || !this.lastGood) return;
        this.rolesDegraded = !rolesReady;
        this.setState({ state: this.rolesDegraded || this.isSlow() ? "degraded" : "ready", ...this.lastGood });
      } catch { this.rolesDegraded = true; if (this.current(generation) && this.lastGood) this.setState({ state: "degraded", ...this.lastGood }); }
      if (this.current(generation)) this.scheduleRoles(generation, path);
    }, ROLE_PROBE_INTERVAL);
  }
  private schedule(fn: () => void, ms: number): void { if (this.timer) this.deps.clearTimeout(this.timer); this.timer = this.deps.setTimeout(fn, ms); }
  private isSlow(): boolean {
    if (this.recentRtts.length < 6) return false;
    const sorted = [...this.recentRtts].sort((a, b) => a - b);
    return (sorted[2]! + sorted[3]!) / 2 > 500;
  }
  private current(generation: number): boolean { return this.running && generation === this.generation; }
  private isTailnetAddress(address: string): boolean {
    const octets = address.split(".").map(Number);
    if (octets.length === 4 && octets.every(Number.isInteger)) return octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
    return address.toLowerCase().startsWith("fd7a:115c:a1e0:");
  }
  private structuredReason(error: unknown): LinkReason | null {
    if (!error || typeof error !== "object") return null;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "link_dns";
    if (code === "ECONNREFUSED") return "link_refused";
    if (code === "ETIMEDOUT") return "link_timeout";
    if (code === "STACK_DOWN") return "link_stack_down";
    if (code === "SSH_AUTH_REFUSED") return "link_auth_refused";
    if (code === "SSH_HOST_KEY_CHANGED") return "link_host_key_changed";
    if (code === "SSH_NOT_PAIRED") return "link_not_paired";
    if (code === "SSH_NEEDS_UPDATE") return "link_needs_update";
    if (code === "SSH_OUTSIDE_HOME") return "link_outside_home";
    return null;
  }
}

interface ActiveLinkState { link: EngineLink | null; }
const linkGlobal = globalThis as typeof globalThis & { __maipaiEngineLink?: ActiveLinkState };
const activeState = linkGlobal.__maipaiEngineLink ??= { link: null };
export function startEngineLink(config: LinkConfig, deps?: Partial<LinkDependencies>): EngineLink {
  if (activeState.link) {
    activeState.link.updateSettings({ host: config.host, sshPort: config.sshPort, localPort: config.localPort, allowTailnet: config.allowTailnet });
    return activeState.link;
  }
  activeState.link = new EngineLink(config, deps);
  activeState.link.start();
  return activeState.link;
}
export function stopEngineLink(): void { activeState.link?.stop(); activeState.link = null; }
export function getEngineLink(): EngineLink | null { return activeState.link; }
export function getEngineLinkState(): EngineLinkState | null { return activeState.link?.snapshot() ?? null; }
export function __setEngineLinkForTests(link: EngineLink | null): void { activeState.link?.stop(); activeState.link = link; }
