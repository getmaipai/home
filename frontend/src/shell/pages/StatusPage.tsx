import { useQuery } from "@tanstack/react-query";
import { Timeline } from "@maipai/ui/src/elements/timeline";
import { StatusComponents } from "@/shell/pages/status/StatusComponents";
import { StatusBanner } from "@/shell/pages/status/StatusBanner";
import { StatusIncident } from "@/shell/pages/status/StatusIncident";
import { api, isOwnerOrAdminRole, type HealthStatus, type Roster, type StatusHistory } from "@/lib/api";
import { statusSummary } from "@/shell/statusSummary";
import { useTabItem } from "@/shell/tabIdentity";
import { getIcon } from "@maipai/ui/src/icons";
import { StatusBoardNotes, StatusMaintenanceCard, STATUS_BOARD_QUERY_KEY } from "@/shell/pages/status/StatusBoard";
import { activeMaintenanceParts } from "@/shell/pages/status/statusBoardFormat";
import { StatusApps } from "@/shell/pages/status/StatusApps";
import { useStatusApps } from "@/shell/useStatusApps";
import { statusAppsSummary } from "@/shell/statusApps";
import { statusTimelineEvents } from "@/shell/pages/status/statusTimelineEvents";

export const StatusIcon = getIcon("activity");

export function StatusPage({ person }: { person: Roster }) {
  useTabItem("Status");
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
      <div className="flex flex-col gap-4">
      {boardData?.note || isOwnerOrAdminRole(person.role) ? <StatusBoardNotes person={person} note={boardData?.note ?? null} /> : null}
      <StatusBanner summary={summary} message={summary.message} maintenanceEndsAt={boardData?.maintenance.find((window) => window.status === "in_progress" && window.components.some((part) => maintenance.includes(part)))?.ends_at} />
      <StatusIncident level={summary.level} problems={summary.problems} history={historyQuery.data} appReason={appReason} />
      {appsQuery.data ? <StatusApps person={person} apps={apps} behindTheScenes={canSeeParts && healthQuery.data ? <StatusComponents person={person} health={healthQuery.data} maintenance={maintenance} history={historyQuery.data} /> : undefined} /> : null}
      </div>
      {canSeeParts && incidentEvents.length ? <><h3 className="mt-4 mb-2 text-sm font-semibold">Recent problems</h3><Timeline events={incidentEvents} visibleCount={incidentEvents.length} animate={false} /></> : null}
      {boardData || isOwnerOrAdminRole(person.role) ? <div className="mt-4"><StatusMaintenanceCard person={person} windows={boardData?.maintenance ?? []} /></div> : null}
    </>
  );
}
