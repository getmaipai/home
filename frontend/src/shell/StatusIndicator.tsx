import { useQuery } from "@tanstack/react-query";
import { Status, StatusIndicator as StatusDot } from "@maipai/ui/src/ui/status";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { STATUS_BOARD_QUERY_KEY } from "@/shell/pages/status/StatusBoard";
import { activeMaintenanceParts } from "@/shell/pages/status/statusBoardFormat";
import type { StatusBoard } from "@/lib/api";
import { useStatusApps } from "@/shell/useStatusApps";
import { statusAppsSummary } from "@/shell/statusApps";

// Reduced motion: the healthy dot's ping is decoration, so it stops too.
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `child`: while something is paused or down a child sees no pill
 * (CHAT-CALM-ERRORS-01d, design section 6): they cannot fix it, and in chat
 * their composer line is the one signal they get. */
/** The one status summary the header pill and the rail's profile menu
 * both read (RAIL-01): the apps summary, with maintenance shown when
 * everything else is online. */
export function useStatusSummary() {
  const board = useQuery<StatusBoard>({ queryKey: STATUS_BOARD_QUERY_KEY, queryFn: () => api.statusBoard(), refetchInterval: 30_000 });
  const underMaintenance = activeMaintenanceParts(Array.isArray(board.data?.maintenance) ? board.data.maintenance : undefined);
  const appsQuery = useStatusApps();
  const appsSummary = statusAppsSummary(Array.isArray(appsQuery.data) ? appsQuery.data : []);
  const summary = appsSummary.level === "online" && underMaintenance.length > 0
    ? { ...appsSummary, level: "maintenance" as const, text: "Maintenance" }
    : appsSummary;
  const title = appsSummary.level === "online" ? summary.text : appsSummary.message;
  return { summary, title };
}

export function StatusIndicator({ child = false }: { child?: boolean } = {}) {
  const { summary, title } = useStatusSummary();
  // No ping on a failure state (design section 4): a paused or down part is
  // shown, never animated.
  const ping = (summary.level === "online" || summary.level === "maintenance") && !prefersReducedMotion();
  if (child && (summary.level === "degraded" || summary.level === "offline")) return null;

  return (
    <Link
      to="/status"
      aria-label={summary.text}
      title={title}
      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Status status={summary.level} className="gap-1.5 px-2 py-1">
        <StatusDot status={summary.level} ping={ping} className="overflow-hidden" />
        <span className="hidden sm:inline">{summary.text}</span>
      </Status>
    </Link>
  );
}
