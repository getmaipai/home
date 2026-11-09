import { i18n } from "@lingui/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { Timeline } from "@maipai/ui/src/elements/timeline";
import { StatusLegend, StatusPartsBody } from "@/shell/pages/status/StatusComponents";
import { statusBannerCard } from "@/shell/pages/status/StatusBanner";
import { StatusIncidentBody, statusIncidentFacts } from "@/shell/pages/status/StatusIncident";
import { api, isOwnerOrAdminRole, type HealthStatus, type Roster, type StatusHistory } from "@/lib/api";
import { statusSummary } from "@/shell/statusSummary";
import { useTabItem } from "@/shell/tabIdentity";
import { getIcon } from "@maipai/ui/src/icons";
import { MaintenanceDialog, StatusBoardNotes, StatusMaintenanceBody, STATUS_BOARD_QUERY_KEY } from "@/shell/pages/status/StatusBoard";
import { activeMaintenanceParts } from "@/shell/pages/status/statusBoardFormat";
import { StatusApps } from "@/shell/pages/status/StatusApps";
import { agoText, groupWord } from "@/shell/pages/status/statusChecksFormat";
import { Button } from "@maipai/ui/src/ui/button";
import { useStatusApps } from "@/shell/useStatusApps";
import { statusAppsSummary } from "@/shell/statusApps";
import { statusTimelineEvents } from "@/shell/pages/status/statusTimelineEvents";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Status } from "@maipai/ui/src/ui/status";
import type { EngineComputerStatus as EngineComputerStatusData } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const engineComputerLabel = (state: EngineComputerStatusData["state"]): string => ({
  working: i18n._({ id: "Working", message: "Working" }), connecting: i18n._({ id: "Connecting", message: "Connecting" }), slow_to_answer: i18n._({ id: "Slow to answer", message: "Slow to answer" }), reconnecting: i18n._({ id: "Reconnecting", message: "Reconnecting" }), not_reachable: i18n._({ id: "Not reachable", message: "Not reachable" }),
})[state];

export const StatusIcon = getIcon("activity");

export function StatusPage({ person }: { person: Roster }) {
  useTabItem(i18n._({ id: "Status", message: "Status" }));
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
  const missingToursQuery = useQuery({ queryKey: ["status", "tour-missing-targets"], queryFn: api.missingTourTargets, enabled: canSeeParts, retry: false });
  const queryClient = useQueryClient();
  const checksQuery = useQuery({ queryKey: ["health-checks"], queryFn: () => api.healthChecks(), refetchInterval: 30_000, retry: false, enabled: canSeeParts });
  const runChecks = useMutation({ mutationFn: () => api.runHealthChecks(), onSuccess: (next) => queryClient.setQueryData(["health-checks"], next) });
  const checks = checksQuery.data && Array.isArray(checksQuery.data.groups) && Array.isArray(checksQuery.data.checks) ? checksQuery.data : undefined;
  const boardData = boardQuery.data && Array.isArray(boardQuery.data.maintenance) ? boardQuery.data : undefined;
  const maintenance = activeMaintenanceParts(boardData?.maintenance);
  const apps = appsQuery.data ?? [];
  const incidentEvents = statusTimelineEvents(historyQuery.data);
  const appSummary = statusAppsSummary(apps);
  const summary = appSummary.level === "online" && maintenance.length > 0
    ? { ...appSummary, level: "maintenance" as const, text: i18n._({ id: "Maintenance", message: "Maintenance" }), message: i18n._({ id: "Scheduled work is underway.", message: "Scheduled work is underway." }) }
    : appSummary;
  const appReason = appSummary.level === "online" ? undefined : appSummary.message;
  const incident = statusIncidentFacts({ level: summary.level, problems: summary.problems, history: historyQuery.data, appReason });
  const AlertIcon = getIcon("alert-triangle");
  const admin = isOwnerOrAdminRole(person.role);

  const overallStatus = <StatusCard {...statusBannerCard({ summary, message: summary.message, maintenanceEndsAt: boardData?.maintenance.find((window) => window.status === "in_progress" && window.components.some((part) => maintenance.includes(part)))?.ends_at })} />;

  return (
    <>
      <div className="flex flex-col gap-4">
      {boardData?.note || isOwnerOrAdminRole(person.role) ? <StatusBoardNotes person={person} note={boardData?.note ?? null} /> : null}
      {overallStatus}
      {engineComputerQuery.data?.configured ? <Card data-engine-computer-status>
        <CardHeader><CardTitle>{i18n._({ id: "Engine computer", message: "Engine computer" })}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{i18n._({ id: "Engine computer: {state}", message: "Engine computer: {state}", values: { state: engineComputerLabel(engineComputerQuery.data.state) } })}</span><Status status={engineComputerQuery.data.state === "working" ? "online" : engineComputerQuery.data.state === "not_reachable" ? "offline" : "degraded"}>{engineComputerLabel(engineComputerQuery.data.state)}</Status></div>
          {engineComputerQuery.data.reason ? <p className="mt-2 text-sm text-muted-foreground">{engineComputerQuery.data.reason}</p> : null}
          {canSeeParts && engineComputerQuery.data.details ? <dl className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            <div><dt className="inline font-medium">{i18n._({ id: "Path:", message: "Path:" })} </dt><dd className="inline">{engineComputerQuery.data.details.path === "tailnet" ? i18n._({ id: "Through your Tailscale network", message: "Through your Tailscale network" }) : engineComputerQuery.data.details.path === "home" ? i18n._({ id: "Through your home network", message: "Through your home network" }) : i18n._({ id: "Not connected yet", message: "Not connected yet" })}</dd></div>
            <div><dt className="inline font-medium">{i18n._({ id: "Last probe:", message: "Last probe:" })} </dt><dd className="inline">{engineComputerQuery.data.details.lastProbeAt ? formatDateTime(engineComputerQuery.data.details.lastProbeAt) : i18n._({ id: "No successful probe yet", message: "No successful probe yet" })}</dd></div>
            <div><dt className="inline font-medium">{i18n._({ id: "Stack contract:", message: "Stack contract:" })} </dt><dd className="inline">{engineComputerQuery.data.details.contract ?? i18n._({ id: "Not reported", message: "Not reported" })}</dd></div>
          </dl> : null}
        </CardContent>
      </Card> : null}
      {canSeeParts && checks ? <Card data-testid="health-checks">
        <CardHeader><CardTitle>{i18n._({ id: "Health checks", message: "Health checks" })}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm">{agoText(checks.last_checked_at)}: {checks.groups.map((g) => g.label).join(", ")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {checks.groups.map((g) => <Status key={g.group} status={g.state === "fail" ? "offline" : g.state === "pass" ? "online" : "maintenance"}>{g.label}: {groupWord(g.state)}</Status>)}
          </div>
          <ul className="mt-3 flex flex-col divide-y divide-border text-supporting text-muted-foreground">
            {checks.checks.filter((c) => c.state === "fail" || c.state === "skipped").map((c) => <li key={c.id} className="py-2">{c.name}: {c.note}</li>)}
          </ul>
          {runChecks.error instanceof Error ? <p role="alert" className="mt-2 text-sm text-destructive">{i18n._({ id: "The health checks could not be run. Try again.", message: "The health checks could not be run. Try again." })}</p> : null}
          <div className="mt-3"><Button variant="outline" disabled={runChecks.isPending || checks.running} onClick={() => runChecks.mutate()}>{runChecks.isPending || checks.running ? i18n._({ id: "Checking...", message: "Checking..." }) : i18n._({ id: "Run checks now", message: "Run checks now" })}</Button></div>
        </CardContent>
      </Card> : null}
      {incident ? <Card>
        <CardHeader><CardTitle><AlertIcon className={`mr-2 inline size-5 ${incident.amber ? "text-attention-fg" : "text-destructive"}`} aria-hidden="true" />{incident.title}</CardTitle></CardHeader>
        <CardContent><StatusIncidentBody facts={incident} /></CardContent>
      </Card> : null}
      {canSeeParts && (missingToursQuery.data?.length ?? 0) > 0 ? <Card>
        <CardHeader><CardTitle>{i18n._({ id: "Tour targets not found", message: "Tour targets not found" })}</CardTitle></CardHeader>
        <CardContent><ul className="flex flex-col gap-1 text-sm">{missingToursQuery.data!.map(({ key, count }) => <li key={key}>{key}: {count}</li>)}</ul></CardContent>
      </Card> : null}
      {appsQuery.data ? <StatusApps person={person} apps={apps} behindTheScenes={canSeeParts && healthQuery.data ? <Card>
        <CardHeader><CardTitle>{i18n._({ id: "Parts", message: "Parts" })}</CardTitle><StatusLegend /></CardHeader>
        <CardContent><div className="flex flex-col divide-y divide-border"><StatusPartsBody person={person} health={healthQuery.data} maintenance={maintenance} history={historyQuery.data} engineComputer={engineComputerQuery.data} /></div></CardContent>
      </Card> : undefined} /> : null}
      </div>
      {canSeeParts && historyQuery.data?.chat_pauses ? <p data-testid="chat-pauses" className="mt-4 text-sm text-muted-foreground">{historyQuery.data.chat_pauses.line}</p> : null}
      {canSeeParts && historyQuery.data?.engine_crashes ? <p data-testid="engine-crashes" className="mt-1 text-sm text-muted-foreground">{historyQuery.data.engine_crashes.line}</p> : null}
      {canSeeParts && incidentEvents.length ? <><h3 className="mt-4 mb-2 text-sm font-semibold">{i18n._({ id: "Recent problems", message: "Recent problems" })}</h3><Timeline events={incidentEvents} visibleCount={incidentEvents.length} animate={false} /></> : null}
      {(boardData?.maintenance.length ?? 0) > 0 || admin ? <div className="mt-4"><Card>
        <CardHeader><CardTitle>{i18n._({ id: "Scheduled maintenance", message: "Scheduled maintenance" })}</CardTitle></CardHeader>
        <CardContent><div className="flex flex-col gap-3">{admin ? <div className="flex justify-end"><MaintenanceDialog /></div> : null}<StatusMaintenanceBody admin={admin} windows={boardData?.maintenance ?? []} /></div></CardContent>
      </Card></div> : null}
    </>
  );
}
