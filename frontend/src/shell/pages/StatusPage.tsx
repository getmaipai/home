import { useQuery } from "@tanstack/react-query";
import { Timeline } from "@maipai/ui/src/elements/timeline";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Status } from "@maipai/ui/src/ui/status";
import { StatusComponents } from "@/shell/pages/status/StatusComponents";
import { StatusBanner } from "@/shell/pages/status/StatusBanner";
import { StatusIncident } from "@/shell/pages/status/StatusIncident";
import { api, isOwnerOrAdminRole, type HealthStatus, type ProtectionCheckState, type ProtectionStatus, type Roster, type StatusHistory } from "@/lib/api";
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
  const protectionQuery = useQuery<ProtectionStatus>({ queryKey: ["status-protection"], queryFn: () => api.protectionStatus(), retry: false, enabled: canSeeParts });
  const boardData = boardQuery.data && Array.isArray(boardQuery.data.maintenance) ? boardQuery.data : undefined;
  const maintenance = activeMaintenanceParts(boardData?.maintenance);
  const apps = appsQuery.data ?? [];
  const incidentEvents = statusTimelineEvents(historyQuery.data);
  const appSummary = statusAppsSummary(apps);
  const summary = appSummary.level === "online" && maintenance.length > 0
    ? { ...appSummary, level: "maintenance" as const, text: "Maintenance", message: "Scheduled work is underway." }
    : appSummary;
  const appReason = appSummary.level === "online" ? undefined : appSummary.message;
  const checkLabel = (state: ProtectionCheckState) => state === "on" ? "On" : state === "off" ? "Off" : "Not checked";
  const checkTone = (state: ProtectionCheckState): "online" | "offline" | "degraded" => state === "on" ? "online" : state === "off" ? "offline" : "degraded";

  return (
    <>
      <div className="flex flex-col gap-4">
      {boardData?.note || isOwnerOrAdminRole(person.role) ? <StatusBoardNotes person={person} note={boardData?.note ?? null} /> : null}
      <StatusBanner summary={summary} message={summary.message} maintenanceEndsAt={boardData?.maintenance.find((window) => window.status === "in_progress" && window.components.some((part) => maintenance.includes(part)))?.ends_at} />
      <StatusIncident level={summary.level} problems={summary.problems} history={historyQuery.data} appReason={appReason} />
      {appsQuery.data ? <StatusApps person={person} apps={apps} behindTheScenes={canSeeParts && healthQuery.data ? <StatusComponents person={person} health={healthQuery.data} maintenance={maintenance} history={historyQuery.data} /> : undefined} /> : null}
      {canSeeParts ? <Card>
        <CardHeader><CardTitle>Protection on this hub</CardTitle></CardHeader>
        <CardContent>
          <AsyncState data={protectionQuery.data} error={protectionQuery.isError} isFetching={protectionQuery.isFetching} onRetry={() => protectionQuery.refetch()} errorMessage="Could not read the protection checks." loadingLabel="Loading protection checks">
            {(loaded: ProtectionStatus) => <ItemGroup variant="card">
              <Item size="setting"><ItemContent><ItemTitle>Disk encryption</ItemTitle><ItemDescription>{loaded.diskEncryption === "on" ? "Protects stored files when this computer is off." : loaded.diskEncryption === "off" ? "Turn on disk encryption in this computer's security settings." : "This computer's encryption state could not be checked."}</ItemDescription></ItemContent><ItemActions><Status status={checkTone(loaded.diskEncryption)}>{checkLabel(loaded.diskEncryption)}</Status></ItemActions></Item>
              <Item size="setting"><ItemContent><ItemTitle>Swap protection</ItemTitle><ItemDescription>{loaded.swapEncryption === "on" ? "Swap is encrypted or disabled." : loaded.swapEncryption === "off" ? "Swap is not encrypted." : "This computer's swap protection could not be checked."}</ItemDescription></ItemContent><ItemActions><Status status={checkTone(loaded.swapEncryption)}>{checkLabel(loaded.swapEncryption)}</Status></ItemActions></Item>
              <Item size="setting"><ItemContent><ItemTitle>Current connection</ItemTitle><ItemDescription>{loaded.https ? "This page is using HTTPS." : "This connection is not encrypted."}</ItemDescription></ItemContent><ItemActions><Status status={loaded.https ? "online" : "offline"}>{loaded.https ? "On" : "Off"}</Status></ItemActions></Item>
              <Item size="setting"><ItemContent><ItemTitle>Data folder access</ItemTitle><ItemDescription>{loaded.dataDirectoryOwnerOnly === "on" ? "Only the account running the hub can read this folder." : loaded.dataDirectoryOwnerOnly === "off" ? "Other local accounts may be able to read these files." : "This folder's permissions could not be checked."}</ItemDescription></ItemContent><ItemActions><Status status={checkTone(loaded.dataDirectoryOwnerOnly)}>{checkLabel(loaded.dataDirectoryOwnerOnly)}</Status></ItemActions></Item>
              <Item size="setting"><ItemContent><ItemTitle>File-backed key in the data folder</ItemTitle><ItemDescription>{loaded.keyFileInsideData ? "A key file is inside the data folder." : "No file-backed key was found inside the data folder."}</ItemDescription></ItemContent><ItemActions><Status status={loaded.keyFileInsideData ? "offline" : "online"}>{loaded.keyFileInsideData ? "Found" : "Not found"}</Status></ItemActions></Item>
              <Item size="setting"><ItemContent><ItemTitle>Profiles without a passcode</ItemTitle><ItemDescription>{loaded.profilesWithoutPasscode === 0 ? "Every profile has a passcode." : `${loaded.profilesWithoutPasscode} profile${loaded.profilesWithoutPasscode === 1 ? " has" : "s have"} no passcode.`}</ItemDescription></ItemContent><ItemActions><Status status={loaded.profilesWithoutPasscode === 0 ? "online" : "offline"}>{loaded.profilesWithoutPasscode}</Status></ItemActions></Item>
              <Item size="setting"><ItemContent><ItemTitle>Minimum passcode length</ItemTitle><ItemDescription>Sign-in secrets need at least {loaded.minimumPasscodeLength} characters.</ItemDescription></ItemContent><ItemActions><span className="text-sm text-muted-foreground">{loaded.minimumPasscodeLength} characters</span></ItemActions></Item>
            </ItemGroup>}
          </AsyncState>
        </CardContent>
      </Card> : null}
      </div>
      {canSeeParts && incidentEvents.length ? <><h3 className="mt-4 mb-2 text-sm font-semibold">Recent problems</h3><Timeline events={incidentEvents} visibleCount={incidentEvents.length} animate={false} /></> : null}
      {boardData || isOwnerOrAdminRole(person.role) ? <div className="mt-4"><StatusMaintenanceCard person={person} windows={boardData?.maintenance ?? []} /></div> : null}
    </>
  );
}
