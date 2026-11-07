import { i18n } from "@lingui/core";
import { useState } from "react";
import { formatBytes } from "@maipai/ui/src/format";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Status } from "@maipai/ui/src/ui/status";
import { UptimeStrip } from "@maipai/ui/src/ui/uptime-strip";
import { TooltipIconButton } from "@maipai/ui/src/elements/tooltip-icon-button";
import { getIcon } from "@maipai/ui/src/icons";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { toast } from "sonner";
import { api, isOwnerOrAdminRole, request, type EngineComputerStatus as EngineComputerStatusData, type HealthStatus, type Roster, type EngineHealthEntry, type StatusHistory } from "@/lib/api";
import { dayData, statusStripSummary } from "@/shell/pages/status/statusHistoryFormat";
import "@/shell/pages/status/statusLegend.css";
import { errorLine } from "@/lib/hubReachability";

interface StatusPartsProps { person: Roster; health: HealthStatus; maintenance?: string[]; history?: StatusHistory; engineComputer?: EngineComputerStatusData; }
// The Status page lists the four engines that make up "is Home up"; the picture and video rows (ENGINE-STATUS-MEDIA-01) are read by the making controls instead.
type EngineKey = "chat" | "embed" | "background" | "voice";
type StatusPartId = EngineKey | "library" | "hub";
type EngineState = { label: string; status: "online" | "offline" | "degraded" };

// One shared definition for component names, purpose and row icons.
export const engineRows = (): Array<{ key: StatusPartId; label: string; hint: string; icon: string }> => [
  { key: "chat", label: i18n._({ id: "Brain", message: "Brain" }), hint: i18n._({ id: "Answers your conversations.", message: "Answers your conversations." }), icon: "brain" },
  { key: "embed", label: i18n._({ id: "Understanding", message: "Understanding" }), hint: i18n._({ id: "Matches what you say to skills and memories.", message: "Matches what you say to skills and memories." }), icon: "sparkles" },
  { key: "background", label: i18n._({ id: "Memory", message: "Memory" }), hint: i18n._({ id: "Remembers and organizes what matters.", message: "Remembers and organizes what matters." }), icon: "circuit-board" },
  { key: "voice", label: i18n._({ id: "Voice", message: "Voice" }), hint: i18n._({ id: "Speaks the replies.", message: "Speaks the replies." }), icon: "audio-waveform" },
  { key: "library", label: i18n._({ id: "Library", message: "Library" }), hint: i18n._({ id: "Offline reference library.", message: "Offline reference library." }), icon: "archive" },
  { key: "hub", label: i18n._({ id: "Home", message: "Home" }), hint: i18n._({ id: "This MaiPai Home itself.", message: "This MaiPai Home itself." }), icon: "home" },
];

const engineHealthRows = () => engineRows().filter((row): row is ReturnType<typeof engineRows>[number] & { key: EngineKey } => row.key !== "library" && row.key !== "hub");

export function engineState(engine: EngineHealthEntry): EngineState {
  if (engine.kind === "stub") return { label: i18n._({ id: "Demo mode", message: "Demo mode" }), status: "degraded" };
  if (engine.kind === "blocked") return { label: i18n._({ id: "Blocked", message: "Blocked" }), status: "offline" };
  if (engine.alive === true) return { label: i18n._({ id: "Running", message: "Running" }), status: "online" };
  if (engine.alive === false) return { label: i18n._({ id: "Not running", message: "Not running" }), status: "offline" };
  if (engine.kind === "restarting") return { label: i18n._({ id: "Restarting", message: "Restarting" }), status: "degraded" };
  if (engine.kind === "failed" || engine.kind === "stalled") return { label: i18n._({ id: "Not running", message: "Not running" }), status: "offline" };
  if (engine.kind === "starting") return { label: i18n._({ id: "Starting", message: "Starting" }), status: "degraded" };
  if (engine.kind === "stopped" || engine.kind === "none") return { label: i18n._({ id: "Stopped", message: "Stopped" }), status: "offline" };
  return { label: i18n._({ id: "Starting", message: "Starting" }), status: "degraded" };
}

/** A part with a Stop button: running, or in demo mode. Compared by the translated label the row shows. */
const isRunningState = (state: { label: string }): boolean => state.label === i18n._({ id: "Running", message: "Running" }) || state.label === i18n._({ id: "Demo mode", message: "Demo mode" });

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const dayText = (n: number) => i18n._({ id: "{n, plural, one {# day} other {# days}}", message: "{n, plural, one {# day} other {# days}}", values: { n } });
  const hourText = (n: number) => i18n._({ id: "{n, plural, one {# hour} other {# hours}}", message: "{n, plural, one {# hour} other {# hours}}", values: { n } });
  const minuteText = (n: number) => i18n._({ id: "{n, plural, one {# minute} other {# minutes}}", message: "{n, plural, one {# minute} other {# minutes}}", values: { n } });
  if (days > 0) return hours ? `${dayText(days)} ${hourText(hours)}` : dayText(days);
  if (hours > 0) return minutes ? `${hourText(hours)} ${minuteText(minutes)}` : hourText(hours);
  return minuteText(Math.max(minutes, 1));
}

const HEALTH_QUERY_KEY = ["health"];
const gb = (bytes: number) => (formatBytes(bytes), (bytes / 1024 ** 3).toFixed(1));

/** The "Last 90 days" key under the Parts title. */
export function StatusLegend() {
  return <>{/* deliberate type-floor exception: compact status legend */}<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="mr-1">{i18n._({ id: "Last 90 days", message: "Last 90 days" })}</span>{([["fine", i18n._({ id: "Fine", message: "Fine" })], ["slow", i18n._({ id: "Slow", message: "Slow" })], ["down", i18n._({ id: "Down", message: "Down" })], ["maintenance", i18n._({ id: "Maintenance", message: "Maintenance" })]] as const).map(([status, label]) => <span key={status} className="inline-flex items-center gap-1.5"><span aria-hidden="true" data-status-legend={status} className="size-2 rounded-sm" />{label}</span>)}</div></>;
}

/** The rows inside the page's "Parts" card (the page supplies the divided column): data, polling and the restart / start / stop controls. */
export function StatusPartsBody({ person, health: initialHealth, maintenance = [], history, engineComputer }: StatusPartsProps) {
  const query = useQuery<HealthStatus>({ queryKey: HEALTH_QUERY_KEY, queryFn: () => api.health(), refetchInterval: 15_000, initialData: initialHealth });
  const health = query.data ?? initialHealth;
  const [pendingRole, setPendingRole] = useState<EngineKey | null>(null);
  const [restartingRole, setRestartingRole] = useState<EngineKey | null>(null);
  const [changingRole, setChangingRole] = useState<EngineKey | null>(null);
  const canRestart = isOwnerOrAdminRole(person.role);
  // MEM-SPACE-03: other apps using memory, for admins only; one source per install state (the Mac app helper, else the Stack).
  const otherApps = useQuery({ queryKey: ["performance-other-apps"], enabled: canRestart && Boolean(history?.memory_ledger), refetchInterval: 30_000, queryFn: () => request<{ source: string; apps: { name: string; bytes: number }[] }>("/api/performance/other-apps").catch(() => ({ source: "none", apps: [] })) });

  async function handleRestart() {
    if (!pendingRole) return;
    const role = pendingRole;
    const row = engineRows().find((candidate) => candidate.key === role);
    if (!row) return;
    setRestartingRole(role);
    try {
      await api.restartEngineRole(role);
      toast.success(i18n._({ id: "{name} restarted.", message: "{name} restarted.", values: { name: row.label } }));
      await query.refetch();
      setPendingRole(null);
    } catch (e) {
      toast.error(errorLine(e, i18n._({ id: "Could not restart {name}.", message: "Could not restart {name}.", values: { name: row.label } })));
    } finally { setRestartingRole(null); }
  }

  async function handleRunState(role: EngineKey, action: "start" | "stop") {
    const row = engineRows().find((candidate) => candidate.key === role);
    if (!row) return;
    setChangingRole(role);
    try {
      if (action === "stop") await api.stopEngineRole(role);
      else await api.startEngineRole(role);
      toast.success(action === "stop" ? i18n._({ id: "{name} stopped.", message: "{name} stopped.", values: { name: row.label } }) : i18n._({ id: "{name} started.", message: "{name} started.", values: { name: row.label } }));
      await query.refetch();
    } catch (e) {
      toast.error(errorLine(e, action === "stop" ? i18n._({ id: "Could not stop {name}.", message: "Could not stop {name}.", values: { name: row.label } }) : i18n._({ id: "Could not start {name}.", message: "Could not start {name}.", values: { name: row.label } })));
    } finally { setChangingRole(null); }
  }

  const rows = [
    ...engineHealthRows().map((row) => ({ ...row, state: engineState(health.engines[row.key]) })),
    ...(health.sidecars.some((item) => item.id === "kiwix-serve") ? [{ ...engineRows().find((row) => row.key === "library")!, state: { label: health.sidecars.find((item) => item.id === "kiwix-serve")?.status === "running" ? i18n._({ id: "Running", message: "Running" }) : health.sidecars.find((item) => item.id === "kiwix-serve")?.status === "starting" ? i18n._({ id: "Starting", message: "Starting" }) : i18n._({ id: "Stopped", message: "Stopped" }), status: health.sidecars.find((item) => item.id === "kiwix-serve")?.status === "running" ? "online" as const : "degraded" as const } }] : []),
    { ...engineRows().find((row) => row.key === "hub")!, state: { label: i18n._({ id: "Running", message: "Running" }), status: "online" as const } },
  ];

  return <>
      {health.engines.chat.context_message ? <p className="py-2 text-sm text-muted-foreground">{health.engines.chat.context_message}</p> : null}
      {health.engines.chat.context_per_slot ? <p className="py-2 text-sm text-muted-foreground">{i18n._({ id: "Chat window: {tokens} tokens per slot ({slots, plural, one {# slot} other {# slots}}).", message: "Chat window: {tokens} tokens per slot ({slots, plural, one {# slot} other {# slots}}).", values: { tokens: health.engines.chat.context_per_slot.toLocaleString(i18n.locale), slots: health.engines.chat.context_slots } })}</p> : null}
      {rows.map((row) => {
        const Icon = getIcon(row.icon ?? "activity");
        const underMaintenance = maintenance.includes(row.key);
        const state = underMaintenance ? { label: i18n._({ id: "Under maintenance", message: "Under maintenance" }), status: "maintenance" as const } : row.state;
        const part = history?.components.find((item) => item.component === row.key);
        return <div key={row.key} className="flex flex-col gap-2 py-3 sm:gap-2">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex min-w-0 items-start gap-3"><Icon className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><div className="flex min-h-12 items-center gap-2"><span className="font-medium">{row.label}</span><TooltipIconButton tooltip={i18n._({ id: "About {name}", message: "About {name}", values: { name: row.label } })} hitArea48><span aria-hidden="true">ⓘ</span></TooltipIconButton></div><p className="text-sm text-muted-foreground">{row.hint}</p></div></div>
            <div className="flex min-h-12 flex-wrap items-center gap-2 pl-8 sm:min-h-0 sm:pl-0"><span className="text-sm text-muted-foreground">{part ? part.uptime_percent === null ? i18n._({ id: "No data yet", message: "No data yet" }) : i18n._({ id: "{percent}% uptime", message: "{percent}% uptime", values: { percent: part.uptime_percent.toFixed(1) } }) : null}</span><Status status={state.status}>{state.label}</Status>{canRestart && !underMaintenance && engineHealthRows().some((engine) => engine.key === row.key) ? <><Button variant="secondary" onClick={() => void handleRunState(row.key as EngineKey, isRunningState(state) ? "stop" : "start")} disabled={restartingRole === row.key || changingRole === row.key}>{changingRole === row.key ? (isRunningState(state) ? i18n._({ id: "Stopping…", message: "Stopping…" }) : i18n._({ id: "Starting…", message: "Starting…" })) : isRunningState(state) ? i18n._({ id: "Stop", message: "Stop" }) : i18n._({ id: "Start", message: "Start" })}</Button><Button variant="secondary" onClick={() => setPendingRole(row.key as EngineKey)} disabled={restartingRole === row.key || changingRole === row.key}>{restartingRole === row.key ? i18n._({ id: "Restarting…", message: "Restarting…" }) : i18n._({ id: "Restart", message: "Restart" })}</Button></> : null}</div>
          </div>
          {part ? <div data-status-strip className="w-full min-w-0 overflow-hidden sm:pl-8"><UptimeStrip data={part.days.map(dayData)} summary={statusStripSummary(part.uptime_percent, history?.incidents.filter((incident) => incident.component === part.component) ?? [])} /></div> : null}
          {row.key === "library" && !underMaintenance ? (() => { const start = health.sidecars.find((item) => item.id === "kiwix-serve")?.start; return start ? <p className="pl-8 text-sm text-muted-foreground" data-library-start-phase={start.phase}>{start.message}</p> : null; })() : null}
          {engineHealthRows().some((engine) => engine.key === row.key) && engineComputer?.configured && engineComputer.state !== "working" && state.status === "offline" ? <p className="pl-8 text-sm text-muted-foreground">{i18n._({ id: "This part cannot reach the engine computer: {value}", message: "This part cannot reach the engine computer: {value}", values: { value: engineComputer.reason ?? i18n._({ id: "the connection is unavailable.", message: "the connection is unavailable." }) } })}</p> : null}
        </div>;
      })}
      {history?.memory_ledger ? <div data-testid="memory-ledger" className="flex flex-col gap-2 py-3 sm:gap-2">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0"><div className="flex min-h-12 items-center"><span className="font-medium">{i18n._({ id: "Memory", message: "Memory" })}</span></div><p className="text-sm text-muted-foreground">{i18n._({ id: "Memory used by the whole system.", message: "Memory used by the whole system." })}</p></div>
          <div className="flex min-h-12 flex-wrap items-center gap-2 pl-8 text-sm sm:min-h-0 sm:pl-0">
            <span>{i18n._({ id: "Memory in use by chat and voice: {gb} GB", message: "Memory in use by chat and voice: {gb} GB", values: { gb: gb(history.memory_ledger.reserved_bytes) } })}</span>
            <span>{i18n._({ id: "Kept ready for pictures and tools: {gb} GB", message: "Kept ready for pictures and tools: {gb} GB", values: { gb: gb(history.memory_ledger.warm_bytes) } })}</span>
            <span>{i18n._({ id: "Running a big job: {gb} GB", message: "Running a big job: {gb} GB", values: { gb: gb(history.memory_ledger.burst_bytes) } })}</span>
            <span>{i18n._({ id: "Free for jobs: {gb} GB", message: "Free for jobs: {gb} GB", values: { gb: gb(history.memory_ledger.free_bytes) } })}</span>
            <span>{i18n._({ id: "Waiting in line: chat and voice {reserved}, pictures and tools {warm}, big jobs {burst}", message: "Waiting in line: chat and voice {reserved}, pictures and tools {warm}, big jobs {burst}", values: { reserved: history.memory_ledger.queue_depth.reserved, warm: history.memory_ledger.queue_depth.warm, burst: history.memory_ledger.queue_depth.burst } })}</span>
          </div>
        </div>
        {history.memory_ledger.chat_paged_out ? <p className="pl-8 text-sm text-attention-fg">{i18n._({ id: "Chat is being paged out to disk. Close big apps, or stop a big job.", message: "Chat is being paged out to disk. Close big apps, or stop a big job." })}</p> : null}
        {otherApps.data?.apps.map((app) => <p key={app.name} data-testid="other-app" className="pl-8 text-sm text-muted-foreground">{i18n._({ id: "{name} is using {gb} GB. Closing it gives big jobs more room.", message: "{name} is using {gb} GB. Closing it gives big jobs more room.", values: { name: app.name, gb: gb(app.bytes) } })}</p>)}
        {history.resource_day ? <p data-testid="resource-day" className="pl-8 text-sm text-muted-foreground">{history.resource_day.text}</p> : null}
      </div> : null}
      {canRestart && history?.host_guard ? <div data-testid="host-guard" className="flex flex-col gap-2 py-3 sm:gap-2"><div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"><div className="min-w-0"><div className="flex min-h-12 items-center"><span className="font-medium">{history.host_guard.title}</span></div><p className="text-sm text-muted-foreground">{history.host_guard.text}</p></div><div className="flex min-h-12 flex-wrap items-center gap-2 pl-8 text-sm sm:min-h-0 sm:pl-0"><Status status={history.host_guard.state === "ok" ? "online" : history.host_guard.state === "failing" || history.host_guard.state === "stale" || history.host_guard.state === "off" ? "offline" : "degraded"}>{history.host_guard.state === "ok" ? i18n._({ id: "Working", message: "Working" }) : history.host_guard.state === "failing" ? i18n._({ id: "Needs attention", message: "Needs attention" }) : history.host_guard.state === "stale" ? i18n._({ id: "Waiting", message: "Waiting" }) : history.host_guard.state === "dry" ? i18n._({ id: "Watching", message: "Watching" }) : history.host_guard.state === "off" ? i18n._({ id: "Off", message: "Off" }) : i18n._({ id: "Checking", message: "Checking" })}</Status></div></div></div> : null}
    <AlertDialog open={pendingRole !== null} onOpenChange={(open) => { if (!open && restartingRole === null) setPendingRole(null); }}>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{i18n._({ id: "Restart {value}?", message: "Restart {value}?", values: { value: engineHealthRows().find((row) => row.key === pendingRole)?.label ?? i18n._({ id: "part", message: "part" }) } })}</AlertDialogTitle><AlertDialogDescription>{i18n._({ id: "Anything using it will pause for a moment.{value}", message: "Anything using it will pause for a moment.{value}", values: { value: pendingRole === "chat" ? i18n._({ id: " A reply being written right now will be cut off.", message: " A reply being written right now will be cut off." }) : "" } })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={restartingRole !== null}>{i18n._({ id: "Cancel", message: "Cancel" })}</AlertDialogCancel><Button variant="destructive" onClick={handleRestart} disabled={restartingRole !== null}>{restartingRole !== null ? i18n._({ id: "Restarting…", message: "Restarting…" }) : i18n._({ id: "Restart", message: "Restart" })}</Button></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>;
}
