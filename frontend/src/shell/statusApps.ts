import type { StatusAppNeed, StatusAppState } from "@/lib/api";
import type { StatusApp } from "@/lib/api";

export function appStatusPresentation(state: StatusAppState): { status: "online" | "degraded" | "offline"; label: string } {
  if (state === "operational") return { status: "online", label: "Working" };
  if (state === "down") return { status: "offline", label: "Not working" };
  if (state === "waiting_for_internet") return { status: "degraded", label: "Waiting for internet" };
  return { status: "degraded", label: "Degraded" };
}

export function appStatusToSidebar(state: StatusAppState): "amber" | "red" | null {
  if (state === "down") return "red";
  if (state === "degraded" || state === "waiting_for_internet") return "amber";
  return null;
}

export function appStatusSentence(name: string, state: StatusAppState, reason: string | null): { ariaLabel: string; title: string } {
  const label = appStatusPresentation(state).label.toLocaleLowerCase();
  return { ariaLabel: `${name}: ${label}`, title: reason ?? (state === "operational" ? `${name} is working.` : `${name} needs attention.`) };
}

export function appStatusMenuBadge(app: StatusApp): { badge: "amber" | "red"; title: string; ariaLabel: string } | undefined {
  const badge = appStatusToSidebar(app.state);
  if (!badge) return undefined;
  return { badge, ...appStatusSentence(app.name, app.state, app.reason) };
}

export function sidebarItemStatus(apps: readonly StatusApp[], item: { name: string; url?: string }) {
  if (!Array.isArray(apps)) return undefined;
  const app = apps.find((candidate) => candidate.name.toLocaleLowerCase() === item.name.toLocaleLowerCase());
  return app ? appStatusMenuBadge(app) : undefined;
}

export function statusAppsSummary(apps: readonly { name: string; state: StatusAppState; reason: string | null }[]) {
  const affected = apps.filter((app) => app.state !== "operational");
  if (!affected.length) return { level: "online" as const, text: "All good", problems: [], message: "Everything is running." };
  const level = affected.some((app) => app.state === "down") ? "offline" as const : "degraded" as const;
  const messages = affected.map((app) => app.reason).filter((reason): reason is string => Boolean(reason));
  const names = affected.map((app) => app.name);
  return { level, text: level === "offline" ? "Something is down" : "Degraded", problems: names, message: messages.join(" ") || `${names.join(", ")} need attention.` };
}

function problemPriority(state: StatusAppNeed["state"]): number {
  if (state === "down") return 3;
  if (state === "waiting") return 2;
  if (state === "degraded") return 1;
  return 0;
}

function plainNeedName(need: StatusAppNeed): string {
  if (need.kind === "internet" || need.name.toLocaleLowerCase() === "internet") return "the internet";
  if (need.name === "Household web search") return "search";
  return need.name;
}

function needProblemWords(need: StatusAppNeed): string {
  const name = plainNeedName(need);
  if (need.state === "waiting") return "the internet is having trouble";
  if (need.kind === "engine") {
    if (need.state === "down") return `${name} isn't running`;
    if (need.state === "degraded") return `${name} is still starting`;
  }
  if (need.state === "down") return `${name} isn't reachable`;
  return `${name} is having trouble`;
}

/** Summarizes known need state without counting services that have not been used recently. */
export function summarizeStatusApp(app: StatusApp, includeNeedNames = true): string {
  const needs = app.needs;
  if (!includeNeedNames || !needs) {
    if (app.state === "operational") return "All fine.";
    return app.reason ?? `${app.name} needs attention.`;
  }

  const problems = needs
    .filter((need) => need.state !== "operational" && need.state !== "unknown")
    .sort((a, b) => Number(b.required) - Number(a.required) || problemPriority(b.state) - problemPriority(a.state));
  const problem = problems[0];
  if (!problem) return needs.some((need) => need.state === "unknown") ? "No recent problems." : "All fine.";

  if (problem.state === "waiting") {
    return problem.required
      ? `${app.name} is waiting for the internet.`
      : `${app.name} is working, but the internet is having trouble.`;
  }

  const cause = needProblemWords(problem);
  if (!problem.required) return `${app.name} is working, but ${cause}.`;
  if (problem.state === "down") return `${app.name} isn't working: ${cause}.`;
  if (problem.kind === "engine") return `${app.name} is slow to start: ${cause}.`;
  return `${app.name} is working slowly: ${cause}.`;
}
