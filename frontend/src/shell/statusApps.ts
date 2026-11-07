import { i18n } from "@lingui/core";
import type { StatusAppNeed, StatusAppState } from "@/lib/api";
import type { StatusApp } from "@/lib/api";

export function appStatusPresentation(state: StatusAppState): { status: "online" | "degraded" | "offline"; label: string } {
  if (state === "operational") return { status: "online", label: i18n._({ id: "Working", message: "Working" }) };
  if (state === "down") return { status: "offline", label: i18n._({ id: "Not working", message: "Not working" }) };
  if (state === "waiting_for_internet") return { status: "degraded", label: i18n._({ id: "Waiting for internet", message: "Waiting for internet" }) };
  return { status: "degraded", label: i18n._({ id: "Degraded", message: "Degraded" }) };
}

export function appStatusToSidebar(state: StatusAppState): "amber" | "red" | null {
  if (state === "down") return "red";
  if (state === "degraded" || state === "waiting_for_internet") return "amber";
  return null;
}

export function appStatusSentence(name: string, state: StatusAppState, reason: string | null): { ariaLabel: string; title: string } {
  const label = appStatusPresentation(state).label.toLocaleLowerCase();
  return { ariaLabel: `${name}: ${label}`, title: reason ?? (state === "operational" ? i18n._({ id: "{name} is working.", message: "{name} is working.", values: { name } }) : i18n._({ id: "{name} needs attention.", message: "{name} needs attention.", values: { name } })) };
}

export function appStatusMenuBadge(app: StatusApp): { badge: "amber" | "red"; level: "degraded" | "offline"; title: string; ariaLabel: string } | undefined {
  const badge = appStatusToSidebar(app.state);
  if (!badge) return undefined;
  return { badge, level: badge === "red" ? "offline" : "degraded", ...appStatusSentence(app.name, app.state, app.reason) };
}

export function sidebarItemStatus(apps: readonly StatusApp[], item: { name: string; url?: string }) {
  if (!Array.isArray(apps)) return undefined;
  const app = apps.find((candidate) => candidate.name.toLocaleLowerCase() === item.name.toLocaleLowerCase());
  return app ? appStatusMenuBadge(app) : undefined;
}

export function statusAppsSummary(apps: readonly { id?: string; name: string; state: StatusAppState; reason: string | null; paused?: boolean }[]) {
  const affected = apps.filter((app) => app.state !== "operational");
  if (!affected.length) return { level: "online" as const, text: i18n._({ id: "All good", message: "All good" }), problems: [], message: i18n._({ id: "Everything is running.", message: "Everything is running." }) };
  const level = affected.some((app) => app.state === "down") ? "offline" as const : "degraded" as const;
  const messages = affected.map((app) => app.reason).filter((reason): reason is string => Boolean(reason));
  const names = affected.map((app) => app.name);
  if (affected.length === 1 && affected[0] && isSearchLimitedChat(affected[0])) {
    return { level, text: pillText(affected, level), problems: names, message: i18n._({ id: "Chat is working, but search is limited right now.", message: "Chat is working, but search is limited right now." }) };
  }
  return { level, text: pillText(affected, level), problems: names, message: messages.join(" ") || i18n._({ id: "{names} need attention.", message: "{names} need attention.", values: { names: names.join(", ") } }) };
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
  if (only?.id === "chat" && only.state === "degraded" && only.paused) return i18n._({ id: "Chat paused", message: "Chat paused" });
  if (only?.id === "chat" && only.state === "down") return i18n._({ id: "Chat is down", message: "Chat is down" });
  return level === "offline" ? i18n._({ id: "Something is down", message: "Something is down" }) : i18n._({ id: "Degraded", message: "Degraded" });
}

function problemPriority(state: StatusAppNeed["state"]): number {
  if (state === "down") return 3;
  if (state === "waiting") return 2;
  if (state === "degraded") return 1;
  return 0;
}

const isSearchNeed = (need: StatusAppNeed): boolean => need.name === "Household web search";

function plainNeedName(need: StatusAppNeed): string {
  if (need.kind === "internet" || need.name.toLocaleLowerCase() === "internet") return i18n._({ id: "the internet", message: "the internet" });
  if (isSearchNeed(need)) return i18n._({ id: "search", message: "search" });
  return need.name;
}

function needProblemWords(need: StatusAppNeed): string {
  const name = plainNeedName(need);
  if (need.state === "waiting") return i18n._({ id: "the internet is having trouble", message: "the internet is having trouble" });
  if (need.kind === "engine") {
    if (need.state === "down") return i18n._({ id: "{name} isn't running", message: "{name} isn't running", values: { name } });
    if (need.state === "degraded") return i18n._({ id: "{name} is still starting", message: "{name} is still starting", values: { name } });
  }
  if (need.state === "down") return i18n._({ id: "{name} isn't reachable", message: "{name} isn't reachable", values: { name } });
  return i18n._({ id: "{name} is having trouble", message: "{name} is having trouble", values: { name } });
}

/** Summarizes known need state without counting services that have not been used recently. */
export function summarizeStatusApp(app: StatusApp, includeNeedNames = true): string {
  const needs = app.needs;
  if (!includeNeedNames || !needs) {
    if (app.state === "operational") return i18n._({ id: "All fine.", message: "All fine." });
    if (isSearchLimitedChat(app)) return i18n._({ id: "Chat is working, but search is limited right now.", message: "Chat is working, but search is limited right now." });
    return app.reason ?? i18n._({ id: "{name} needs attention.", message: "{name} needs attention.", values: { name: app.name } });
  }

  const problems = needs
    .filter((need) => need.state !== "operational" && need.state !== "unknown")
    .sort((a, b) => Number(b.required) - Number(a.required) || problemPriority(b.state) - problemPriority(a.state));
  const problem = problems[0];
  if (!problem) return needs.some((need) => need.state === "unknown") ? i18n._({ id: "No recent problems.", message: "No recent problems." }) : i18n._({ id: "All fine.", message: "All fine." });

  if (problem.state === "waiting") {
    return problem.required
      ? i18n._({ id: "{name} is waiting for the internet.", message: "{name} is waiting for the internet.", values: { name: app.name } })
      : i18n._({ id: "{name} is working, but the internet is having trouble.", message: "{name} is working, but the internet is having trouble.", values: { name: app.name } });
  }

  const cause = needProblemWords(problem);
  if (app.id === "chat" && !problem.required && isSearchNeed(problem)) {
    return i18n._({ id: "Chat is working, but search is limited right now.", message: "Chat is working, but search is limited right now." });
  }
  if (!problem.required) return i18n._({ id: "{name} is working, but {cause}.", message: "{name} is working, but {cause}.", values: { name: app.name, cause } });
  if (problem.state === "down") return i18n._({ id: "{name} isn't working: {cause}.", message: "{name} isn't working: {cause}.", values: { name: app.name, cause } });
  if (problem.kind === "engine") return i18n._({ id: "{name} is slow to start: {cause}.", message: "{name} is slow to start: {cause}.", values: { name: app.name, cause } });
  return i18n._({ id: "{name} is working slowly: {cause}.", message: "{name} is working slowly: {cause}.", values: { name: app.name, cause } });
}
