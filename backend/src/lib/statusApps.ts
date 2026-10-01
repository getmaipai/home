export type AppNeed = { kind: "engine" | "service" | "internet"; id: string; name: string; purpose: string; required: boolean };
export type AppState = "operational" | "degraded" | "down" | "waiting_for_internet";
export type NeedState = "operational" | "degraded" | "down" | "waiting" | "unknown";
import { serviceState } from "@/lib/serviceHealth";
export type StatusApp = { id: string; name: string; needs: AppNeed[] };
export type StatusEventLike = { component: string; state: string; at: string };

const ENGINE_COMPONENT: Record<string, string> = { chat: "chat", understanding: "embed", memory: "background", voice: "voice", hub: "hub" };
export function componentForNeed(need: AppNeed): string {
  if (need.kind === "internet") return "internet";
  if (need.kind === "service") return `service:${need.id}`;
  return ENGINE_COMPONENT[need.id] ?? need.id;
}

function normalized(state: string | undefined): NeedState {
  if (state === "outage" || state === "down") return "down";
  if (state === "degraded") return "degraded";
  return "operational";
}

function currentState(component: string, state: string | undefined): NeedState | "unknown" {
  if (component.startsWith("service:")) {
    const derived = serviceState(component);
    if (derived === "unknown") return "unknown";
    if (derived === "outage") return "down";
    return derived;
  }
  return state ? normalized(state) : "unknown";
}

export function deriveAppState(needs: Array<Pick<AppNeed, "required" | "kind"> & { state: string }>): AppState {
  const internetDown = needs.some((need) => need.kind === "internet" && need.required && normalized(need.state) === "down");
  if (internetDown) return "waiting_for_internet";
  if (needs.some((need) => need.required && normalized(need.state) === "down")) return "down";
  if (needs.some((need) => normalized(need.state) !== "operational")) return "degraded";
  return "operational";
}

export function needStates(app: StatusApp, events: StatusEventLike[]): Array<AppNeed & { state: NeedState }> {
  const latest = new Map<string, StatusEventLike>();
  for (const event of events) {
    if (!latest.has(event.component) || latest.get(event.component)!.at < event.at) latest.set(event.component, event);
  }
  const internetDown = app.needs.some((need) => need.kind === "internet" && need.required && normalized(latest.get("internet")?.state) === "down");
  return app.needs.map((need) => {
    const component = componentForNeed(need);
    const raw = currentState(component, latest.get(component)?.state);
    return { ...need, state: internetDown && need.kind !== "internet" ? "waiting" : raw };
  });
}

export function unionRequiredDowntime(intervalGroups: number[][][]): number[][] {
  const intervals = intervalGroups.flat().filter((interval) => interval[0] !== undefined && interval[1] !== undefined && Number.isFinite(interval[0]) && Number.isFinite(interval[1]) && interval[1] > interval[0]).sort((a, b) => a[0]! - b[0]!);
  const merged: number[][] = [];
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (last && start! <= last[1]!) last[1] = Math.max(last[1]!, end!);
    else merged.push([start!, end!]);
  }
  return merged;
}

function eventIntervals(component: string, eventsByComponent: Map<string, StatusEventLike[]>, start: number, end: number) {
  const timeline = [...(eventsByComponent.get(component) ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const prior = timeline.filter((event) => Date.parse(event.at) < start).at(-1);
  const rows = prior ? [prior, ...timeline.filter((event) => Date.parse(event.at) >= start && Date.parse(event.at) <= end)] : timeline.filter((event) => Date.parse(event.at) >= start && Date.parse(event.at) <= end);
  const result: Record<"down" | "degraded" | "maintenance", number[][]> = { down: [], degraded: [], maintenance: [] };
  for (let i = 0; i < rows.length; i++) {
    const event = rows[i]!;
    const from = Math.max(start, Date.parse(event.at));
    const to = Math.min(end, rows[i + 1] ? Date.parse(rows[i + 1]!.at) : end);
    if (to <= from) continue;
    if (event.state === "outage" || event.state === "down") result.down.push([from, to]);
    if (event.state === "degraded") result.degraded.push([from, to]);
    if (event.state === "maintenance") result.maintenance.push([from, to]);
  }
  return result;
}

function subtractIntervals(source: number[][], excluded: number[][]): number[][] {
  let output = unionRequiredDowntime([source]);
  for (const [cutStart, cutEnd] of unionRequiredDowntime([excluded])) {
    output = output.flatMap(([start, end]) => {
      const pieces: number[][] = [];
      if (start! < cutStart!) pieces.push([start!, Math.min(end!, cutStart!)]);
      if (end! > cutEnd!) pieces.push([Math.max(start!, cutEnd!), end!]);
      return pieces.filter(([a, b]) => b! > a!);
    });
  }
  return output;
}

export function buildAppHistory(needs: AppNeed[], events: StatusEventLike[], now = new Date(), days = 90) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = today - (days - 1) * 86_400_000;
  const end = now.getTime();
  const byComponent = new Map<string, StatusEventLike[]>();
  for (const event of events) {
    const rows = byComponent.get(event.component) ?? [];
    rows.push(event);
    byComponent.set(event.component, rows);
  }
  const required = needs.filter((item) => item.required);
  const downGroups = required.filter((item) => item.kind !== "internet").map((need) => eventIntervals(componentForNeed(need), byComponent, start, end).down);
  const maintenanceGroups = required.map((need) => eventIntervals(componentForNeed(need), byComponent, start, end).maintenance);
  const optionalIssueGroups = needs.filter((item) => !item.required).map((need) => {
    const intervals = eventIntervals(componentForNeed(need), byComponent, start, end);
    return [...intervals.down, ...intervals.degraded];
  });
  const requiredDegradedGroups = required.filter((item) => item.kind !== "internet").map((need) => eventIntervals(componentForNeed(need), byComponent, start, end).degraded);
  const internetDown = unionRequiredDowntime(required.filter((item) => item.kind === "internet").map((need) => eventIntervals("internet", byComponent, start, end).down));
  const knownStarts = required.map((need) => {
    const first = [...(byComponent.get(componentForNeed(need)) ?? [])].filter((event) => Date.parse(event.at) <= end).sort((a, b) => a.at.localeCompare(b.at))[0];
    return first ? Math.max(start, Date.parse(first.at)) : end;
  });
  const knownStart = required.length > 0 ? Math.max(...knownStarts) : end;
  const maintenance = unionRequiredDowntime(maintenanceGroups);
  let down = unionRequiredDowntime(downGroups);
  if (required.some((item) => item.kind === "internet")) down = subtractIntervals(down, internetDown);
  down = subtractIntervals(down, maintenance);
  const degraded = unionRequiredDowntime([...optionalIssueGroups, ...requiredDegradedGroups]);
  const duration = (intervals: number[][], from: number, to: number) => intervals.reduce((total, [a, b]) => total + Math.max(0, Math.min(to, b!) - Math.max(from, a!)), 0);
  const buckets = Array.from({ length: days }, (_, index) => {
    const from = start + index * 86_400_000;
    const to = Math.min(end, from + 86_400_000);
    const knownFrom = Math.max(from, knownStart);
    const downtime = duration(down, knownFrom, to);
    const maintenanceMs = duration(maintenance, knownFrom, to);
    const eligible = Math.max(0, to - knownFrom - maintenanceMs);
    const uptime = eligible > 0 ? Number(((eligible - downtime) / eligible * 100).toFixed(3)) : 100;
    const internetWaiting = required.some((item) => item.kind === "internet") && internetDown.some(([a, b]) => Math.min(to, b!) > Math.max(from, a!));
    const degradedToday = degraded.some(([a, b]) => Math.min(to, b!) > Math.max(from, a!));
    const state: AppState = internetWaiting ? "waiting_for_internet" : downtime > 0 ? "down" : degradedToday ? "degraded" : "operational";
    return { date: new Date(from).toISOString().slice(0, 10), state, uptime };
  });
  const eligible = Math.max(0, end - knownStart - duration(maintenance, knownStart, end));
  const downtime = duration(down, knownStart, end);
  const uptimePercent = eligible > 0 ? Number(((eligible - downtime) / eligible * 100).toFixed(3)) : 100;
  return { history: buckets, uptimePercent };
}

export function currentNeedStates(app: StatusApp, events: StatusEventLike[]) {
  return needStates(app, events);
}

export function appResponse(app: StatusApp, events: StatusEventLike[], showNeeds: boolean, now = new Date()) {
  const needs = currentNeedStates(app, events);
  const state = deriveAppState(needs);
  const history = buildAppHistory(app.needs, events, now);
  return {
    id: app.id,
    name: app.name,
    state,
    reason: appReason(app, state, needs),
    ...(showNeeds ? { needs: needs.map((need) => ({ ...need, state: state === "waiting_for_internet" && need.kind !== "internet" ? "waiting" as const : need.state })) } : {}),
    history: history.history,
    uptimePercent: history.uptimePercent,
  };
}

export function appReason(app: StatusApp, state: AppState, needs: Array<AppNeed & { state: NeedState }>): string | null {
  if (state === "operational") return null;
  if (state === "waiting_for_internet") return `${app.name} is waiting for the internet.`;
  const failed = needs.find((need) => need.required && need.state === "down");
  if (!failed && needs.some((need) => need.required && need.state === "degraded")) return `${app.name} is starting up.`;
  const limited = needs.find((need) => need.kind === "service" && need.state === "degraded");
  if (limited) return `${limited.name} is limiting requests from this home for a while.`;
  if (needs.some((need) => need.kind === "service" && need.state === "unknown")) return `${app.name} has outside services with no recent use.`;
  if (failed?.kind === "service") return `${app.name} isn't working: ${failed.name} isn't reachable.`;
  if (failed?.id === "hub") return `${app.name} isn't working: MaiPai Home isn't running.`;
  if (failed) return `${app.name} isn't working: MaiPai's AI isn't running.`;
  return `${app.name}'s optional features may be unavailable.`;
}
