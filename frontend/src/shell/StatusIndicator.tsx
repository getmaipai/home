import { useQuery } from "@tanstack/react-query";
import { Status, StatusIndicator as StatusDot } from "@maipai/ui/src/ui/status";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { STATUS_BOARD_QUERY_KEY } from "@/next/pages/status/StatusBoard";
import { activeMaintenanceParts } from "@/next/pages/status/statusBoardFormat";
import type { StatusBoard } from "@/lib/api";
import { useStatusApps } from "@/shell/useStatusApps";
import { statusAppsSummary } from "@/shell/statusApps";

export function StatusIndicator() {
  const board = useQuery<StatusBoard>({ queryKey: STATUS_BOARD_QUERY_KEY, queryFn: () => api.statusBoard(), refetchInterval: 30_000 });
  const underMaintenance = activeMaintenanceParts(Array.isArray(board.data?.maintenance) ? board.data.maintenance : undefined);
  const appsQuery = useStatusApps();
  const appsSummary = statusAppsSummary(appsQuery.data ?? []);
  const summary = appsSummary.level === "online" && underMaintenance.length > 0
    ? { ...appsSummary, level: "maintenance" as const, text: "Maintenance" }
    : appsSummary;
  const title = appsSummary.level === "online" ? summary.text : appsSummary.message;

  return (
    <Link
      to="/status"
      aria-label={summary.text}
      title={title}
      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Status status={summary.level} className="gap-1.5 px-2 py-1">
        <StatusDot status={summary.level} className="overflow-hidden" />
        <span className="hidden sm:inline">{summary.text}</span>
      </Status>
    </Link>
  );
}
