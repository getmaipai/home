import type { StatusAppState } from "@/lib/api";
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
