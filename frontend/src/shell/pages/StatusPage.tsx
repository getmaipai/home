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
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Status } from "@maipai/ui/src/ui/status";
import type { EngineComputerStatus as EngineComputerStatusData } from "@/lib/api";

const ENGINE_COMPUTER_LABEL: Record<EngineComputerStatusData["state"], string> = {
  working: "Working", connecting: "Connecting", slow_to_answer: "Slow to answer", reconnecting: "Reconnecting", not_reachable: "Not reachable",
};

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
  const engineComputerQuery = useQuery({ queryKey: ["status", "engine-computer", canSeeParts ? "admin" : "member"], queryFn: api.engineComputerStatus, refetchInterval: 10_000 });
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
      {engineComputerQuery.data?.configured ? <Card data-engine-computer-status>
        <CardHeader><CardTitle>Engine computer</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">Engine computer: {ENGINE_COMPUTER_LABEL[engineComputerQuery.data.state]}</span><Status status={engineComputerQuery.data.state === "working" ? "online" : engineComputerQuery.data.state === "not_reachable" ? "offline" : "degraded"}>{ENGINE_COMPUTER_LABEL[engineComputerQuery.data.state]}</Status></div>
          {engineComputerQuery.data.reason ? <p className="mt-2 text-sm text-muted-foreground">{engineComputerQuery.data.reason}</p> : null}
          {canSeeParts && engineComputerQuery.data.details ? <dl className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            <div><dt className="inline font-medium">Path: </dt><dd className="inline">{engineComputerQuery.data.details.path === "tailnet" ? "Through your Tailscale network" : engineComputerQuery.data.details.path === "home" ? "Through your home network" : "Not connected yet"}</dd></div>
            <div><dt className="inline font-medium">Last probe: </dt><dd className="inline">{engineComputerQuery.data.details.lastProbeAt ? new Date(engineComputerQuery.data.details.lastProbeAt).toLocaleString() : "No successful probe yet"}</dd></div>
            <div><dt className="inline font-medium">Stack contract: </dt><dd className="inline">{engineComputerQuery.data.details.contract ?? "Not reported"}</dd></div>
          </dl> : null}
        </CardContent>
      </Card> : null}
      <StatusIncident level={summary.level} problems={summary.problems} history={historyQuery.data} appReason={appReason} />
      {appsQuery.data ? <StatusApps person={person} apps={apps} behindTheScenes={canSeeParts && healthQuery.data ? <StatusComponents person={person} health={healthQuery.data} maintenance={maintenance} history={historyQuery.data} engineComputer={engineComputerQuery.data} /> : undefined} /> : null}
      </div>
      {canSeeParts && incidentEvents.length ? <><h3 className="mt-4 mb-2 text-sm font-semibold">Recent problems</h3><Timeline events={incidentEvents} visibleCount={incidentEvents.length} animate={false} /></> : null}
      {boardData || isOwnerOrAdminRole(person.role) ? <div className="mt-4"><StatusMaintenanceCard person={person} windows={boardData?.maintenance ?? []} /></div> : null}
    </>
  );
}
