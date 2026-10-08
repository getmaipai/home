import type { LinkState as EngineLinkState } from "@maipai/spec/gen/ts/link-state";
import type { Issue } from "@maipai/spec/gen/ts/issue.js";
import { listIssues, raiseIssue, resolveIssue } from "@/lib/issues";
import { LINK_OFFLINE_AFTER_MS } from "@/lib/stack/link";

export const STACK_LINK_ISSUE_SOURCE = "stack";
export const STACK_LINK_ISSUE_KEY = "link.down";
export const STACK_LINK_REPEAT_WINDOW_MS = 30 * 60_000;
export const STACK_LINK_RECOVERY_MS = 60_000;
export const STACK_LINK_OUTAGE_MS = LINK_OFFLINE_AFTER_MS;

type Timer = ReturnType<typeof setTimeout>;
export interface LinkRepairDependencies {
  now(): number;
  setTimeout(fn: () => void, ms: number): Timer;
  clearTimeout(timer: Timer): void;
  raise(input: Parameters<typeof raiseIssue>[0]): Promise<unknown>;
  resolve(source: string, key: string, opts?: { suppressNotification?: boolean; notificationTitle?: string }): void;
  readIssue(): Issue | undefined;
}

const realDependencies: LinkRepairDependencies = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
  raise: raiseIssue,
  resolve: resolveIssue,
  readIssue: () => listIssues({ includeResolved: true }).find((issue) => issue.source === STACK_LINK_ISSUE_SOURCE && issue.key === STACK_LINK_ISSUE_KEY),
};

const IMMEDIATE_REASONS = new Set(["link_host_key_changed", "link_needs_update", "link_outside_home"]);

function isUp(state: EngineLinkState): boolean {
  return state.state === "ready" || (state.state === "degraded" && state.reason === undefined);
}

/** Keeps the remote Stack's one Repairs row in step with the link state.
 * Alert copy is fixed here so no host, address, or SSH output can enter it. */
export class StackLinkRepairs {
  private readonly deps: LinkRepairDependencies;
  private incident = false;
  private warningRaised = false;
  private errorRaised = false;
  private notifyThisIncident = true;
  private lastAlertAt: number | null = null;
  private downSince = 0;
  private generation = 0;
  private outageTimer: Timer | null = null;
  private recoveryTimer: Timer | null = null;

  constructor(deps: Partial<LinkRepairDependencies> = {}) { this.deps = { ...realDependencies, ...deps }; }

  stateChanged(state: EngineLinkState): void {
    if (isUp(state)) {
      if (!this.incident) return;
      this.clearOutageTimer();
      if (this.recoveryTimer) this.deps.clearTimeout(this.recoveryTimer);
      const generation = this.generation;
      this.recoveryTimer = this.deps.setTimeout(() => {
        if (generation !== this.generation || !this.incident) return;
        this.deps.resolve(STACK_LINK_ISSUE_SOURCE, STACK_LINK_ISSUE_KEY, {
          suppressNotification: !this.errorRaised || !this.notifyThisIncident,
          notificationTitle: "Fixed: the engine computer is back.",
        });
        this.clearIncident();
      }, STACK_LINK_RECOVERY_MS);
      return;
    }

    if (!this.incident) this.beginIncident();
    if (this.recoveryTimer) { this.deps.clearTimeout(this.recoveryTimer); this.recoveryTimer = null; }
    if (IMMEDIATE_REASONS.has(state.reason ?? "")) {
      void this.raiseError(state.reason);
      return;
    }
    if (!this.warningRaised) {
      this.warningRaised = true;
      void this.deps.raise({ source: STACK_LINK_ISSUE_SOURCE, key: STACK_LINK_ISSUE_KEY, severity: "warning", title: DOWN_COPY, detail: "The engine computer is reconnecting. Chat and pictures are paused until it is back.", notifyOnEscalation: false });
    }
    this.scheduleEscalation();
  }

  /** A deliberate switch away from the remote engine closes its row silently. */
  reset(): void {
    this.deps.resolve(STACK_LINK_ISSUE_SOURCE, STACK_LINK_ISSUE_KEY, { suppressNotification: true });
    this.clearIncident();
  }

  private beginIncident(): void {
    this.incident = true;
    this.warningRaised = false;
    this.errorRaised = false;
    const previousIssue = this.deps.readIssue();
    this.downSince = this.deps.now();
    if (previousIssue?.resolved_at && previousIssue.severity === "error") {
      const resolvedAt = Date.parse(previousIssue.resolved_at);
      if (Number.isFinite(resolvedAt)) this.lastAlertAt = Math.max(this.lastAlertAt ?? 0, resolvedAt);
    }
    this.notifyThisIncident = this.lastAlertAt === null || this.downSince - this.lastAlertAt >= STACK_LINK_REPEAT_WINDOW_MS;
    if (previousIssue?.resolved_at === null && previousIssue.severity === "error") {
      this.warningRaised = true;
      this.errorRaised = true;
      this.notifyThisIncident = false;
    }
    ++this.generation;
  }

  private scheduleEscalation(): void {
    if (this.errorRaised || this.outageTimer) return;
    const generation = this.generation;
    this.outageTimer = this.deps.setTimeout(() => {
      this.outageTimer = null;
      if (!this.incident || generation !== this.generation) return;
      void this.raiseError();
    }, Math.max(0, this.downSince + STACK_LINK_OUTAGE_MS - this.deps.now()));
  }

  private async raiseError(reason?: string): Promise<void> {
    if (this.errorRaised) return;
    this.errorRaised = true;
    this.clearOutageTimer();
    const copy = reason === "link_host_key_changed"
      ? { title: "The engine computer changed its security key. Pair it again.", detail: "Pair the engine computer again to reconnect." }
      : reason === "link_needs_update"
        ? { title: "The engine computer needs an update.", detail: "Run maipai-engine update on the engine computer to reconnect." }
        : reason === "link_outside_home"
          ? { title: "You're away from home, so chat is paused.", detail: "To use the engine computer from here, turn on Reach it when away from home in Settings, Engines." }
          : { title: DOWN_COPY, detail: DOWN_COPY };
    await this.deps.raise({
      source: STACK_LINK_ISSUE_SOURCE,
      key: STACK_LINK_ISSUE_KEY,
      severity: "error",
      title: copy.title,
      detail: copy.detail,
      notifyOnEscalation: true,
      suppressNotification: !this.notifyThisIncident,
    });
    if (this.notifyThisIncident) this.lastAlertAt = this.deps.now();
  }

  private clearOutageTimer(): void {
    if (this.outageTimer) this.deps.clearTimeout(this.outageTimer);
    this.outageTimer = null;
  }

  private clearIncident(): void {
    ++this.generation;
    this.clearOutageTimer();
    if (this.recoveryTimer) this.deps.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.incident = false;
    this.warningRaised = false;
    this.errorRaised = false;
    this.notifyThisIncident = true;
  }
}

const activeRepairs = new StackLinkRepairs();
export function reportStackLinkState(state: EngineLinkState): void { activeRepairs.stateChanged(state); }
export function resetStackLinkRepairs(): void { activeRepairs.reset(); }

const DOWN_COPY = "The engine computer isn't answering. Chat and pictures are paused until it's back. Check that it's on and connected to your home network.";
