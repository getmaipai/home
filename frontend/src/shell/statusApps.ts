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

export function statusAppsSummary(apps: readonly { id?: string; name: string; state: StatusAppState; reason: string | null; paused?: boolean }[]) {
  const affected = apps.filter((app) => app.state !== "operational");
  if (!affected.length) return { level: "online" as const, text: "All good", problems: [], message: "Everything is running." };
  const level = affected.some((app) => app.state === "down") ? "offline" as const : "degraded" as const;
  const messages = affected.map((app) => app.reason).filter((reason): reason is string => Boolean(reason));
  const names = affected.map((app) => app.name);
  if (affected.length === 1 && affected[0] && isSearchLimitedChat(affected[0])) {
    return { level, text: pillText(affected, level), problems: names, message: "Chat is working, but search is limited right now." };
  }
  return { level, text: pillText(affected, level), problems: names, message: messages.join(" ") || `${names.join(", ")} need attention.` };
}

/** The public Chat reason is only used as a signal. The exact safe wording
 * stays here, while raw service details remain on the admin status page. */
export function isSearchLimitedChat(app: { id?: string; name: string; state: StatusAppState; reason: string | null }): boolean {
  return app.state === "degraded"
    && (app.id === "chat" || app.name.toLocaleLowerCase() === "chat")
    && /search/i.test(app.reason ?? "");
}

// CHAT-CALM-ERRORS-01d (design section 6): when chat is the one part
// affected, the pill names it: "Chat paused" (amber) while its engine is
// stopped or starting and will be back on its own (the hub's `paused`
// flag), "Chat is down" (red) once the Stack gave up. Anything else (an
// optional part down, more than one part) keeps the general wording.
function pillText(affected: readonly { id?: string; state: StatusAppState; paused?: boolean }[], level: "offline" | "degraded"): string {
  const only = affected.length === 1 ? affected[0] : undefined;
  if (only?.id === "chat" && only.state === "degraded" && only.paused) return "Chat paused";
  if (only?.id === "chat" && only.state === "down") return "Chat is down";
  return level === "offline" ? "Something is down" : "Degraded";
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
    if (isSearchLimitedChat(app)) return "Chat is working, but search is limited right now.";
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
  if (app.id === "chat" && !problem.required && plainNeedName(problem) === "search") {
    return "Chat is working, but search is limited right now.";
  }
  if (!problem.required) return `${app.name} is working, but ${cause}.`;
  if (problem.state === "down") return `${app.name} isn't working: ${cause}.`;
  if (problem.kind === "engine") return `${app.name} is slow to start: ${cause}.`;
  return `${app.name} is working slowly: ${cause}.`;
}
