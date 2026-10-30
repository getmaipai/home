// CANARY-01: runs checks, keeps results, and turns failures into the EXISTING mechanisms: one Repairs item per check
// (which fires the one admin Notification per incident), the Status page row, and one restart request for a dead chat.
import { hotReloadState } from "@/lib/hotReloadState";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { CHECKS, CHECK_BY_ID } from "./checks";
import * as results from "./results";
import { ORDER, SLOW_BACKOFF_MS, dueChecks, noteRun, pickSearchPhrase, schedule, searchAllowed, SEARCH_QUIET_MS } from "./schedule";
import type { CanaryCheck, CanaryDeps, CanaryGroup, CanaryId, CheckResult, Outcome } from "./types";

export const ISSUE_SOURCE = "canary";
export type RunReason = "post_start" | "heal" | "scheduled" | "manual";

const flags = hotReloadState<{ running: boolean; pendingPostStart: boolean; pendingReason: RunReason; lastChatKey: string | null; lastChatGeneration: string | null; lastManualAt: number }>("canaryFlags", () => ({ running: false, pendingPostStart: true, pendingReason: "post_start", lastChatKey: null, lastChatGeneration: null, lastManualAt: 0 }));
export function __resetCanaryRunnerForTests(): void { Object.assign(flags, { running: false, pendingPostStart: true, pendingReason: "post_start" as RunReason, lastChatKey: null, lastChatGeneration: null, lastManualAt: 0 }); }
export function isRunning(): boolean { return flags.running; }
export const MANUAL_DEBOUNCE_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); })]).finally(() => clearTimeout(timer!));
}

async function runOne(check: CanaryCheck, deps: CanaryDeps, ctx: { searchPhrase: string; chatDown: boolean }): Promise<{ result: CheckResult; outcome: Outcome }> {
  const started = deps.now();
  let outcome: Outcome;
  try {
    const out = await withTimeout(check.run(deps, ctx), check.timeoutMs + 5_000);
    outcome = out === "timeout" ? { kind: "fail", cause: `${check.name} did not finish in time.`, fix: "Run the checks again. A busy or low-memory computer is the usual reason." } : out;
  } catch {
    outcome = { kind: "fail", cause: `${check.name} stopped unexpectedly.`, fix: "Run the checks again; if it repeats, restart the AI from Settings, AI." };
  }
  const result: CheckResult = {
    id: check.id,
    at: new Date(deps.now()).toISOString(),
    status: outcome.kind === "pass" ? "pass" : outcome.kind === "fail" ? "fail" : "skipped",
    durationMs: Math.max(0, deps.now() - started),
    firstTokenMs: outcome.kind === "pass" ? outcome.firstTokenMs ?? null : null,
    note: outcome.kind === "fail" ? outcome.cause : outcome.kind === "skip" ? outcome.reason : null,
    ...(outcome.kind === "fail" && outcome.life ? { life: outcome.life } : {}),
  };
  return { result, outcome };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function applyResult(check: CanaryCheck, result: CheckResult, outcome: Outcome, deps: CanaryDeps): Promise<void> {
  const before = results.history(check.id).filter((r) => r.status === "pass").map((r) => r.durationMs);
  const verdict = results.record(result);
  if (verdict.raise && outcome.kind === "fail") {
    await raiseIssue({ source: ISSUE_SOURCE, key: check.id, severity: "error", title: check.title, detail: `${outcome.cause} ${outcome.fix}` });
  } else if (verdict.resolve) {
    resolveIssue(ISSUE_SOURCE, check.id);
  }
  if (check.id === "chat_hello" && verdict.raise) await maybeRestart(deps);
  if (check.id === "gpu_metal" && outcome.kind === "fail") await restartOwnEngines(deps);
  // The canary must never become the load: a hello far slower than usual pauses scheduled checks.
  if (check.id === "chat_hello" && result.status === "pass" && before.length >= 5 && result.durationMs > 3 * median(before)) {
    schedule.slowUntil = deps.now() + SLOW_BACKOFF_MS;
  }
}

/** One supervised restart per incident, only for an engine that is DEAD (its role reports not ready) or HUNG (three hellos in a row with no token at all after the long deadline). Slowness is never a reason, and nothing restarts under load, low memory or a blocker. */
async function maybeRestart(deps: CanaryDeps): Promise<void> {
  if (results.restartAlreadyAsked("chat_hello")) return;
  const role = await deps.chatRole();
  const dead = role.availability === "unavailable";
  const recent = results.history("chat_hello").slice(-3);
  const hung = recent.length === 3 && recent.every((r) => r.status === "fail" && r.life === "hung");
  if (!dead && !hung) return;
  if (deps.loadHigh() || (await deps.blocker()) || !deps.restartBudget.allowed()) return;
  results.markRestartAsked("chat_hello");
  deps.restartBudget.note();
  console.log(JSON.stringify({ event: "engine.restart_requested_by_canary", why: dead ? "role_not_ready" : "no_token_three_times" }));
  await deps.requestRestart(dead ? "chat role not ready at a health check" : "chat gave no token at three health checks").catch(() => false);
}

/** GPU-HEALTH-01: the graphics compiler stopped answering. Once per incident, ask the Stack to restart only its own Metal engines through the
 * self-heal path (never a process it does not own); the restart cannot repair the Mac itself, so the Repairs item after the second failure tells a person to restart it. */
async function restartOwnEngines(deps: CanaryDeps): Promise<void> {
  if (results.restartAlreadyAsked("gpu_metal")) return;
  if (deps.loadHigh() || (await deps.blocker()) || !deps.restartBudget.allowed()) return;
  results.markRestartAsked("gpu_metal");
  deps.restartBudget.note();
  console.log(JSON.stringify({ event: "engine.restart_requested_by_canary", why: "graphics_compiler" }));
  for (const role of ["chat", "image", "video"] as const) await deps.requestRestart("the Mac's graphics compiler stopped answering", role).catch(() => false);
}

export interface RunOptions { reason: RunReason; only?: CanaryId[]; includeSearch?: boolean; includeImage?: boolean }

/** Runs a set of checks, one at a time. Returns what ran; [] when nothing could start. */
export async function runSuite(deps: CanaryDeps, opts: RunOptions): Promise<CheckResult[]> {
  if (flags.running) return [];
  flags.running = true;
  try {
    const blocker = await deps.blocker();
    if (blocker && opts.reason !== "manual") return [];
    const now = deps.now();
    let ids: CanaryId[];
    if (opts.only) ids = ORDER.filter((id) => opts.only!.includes(id));
    else if (opts.reason === "scheduled") ids = dueChecks(now, schedule, { keepWarm: deps.keepWarm() });
    else ids = ORDER.filter((id) => id !== "image_tiny" && id !== "chat_search_trigger");
    if (opts.reason !== "scheduled" && !opts.only) {
      const wantSearch = opts.reason === "manual" ? opts.includeSearch === true : deps.keepWarm() && searchAllowed(schedule, now);
      if (wantSearch) ids.push("chat_search_trigger");
      if (opts.includeImage) ids.push("image_tiny");
      ids = ORDER.filter((id) => ids.includes(id));
    }
    const out: CheckResult[] = [];
    let chatDown = false;
    for (const id of ids) {
      const check = CHECK_BY_ID.get(id)!;
      if (blocker) { // manual run while the machine is busy: say so, change nothing else
        const skipped: CheckResult = { id, at: new Date(deps.now()).toISOString(), status: "skipped", durationMs: 0, firstTokenMs: null, note: blocker };
        results.record(skipped); out.push(skipped); continue;
      }
      if (id === "chat_search_trigger" && deps.searchTrouble()) {
        const skipped: CheckResult = { id, at: new Date(deps.now()).toISOString(), status: "skipped", durationMs: 0, firstTokenMs: null, note: "The search service already reports trouble." };
        results.record(skipped); out.push(skipped); continue;
      }
      const searchPhrase = pickSearchPhrase(deps.random());
      const { result, outcome } = await runOne(check, deps, { searchPhrase, chatDown });
      if (result.status !== "skipped") noteRun(schedule, id, deps.now(), deps.random());
      else if (id !== "chat_hello") schedule.lastRun[id] = deps.now();
      if (id === "chat_hello" && result.status === "fail") chatDown = true;
      if (id === "chat_search_trigger" && result.status === "fail") schedule.searchQuietUntil = deps.now() + SEARCH_QUIET_MS;
      await applyResult(check, result, outcome, deps);
      out.push(result);
    }
    return out;
  } finally {
    flags.running = false;
  }
}

/** Admin "Run checks now": debounced, search canary only when chosen. */
export async function runNow(deps: CanaryDeps, opts: { includeSearch?: boolean; includeImage?: boolean } = {}): Promise<{ ok: true; results: CheckResult[] } | { ok: false; reason: "busy" | "too_soon" }> {
  if (flags.running) return { ok: false, reason: "busy" };
  if (deps.now() - flags.lastManualAt < MANUAL_DEBOUNCE_MS) return { ok: false, reason: "too_soon" };
  flags.lastManualAt = deps.now();
  return { ok: true, results: await runSuite(deps, { reason: "manual", ...opts }) };
}

/** Call after any event that should be followed by the full suite (a Stack restart, an upgrade, a self-heal). */
export function requestFullSuite(reason: RunReason = "heal"): void {
  flags.pendingPostStart = true;
  flags.pendingReason = reason;
}

async function chatGeneration(): Promise<string | null> {
  if (!isStackConfigured()) return null;
  try {
    const role = (await getStackClient().roles()).roles.find((item) => item.id === "chat");
    return role?.state.since || null;
  } catch {
    return null;
  }
}

/** One 60 second tick: the full suite when one is owed, otherwise whatever is due. */
export async function canaryTick(deps: CanaryDeps): Promise<CheckResult[]> {
  if (flags.running) return [];
  const role = await deps.chatRole().catch(() => null);
  if (role) {
    const key = `${role.availability === "unavailable" ? "down" : "up"}`;
    const generation = role.availability === "ready" ? await chatGeneration() : null;
    if (generation) {
      if (flags.lastChatGeneration && flags.lastChatGeneration !== generation) requestFullSuite("post_start");
      flags.lastChatGeneration = generation;
    } else if (flags.lastChatKey === "down" && key === "up") {
      requestFullSuite("heal");
    }
    flags.lastChatKey = key;
  }
  if (flags.pendingPostStart) {
    const ran = await runSuite(deps, { reason: flags.pendingReason });
    if (ran.length > 0) flags.pendingPostStart = false;
    return ran;
  }
  if (deps.turnActive()) return [];
  return runSuite(deps, { reason: "scheduled" });
}

// ---------------------------------------------------------------- what the Status page shows

const GROUP_LABEL: Record<CanaryGroup, string> = { chat: "chat", tools: "tools", search: "search", voice: "voice", pictures: "pictures" };
export interface CanaryStatus {
  running: boolean;
  last_checked_at: string | null;
  groups: Array<{ group: CanaryGroup; label: string; state: "pass" | "fail" | "unknown" }>;
  checks: Array<{ id: CanaryId; name: string; group: CanaryGroup; state: "pass" | "fail" | "skipped" | "unknown"; at: string | null; duration_ms: number | null; first_token_ms: number | null; note: string | null }>;
}

export function canaryStatus(): CanaryStatus {
  const checks = CHECKS.map((c) => {
    const l = results.last(c.id);
    return { id: c.id, name: c.name, group: c.group, state: (l ? l.status : "unknown") as CanaryStatus["checks"][number]["state"], at: l?.at ?? null, duration_ms: l?.durationMs ?? null, first_token_ms: l?.firstTokenMs ?? null, note: l?.note ?? null };
  });
  const order: CanaryGroup[] = ["chat", "tools", "search", "voice", "pictures"];
  const groups = order.map((group) => {
    const real = CHECKS.filter((c) => c.group === group).map((c) => results.lastReal(c.id)).filter((r): r is CheckResult => r !== null);
    const state: "pass" | "fail" | "unknown" = real.length === 0 ? "unknown" : real.some((r) => r.status === "fail") ? "fail" : "pass";
    return { group, label: GROUP_LABEL[group], state };
  });
  const times = CHECKS.map((c) => results.lastReal(c.id)?.at).filter((t): t is string => !!t).sort();
  return { running: flags.running, last_checked_at: times.at(-1) ?? null, groups, checks };
}
