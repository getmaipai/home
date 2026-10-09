import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { isHouseholdNetworkHost } from "@maipai/core/src/net";
import { LinkState, type LinkState as EngineLinkState } from "@maipai/spec/gen/ts/link-state.js";
import { STACK_CONTRACT_MAX, STACK_CONTRACT_MIN } from "./contract";

export const LINK_PROBE_INTERVAL_MS = 10_000;
export const LINK_PROBE_TIMEOUT_MS = 3_000;
export const LINK_BACKOFF_BASE_MS = 1_000;
export const LINK_BACKOFF_CAP_MS = 60_000;
export const LINK_READY_RESET_MS = 60_000;

export type LinkReason = NonNullable<EngineLinkState["reason"]>;
export interface LinkConfig {
  host: string;
  sshPort?: number;
  localPort?: number;
  allowTailnet?: boolean;
  privateKeyPath: string;
  knownHostsPath: string;
  /** Credentials are supplied by the process environment (e.g. askpass). */
  env?: NodeJS.ProcessEnv;
}
export interface LinkDependencies {
  spawn: (command: string, args: string[], options: { env?: NodeJS.ProcessEnv; stdio: ["ignore", "ignore", "ignore"] }) => Pick<ChildProcess, "once" | "kill">;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => number;
  random: () => number;
  hostAllowed: typeof isHouseholdNetworkHost;
  log: (event: string, fields: Record<string, unknown>) => void;
}

const defaultDeps: LinkDependencies = {
  spawn: (command, args, options) => nodeSpawn(command, args, options),
  fetch,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
  now: () => Date.now(),
  random: () => Math.random(),
  hostAllowed: isHouseholdNetworkHost,
  log: (event, fields) => console.info(`[stack-link] ${event}`, fields),
};

export function fullJitterDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(LINK_BACKOFF_CAP_MS, LINK_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.floor(Math.max(0, Math.min(0.999999999, random())) * ceiling);
}

export function mapSshFailure(code?: number | null, signal?: NodeJS.Signals | null): LinkReason {
  if (code === 255 || signal) return "link_auth_refused";
  return "link_refused";
}

export class EngineLink {
  private state: EngineLinkState = { state: "offline", reason: "link_stack_down", contract: String(STACK_CONTRACT_MIN) };
  private child: Pick<ChildProcess, "once" | "kill"> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private attempt = 0;
  private failures = 0;
  private readyAt: number | null = null;
  private readonly deps: LinkDependencies;
  private readonly config: Required<Pick<LinkConfig, "sshPort" | "localPort" | "allowTailnet">> & LinkConfig;
  private generation = 0;

  constructor(config: LinkConfig, deps: Partial<LinkDependencies> = {}) {
    this.config = { sshPort: 22, localPort: 8771, allowTailnet: false, ...config };
    this.deps = { ...defaultDeps, ...deps };
  }

  snapshot(): EngineLinkState { return LinkState.parse(this.state); }
  isReady(): boolean { return this.state.state === "ready" || this.state.state === "degraded"; }

  /** Callers use this before starting any Stack request, so down links fail without a socket timeout. */
  assertReady(): void {
    if (!this.isReady()) throw new Error("Stack link is unreachable");
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    void this.connect(this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer) this.deps.clearTimeout(this.timer);
    this.timer = null;
    this.child?.kill("SIGTERM");
    this.child = null;
    this.setState({ state: "offline", reason: "link_stack_down", contract: this.state.contract });
  }

  private setState(state: EngineLinkState): void {
    const previous = this.state.state;
    this.state = LinkState.parse(state);
    if (previous !== state.state) this.deps.log("state_changed", { from: previous, to: state.state, code: state.reason, attempt: this.attempt, rtt_ms: state.rtt_ms });
  }

  private schedule(fn: () => void, delay: number): void {
    if (this.timer) this.deps.clearTimeout(this.timer);
    this.timer = this.deps.setTimeout(fn, delay);
  }

  private async connect(generation: number): Promise<void> {
    if (!this.running || generation !== this.generation) return;
    this.setState({ state: this.attempt ? "reconnecting" : "connecting", reason: "link_timeout", contract: this.state.contract });
    let allowed = false;
    try { allowed = await this.deps.hostAllowed(this.config.host, { allowTailnet: this.config.allowTailnet }); } catch { /* fail closed */ }
    if (!allowed) {
      this.fail("link_outside_home", true);
      return;
    }
    const args = ["-N", "-T", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${this.config.knownHostsPath}`, "-o", "IdentitiesOnly=yes", "-i", this.config.privateKeyPath, "-L", `127.0.0.1:${this.config.localPort}:127.0.0.1:8770`, "-p", String(this.config.sshPort), `maipai-stack@${this.config.host}`];
    try {
      const child = this.deps.spawn("ssh", args, { env: this.config.env, stdio: ["ignore", "ignore", "ignore"] });
      this.child = child;
      child.once("exit", (code, signal) => {
        if (!this.running || generation !== this.generation) return;
        this.child = null;
        this.fail(mapSshFailure(code, signal));
      });
    } catch {
      this.fail("link_refused");
      return;
    }
    await this.probe(generation);
  }

  private async probe(generation: number): Promise<void> {
    if (!this.running || generation !== this.generation || !this.child) return;
    const started = this.deps.now();
    const controller = new AbortController();
    const timeout = this.deps.setTimeout(() => controller.abort(), LINK_PROBE_TIMEOUT_MS);
    try {
      const response = await this.deps.fetch(`http://127.0.0.1:${this.config.localPort}/healthz`, { signal: controller.signal });
      if (!response.ok) throw new Error("probe");
      const health = await response.json() as { ok?: boolean; contract?: number };
      if (health.ok !== true || !Number.isInteger(health.contract)) throw new Error("probe");
      if (health.contract! < STACK_CONTRACT_MIN || health.contract! > STACK_CONTRACT_MAX) {
        this.fail("link_needs_update", true, String(health.contract));
        return;
      }
      const rtt = Math.max(0, Math.round(this.deps.now() - started));
      if (this.readyAt === null) this.readyAt = this.deps.now();
      if (this.deps.now() - this.readyAt >= LINK_READY_RESET_MS) this.attempt = 0;
      this.failures = 0;
      this.setState({ state: "ready", contract: String(health.contract), rtt_ms: rtt, last_ok_at: new Date(this.deps.now()).toISOString(), path: this.config.allowTailnet ? "tailnet" : "home" });
      this.schedule(() => void this.probe(generation), LINK_PROBE_INTERVAL_MS);
    } catch {
      this.readyAt = null;
      this.failures++;
      const reason: LinkReason = this.failures < 2 ? "link_stack_down" : "link_timeout";
      this.fail(reason);
    } finally {
      this.deps.clearTimeout(timeout);
    }
  }

  private fail(reason: LinkReason, terminal = false, contract = this.state.contract): void {
    this.child?.kill("SIGTERM");
    this.child = null;
    this.readyAt = null;
    this.setState({ state: terminal ? "offline" : this.attempt ? "reconnecting" : "connecting", reason, contract });
    if (!this.running || terminal) return;
    const delay = fullJitterDelay(this.attempt++, this.deps.random);
    this.schedule(() => void this.connect(this.generation), delay);
  }
}

let activeLink: EngineLink | null = null;
export function startEngineLink(config: LinkConfig, deps?: Partial<LinkDependencies>): EngineLink {
  activeLink?.stop();
  activeLink = new EngineLink(config, deps);
  activeLink.start();
  return activeLink;
}
export function stopEngineLink(): void { activeLink?.stop(); activeLink = null; }
export function getEngineLinkState(): EngineLinkState | null { return activeLink?.snapshot() ?? null; }
export function __setEngineLinkForTests(link: EngineLink | null): void { activeLink = link; }
