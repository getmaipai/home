import { useQuery } from "@tanstack/react-query";
import { StatusComponents } from "@/next/pages/status/StatusComponents";
import { StatusBanner } from "@/next/pages/status/StatusBanner";
import { RecentProblems, StatusIncident } from "@/next/pages/status/StatusIncident";
import { api, isOwnerOrAdminRole, type HealthStatus, type Roster, type StatusHistory } from "@/lib/api";
import { statusSummary } from "@/shell/statusSummary";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { getIcon } from "@maipai/ui/src/icons";
import { StatusBoardNotes, StatusMaintenanceCard, STATUS_BOARD_QUERY_KEY } from "@/next/pages/status/StatusBoard";
import { activeMaintenanceParts } from "@/next/pages/status/statusBoardFormat";

export const StatusIcon = getIcon("activity");

export function NextStatusPage({ person }: { person: Roster }) {
  useDocumentTitle("Status");
  const query = useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.health(),
    retry: false,
    refetchInterval: (current) => statusSummary(current.state.data).level === "online" ? 15_000 : 5_000,
  });
  const boardQuery = useQuery({ queryKey: STATUS_BOARD_QUERY_KEY, queryFn: () => api.statusBoard(), refetchInterval: 30_000 });
  const historyQuery = useQuery<StatusHistory>({ queryKey: ["status-history", 90], queryFn: () => api.statusHistory(90), refetchInterval: 60_000, retry: false });
  const boardData = boardQuery.data && Array.isArray(boardQuery.data.maintenance) ? boardQuery.data : undefined;
  const maintenance = activeMaintenanceParts(boardData?.maintenance);
  const summary = statusSummary(query.data, maintenance);

  return (
    <div className="flex flex-col gap-4">
      {boardData?.note || isOwnerOrAdminRole(person.role) ? <StatusBoardNotes person={person} note={boardData?.note ?? null} /> : null}
      <StatusBanner summary={summary} uptimeSeconds={summary.level === "online" ? query.data?.uptimeSeconds : undefined} maintenanceEndsAt={boardData?.maintenance.find((window) => window.status === "in_progress" && window.components.some((part) => maintenance.includes(part)))?.ends_at} />
      <StatusIncident level={summary.level} problems={summary.problems} history={historyQuery.data} />
      {boardData || isOwnerOrAdminRole(person.role) ? <StatusMaintenanceCard person={person} windows={boardData?.maintenance ?? []} /> : null}
      {query.data ? <StatusComponents person={person} health={query.data} maintenance={maintenance} history={historyQuery.data} /> : null}
      <RecentProblems history={historyQuery.data} />
    </div>
  );
}
