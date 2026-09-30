import { useQuery } from "@tanstack/react-query";
import { OverallBanner, StatusComponents } from "@/next/pages/status/StatusComponents";
import { api, isOwnerOrAdminRole, type HealthStatus, type Roster } from "@/lib/api";
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
  const boardData = boardQuery.data && Array.isArray(boardQuery.data.maintenance) ? boardQuery.data : undefined;
  const maintenance = activeMaintenanceParts(boardData?.maintenance);
  const summary = statusSummary(query.data, maintenance);

  return (
    <div className="flex flex-col gap-4">
      {boardData?.note || isOwnerOrAdminRole(person.role) ? <StatusBoardNotes person={person} note={boardData?.note ?? null} /> : null}
      <OverallBanner summary={summary} health={query.data} />
      {boardData || isOwnerOrAdminRole(person.role) ? <StatusMaintenanceCard person={person} windows={boardData?.maintenance ?? []} /> : null}
      {query.data ? <StatusComponents person={person} health={query.data} maintenance={maintenance} /> : null}
    </div>
  );
}
