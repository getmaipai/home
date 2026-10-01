import { recordStatusSample } from "@/lib/statusHistory";
import { StatusComponent } from "@maipai/spec/gen/ts/status-component.js";
import { listStatusApps, type StatusApp } from "@/lib/appNeeds";
import { resolveIssue, raiseIssue, listIssues } from "@/lib/issues";
import { serviceComponent, serviceId } from "@/lib/serviceComponent";

export type ServiceOutcome = "success" | "timeout" | "server_error" | "limited" | "error";
export type ServiceSample = { at: number; outcome: ServiceOutcome; errorClass: string | null };
export type ServiceHealthDetail = { last_success_at: string | null; last_error_class: string | null };
export type ServiceHealthDiagnostics = ServiceHealthDetail & { success_count: number; failure_count: number };

const IDLE_MS = 6 * 60 * 60 * 1000;
const samples = new Map<string, ServiceSample[]>();
const details = new Map<string, ServiceHealthDetail>();
const outageSince = new Map<string, number>();
let internetState: "up" | "down" | null = null;
const DEBOUNCE_MS = 60_000;
let lastInternetAt = 0;
const timeoutByMinute = new Map<number, Set<string>>();

export function classifyServiceOutcome(error: unknown, status?: number): { outcome: ServiceOutcome; errorClass: string | null } {
  if (status === 429) return { outcome: "limited", errorClass: "http_429" };
  if (status !== undefined && status >= 500) return { outcome: "server_error", errorClass: `http_${status}` };
  if (status !== undefined && status >= 400) return { outcome: "error", errorClass: `http_${status}` };
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timed out|timeout|abort/i.test(message) || name === "AbortError") return { outcome: "timeout", errorClass: "timeout" };
  if (/captcha|login_required|sign.?in|confirm you.re not a bot/i.test(message)) return { outcome: "limited", errorClass: "access_wall" };
  return { outcome: "error", errorClass: name };
}

/** Keep a known-good service operational through one transient failure.
 * Two consecutive failures degrade, three consecutive timeouts or 5xx
 * responses are an outage, and a block signal is degraded immediately. */
function derive(rows: ServiceSample[], now = Date.now()): "operational" | "degraded" | "outage" | null {
  if (!rows.length || now - rows.at(-1)!.at > IDLE_MS) return null;
  const recent = rows.filter((row) => now - row.at <= IDLE_MS);
  const trailingFailures: ServiceSample[] = [];
  for (let i = recent.length - 1; i >= 0 && recent[i]!.outcome !== "success"; i--) trailingFailures.unshift(recent[i]!);
  if (!trailingFailures.length) return "operational";
  if (trailingFailures.some((row) => row.outcome === "limited")) return "degraded";
  if (trailingFailures.length >= 3 && trailingFailures.slice(-3).every((row) => row.outcome === "timeout" || row.outcome === "server_error")) return "outage";
  if (trailingFailures.length >= 2) return "degraded";
  return recent.some((row) => row.outcome === "success") ? "operational" : "degraded";
}

export async function recordServiceOutcome(host: string, result: { ok: boolean; status?: number; error?: unknown }, now = new Date()): Promise<void> {
  const id = serviceId(host);
  const component = serviceComponent(host);
  if (!StatusComponent.safeParse(component).success) return;
  const classified = result.ok ? { outcome: "success" as const, errorClass: null } : classifyServiceOutcome(result.error, result.status);
  const rows = samples.get(id) ?? [];
  rows.push({ at: now.getTime(), ...classified });
  const bounded = rows.filter((row) => now.getTime() - row.at <= IDLE_MS).slice(-100);
  samples.set(id, bounded);
  if (classified.outcome === "timeout") {
    const minute = Math.floor(now.getTime() / 60_000);
    const hosts = timeoutByMinute.get(minute) ?? new Set<string>();
    hosts.add(id);
    timeoutByMinute.set(minute, hosts);
    for (const key of timeoutByMinute.keys()) if (minute - key > 2) timeoutByMinute.delete(key);
    if (hosts.size >= 3 && (!lastInternetAt || now.getTime() - lastInternetAt > 60_000)) {
      lastInternetAt = now.getTime();
      void recordStatusSample(now, "down");
    }
  }
  const previous = details.get(id) ?? { last_success_at: null, last_error_class: null };
  details.set(id, {
    last_success_at: result.ok ? now.toISOString() : previous.last_success_at,
    last_error_class: result.ok ? previous.last_error_class : classified.errorClass,
  });
  const previousOutage = outageSince.get(id);
  if (result.ok) outageSince.delete(id);
  else if (derive(bounded, now.getTime()) === "outage") {
    const prior = samples.get(id)?.filter((row) => row.outcome === "timeout" || row.outcome === "server_error") ?? [];
    outageSince.set(id, previousOutage ?? prior.at(-3)?.at ?? now.getTime());
  } else outageSince.delete(id);
  void recordStatusSample(now);
}

export function serviceState(component: string, now = Date.now()): "operational" | "degraded" | "outage" | "unknown" {
  if (!component.startsWith("service:")) return "unknown";
  const rows = samples.get(component.slice("service:".length)) ?? [];
  void now;
  return derive(rows, now) ?? "unknown";
}

export function serviceDetail(component: string): ServiceHealthDetail {
  return details.get(component.slice("service:".length)) ?? { last_success_at: null, last_error_class: null };
}

export function serviceDiagnostics(component: string): ServiceHealthDiagnostics {
  const rows = samples.get(component.slice("service:".length)) ?? [];
  return { ...serviceDetail(component), success_count: rows.filter((row) => row.outcome === "success").length,
    failure_count: rows.filter((row) => row.outcome !== "success").length };
}

/** Called by the existing 30-second status sampler; issue notification is
 * delayed for one minute to suppress short external-service blips. */
export async function reconcileServiceBlockIssues(now = new Date(), observedInternet?: "operational" | "degraded" | "down" | null): Promise<void> {
  if (observedInternet !== undefined && observedInternet !== null) internetState = observedInternet === "down" ? "down" : "up";
  const apps = listStatusApps();
  const needed = new Map<string, Array<{ app: StatusApp; need: StatusApp["needs"][number] }>>();
  const requiredIds = new Set<string>();
  const recoveredIds = new Set<string>();
  for (const app of apps) for (const need of app.needs) if (need.kind === "service" && need.required) {
    const rows = needed.get(need.id) ?? [];
    rows.push({ app, need });
    needed.set(need.id, rows);
  }
  for (const [id, blockers] of needed) {
    const component = `service:${serviceId(id)}`;
    const down = serviceState(component, now.getTime()) === "outage";
    const latestSample = (samples.get(serviceId(id)) ?? []).at(-1);
    const hasOpenIssue = listIssues({ includeResolved: true }).some((issue) => issue.source === "required-service" && issue.key === serviceId(id) && !issue.resolved_at);
    const first = outageSince.get(serviceId(id));
    const key = serviceId(id);
    requiredIds.add(key);
    if (!down || (hasOpenIssue && latestSample?.outcome === "success")) {
      resolveIssue("required-service", key);
      if (hasOpenIssue && latestSample?.outcome === "success") recoveredIds.add(key);
      continue;
    }
    if (!first || now.getTime() - first < DEBOUNCE_MS) continue;
    const diagnostics = serviceDiagnostics(component);
    const names = [...new Map(blockers.map(({ app, need }) => [app.id, { app, need }])).values()];
    if (listIssues({ includeResolved: true }).some((issue) => issue.source === "required-service" && issue.key === key && !issue.resolved_at)) continue;
    await raiseIssue({ source: "required-service", key, severity: "error",
      title: `${names.map(({ app }) => app.name).join(", ")} ${names.length === 1 ? "is" : "are"} blocked by ${blockers[0]!.need.name}`,
      detail: `Required service ${blockers[0]!.need.name} is unreachable. Last success: ${diagnostics.last_success_at ?? "none recorded"}. Error class: ${diagnostics.last_error_class ?? "unknown"}. Requests: ${diagnostics.success_count} successes, ${diagnostics.failure_count} failures.`,
      remindAfterMs: 15 * 60_000 });
  }
  for (const issue of listIssues({ includeResolved: true })) {
    if (issue.source === "required-service" && (!requiredIds.has(issue.key) || recoveredIds.has(issue.key))) resolveIssue(issue.source, issue.key);
  }
  const internetBlocked = internetState === "down" && apps.some((app) => app.needs.some((need) => need.kind === "internet" && need.required));
  if (internetBlocked) {
    const appNames = apps.filter((app) => app.needs.some((need) => need.kind === "internet" && need.required)).map((app) => app.name);
    await raiseIssue({ source: "internet-service", key: "internet", severity: "warning",
      title: `${appNames.join(", ")} waiting for the internet`, detail: "The household internet check is down. This is a passive status item." });
  } else resolveIssue("internet-service", "internet");
}

export const resolveServiceBlockIssues = (now = new Date()) => reconcileServiceBlockIssues(now);
export function __setInternetStateForTests(state: "up" | "down" | null): void { internetState = state; }

export function knownServiceComponents(): string[] {
  return [...samples.keys()].map((id) => `service:${id}`);
}

export function __resetServiceHealthForTests(): void { samples.clear(); details.clear(); outageSince.clear(); timeoutByMinute.clear(); lastInternetAt = 0; internetState = null; }
