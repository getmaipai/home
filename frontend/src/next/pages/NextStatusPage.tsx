import { useQuery } from "@tanstack/react-query";
import { Timeline } from "@maipai/ui/src/elements/timeline";
import { StatusComponents } from "@/next/pages/status/StatusComponents";
import { StatusBanner } from "@/next/pages/status/StatusBanner";
import { StatusIncident } from "@/next/pages/status/StatusIncident";
import { api, isOwnerOrAdminRole, type HealthStatus, type Roster, type StatusHistory } from "@/lib/api";
import { statusSummary } from "@/shell/statusSummary";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { getIcon } from "@maipai/ui/src/icons";
import { StatusBoardNotes, StatusMaintenanceCard, STATUS_BOARD_QUERY_KEY } from "@/next/pages/status/StatusBoard";
import { activeMaintenanceParts } from "@/next/pages/status/statusBoardFormat";
import { StatusApps } from "@/next/pages/status/StatusApps";
import { useStatusApps } from "@/shell/useStatusApps";
import { statusAppsSummary } from "@/shell/statusApps";
import { statusTimelineEvents } from "@/next/pages/status/statusTimelineEvents";

export const StatusIcon = getIcon("activity");

export function NextStatusPage({ person }: { person: Roster }) {
  useDocumentTitle("Status");
  const canSeeParts = isOwnerOrAdminRole(person.role);
  const appsQuery = useStatusApps();
  const healthQuery = useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.health(),
    retry: false,
    refetchInterval: (current) => statusSummary(current.state.data).level === "online" ? 15_000 : 5_000,
    enabled: canSeeParts,
  });
  const boardQuery = useQuery({ queryKey: STATUS_BOARD_QUERY_KEY, queryFn: () => api.statusBoard(), refetchInterval: 30_000 });
  const historyQuery = useQuery<StatusHistory>({ queryKey: ["status-history", 90], queryFn: () => api.statusHistory(90), refetchInterval: 60_000, retry: false, enabled: canSeeParts });
  const boardData = boardQuery.data && Array.isArray(boardQuery.data.maintenance) ? boardQuery.data : undefined;
  const maintenance = activeMaintenanceParts(boardData?.maintenance);
  const apps = appsQuery.data ?? [];
  const incidentEvents = statusTimelineEvents(historyQuery.data);
  const appSummary = statusAppsSummary(apps);
  const summary = appSummary.level === "online" && maintenance.length > 0
    ? { ...appSummary, level: "maintenance" as const, text: "Maintenance", message: "Scheduled work is underway." }
    : appSummary;
  const appReason = appSummary.level === "online" ? undefined : appSummary.message;

  return (
    <>
      {boardData?.note || isOwnerOrAdminRole(person.role) ? <StatusBoardNotes person={person} note={boardData?.note ?? null} /> : null}
      <StatusBanner summary={summary} message={summary.message} maintenanceEndsAt={boardData?.maintenance.find((window) => window.status === "in_progress" && window.components.some((part) => maintenance.includes(part)))?.ends_at} />
      <StatusIncident level={summary.level} problems={summary.problems} history={historyQuery.data} appReason={appReason} />
      {appsQuery.data ? <StatusApps person={person} apps={apps} behindTheScenes={canSeeParts && healthQuery.data ? <><StatusComponents person={person} health={healthQuery.data} maintenance={maintenance} history={historyQuery.data} />{incidentEvents.length ? <><h3 className="text-sm font-semibold">Recent problems</h3><Timeline events={incidentEvents} visibleCount={incidentEvents.length} /></> : null}</> : undefined} /> : null}
      {boardData || isOwnerOrAdminRole(person.role) ? <StatusMaintenanceCard person={person} windows={boardData?.maintenance ?? []} /> : null}
    </>
  );
}
