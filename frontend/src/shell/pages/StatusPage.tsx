import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Timeline } from "@maipai/ui/src/elements/timeline";
import { StatusLegend, StatusPartsBody } from "@/shell/pages/status/StatusComponents";
import { StatusBanner } from "@/shell/pages/status/StatusBanner";
import { StatusIncidentBody, statusIncidentFacts } from "@/shell/pages/status/StatusIncident";
import { api, isOwnerOrAdminRole, type HealthStatus, type Roster, type StatusHistory } from "@/lib/api";
import { statusSummary } from "@/shell/statusSummary";
import { useTabItem } from "@/shell/tabIdentity";
import { getIcon } from "@maipai/ui/src/icons";
import { MaintenanceDialog, StatusBoardNotes, StatusMaintenanceBody, STATUS_BOARD_QUERY_KEY } from "@/shell/pages/status/StatusBoard";
import { activeMaintenanceParts } from "@/shell/pages/status/statusBoardFormat";
import { StatusApps } from "@/shell/pages/status/StatusApps";
import { agoText, GROUP_WORD } from "@/shell/pages/status/statusChecksFormat";
import { Button } from "@maipai/ui/src/ui/button";
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
    ? { ...appSummary, level: "maintenance" as const, text: "Maintenance", message: "Scheduled work is underway." }
    : appSummary;
  const appReason = appSummary.level === "online" ? undefined : appSummary.message;
  const incident = statusIncidentFacts({ level: summary.level, problems: summary.problems, history: historyQuery.data, appReason });
  const AlertIcon = getIcon("alert-triangle");
  const admin = isOwnerOrAdminRole(person.role);

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
      {canSeeParts && checks ? <Card data-testid="health-checks">
        <CardHeader><CardTitle>Health checks</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm">{agoText(checks.last_checked_at)}: {checks.groups.map((g) => g.label).join(", ")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {checks.groups.map((g) => <Status key={g.group} status={g.state === "fail" ? "offline" : g.state === "pass" ? "online" : "maintenance"}>{g.label}: {GROUP_WORD[g.state]}</Status>)}
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            {checks.checks.filter((c) => c.state === "fail" || c.state === "skipped").map((c) => <li key={c.id}>{c.name}: {c.note}</li>)}
          </ul>
          {runChecks.error instanceof Error ? <p role="alert" className="mt-2 text-sm text-destructive">{runChecks.error.message}</p> : null}
          <div className="mt-3"><Button variant="outline" disabled={runChecks.isPending || checks.running} onClick={() => runChecks.mutate()}>{runChecks.isPending || checks.running ? "Checking..." : "Run checks now"}</Button></div>
        </CardContent>
      </Card> : null}
      {incident ? <Card>
        <CardHeader><CardTitle><AlertIcon className={`mr-2 inline size-5 ${incident.amber ? "text-attention-fg" : "text-destructive"}`} aria-hidden="true" />{incident.title}</CardTitle></CardHeader>
        <CardContent><StatusIncidentBody facts={incident} /></CardContent>
      </Card> : null}
      {canSeeParts && (missingToursQuery.data?.length ?? 0) > 0 ? <Card>
        <CardHeader><CardTitle>Tour targets not found</CardTitle></CardHeader>
        <CardContent><ul className="flex flex-col gap-1 text-sm">{missingToursQuery.data!.map(({ key, count }) => <li key={key}>{key}: {count}</li>)}</ul></CardContent>
      </Card> : null}
      {appsQuery.data ? <StatusApps person={person} apps={apps} behindTheScenes={canSeeParts && healthQuery.data ? <Card>
        <CardHeader><CardTitle>Parts</CardTitle><StatusLegend /></CardHeader>
        <CardContent><div className="flex flex-col divide-y divide-border"><StatusPartsBody person={person} health={healthQuery.data} maintenance={maintenance} history={historyQuery.data} engineComputer={engineComputerQuery.data} /></div></CardContent>
      </Card> : undefined} /> : null}
      </div>
      {canSeeParts && historyQuery.data?.chat_pauses ? <p data-testid="chat-pauses" className="mt-4 text-sm text-muted-foreground">{historyQuery.data.chat_pauses.line}</p> : null}
      {canSeeParts && historyQuery.data?.engine_crashes ? <p data-testid="engine-crashes" className="mt-1 text-sm text-muted-foreground">{historyQuery.data.engine_crashes.line}</p> : null}
      {canSeeParts && incidentEvents.length ? <><h3 className="mt-4 mb-2 text-sm font-semibold">Recent problems</h3><Timeline events={incidentEvents} visibleCount={incidentEvents.length} animate={false} /></> : null}
      {(boardData?.maintenance.length ?? 0) > 0 || admin ? <div className="mt-4"><Card>
        <CardHeader><CardTitle>Scheduled maintenance</CardTitle></CardHeader>
        <CardContent><div className="flex flex-col gap-3">{admin ? <div className="flex justify-end"><MaintenanceDialog /></div> : null}<StatusMaintenanceBody admin={admin} windows={boardData?.maintenance ?? []} /></div></CardContent>
      </Card></div> : null}
    </>
  );
}
