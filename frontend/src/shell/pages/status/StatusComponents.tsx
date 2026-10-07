import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/ui/button";
import { Alert } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Status } from "@maipai/ui/src/ui/status";
import { UptimeStrip } from "@maipai/ui/src/ui/uptime-strip";
import { TooltipIconButton } from "@maipai/ui/src/elements/tooltip-icon-button";
import { getIcon } from "@maipai/ui/src/icons";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { toast } from "sonner";
import { api, ApiError, isOwnerOrAdminRole, type HealthStatus, type Roster, type EngineHealthEntry, type StatusHistory } from "@/lib/api";
import { dayData, statusStripSummary } from "@/shell/pages/status/statusHistoryFormat";
import "@/shell/pages/status/statusLegend.css";

interface StatusComponentsProps { person: Roster; health: HealthStatus; maintenance?: string[]; history?: StatusHistory; }
type EngineKey = keyof HealthStatus["engines"];
type StatusPartId = EngineKey | "library" | "hub";
type EngineState = { label: string; status: "online" | "offline" | "degraded" };

// One shared definition for component names, purpose and row icons.
export const ENGINE_ROWS: Array<{ key: StatusPartId; label: string; hint: string; icon: string }> = [
  { key: "chat", label: "Brain", hint: "Answers your conversations.", icon: "brain" },
  { key: "embed", label: "Understanding", hint: "Matches what you say to skills and memories.", icon: "sparkles" },
  { key: "background", label: "Memory", hint: "Remembers and organizes what matters.", icon: "circuit-board" },
  { key: "voice", label: "Voice", hint: "Speaks the replies.", icon: "audio-waveform" },
  { key: "library", label: "Library", hint: "Offline reference library.", icon: "archive" },
  { key: "hub", label: "Home", hint: "This MaiPai Home itself.", icon: "home" },
];

const ENGINE_HEALTH_ROWS = ENGINE_ROWS.filter((row): row is typeof row & { key: EngineKey } => row.key !== "library" && row.key !== "hub");

export function engineState(engine: EngineHealthEntry): EngineState {
  if (engine.kind === "stub") return { label: "Demo mode", status: "degraded" };
  if (engine.kind === "blocked") return { label: "Blocked", status: "offline" };
  if (engine.alive === true) return { label: "Running", status: "online" };
  if (engine.alive === false) return { label: "Not running", status: "offline" };
  if (engine.kind === "restarting") return { label: "Restarting", status: "degraded" };
  if (engine.kind === "failed" || engine.kind === "stalled") return { label: "Not running", status: "offline" };
  if (engine.kind === "starting") return { label: "Starting", status: "degraded" };
  if (engine.kind === "stopped" || engine.kind === "none") return { label: "Stopped", status: "offline" };
  return { label: "Starting", status: "degraded" };
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}${hours ? ` ${hours} hour${hours === 1 ? "" : "s"}` : ""}`;
  const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? "" : "s"}`;
  if (days > 0) return `${unit(days, "day")}${hours ? ` ${unit(hours, "hour")}` : ""}`;
  if (hours > 0) return `${unit(hours, "hour")}${minutes ? ` ${unit(minutes, "minute")}` : ""}`;
  return unit(Math.max(minutes, 1), "minute");
}

const HEALTH_QUERY_KEY = ["health"];

export function StatusComponents({ person, health: initialHealth, maintenance = [], history }: StatusComponentsProps) {
  const query = useQuery<HealthStatus>({ queryKey: HEALTH_QUERY_KEY, queryFn: () => api.health(), refetchInterval: 15_000, initialData: initialHealth });
  const health = query.data ?? initialHealth;
  const [pendingRole, setPendingRole] = useState<EngineKey | null>(null);
  const [restartingRole, setRestartingRole] = useState<EngineKey | null>(null);
  const [changingRole, setChangingRole] = useState<EngineKey | null>(null);
  const canRestart = isOwnerOrAdminRole(person.role);

  async function handleRestart() {
    if (!pendingRole) return;
    const role = pendingRole;
    const row = ENGINE_ROWS.find((candidate) => candidate.key === role);
    if (!row) return;
    setRestartingRole(role);
    try {
      await api.restartEngineRole(role);
      toast.success(`${row.label} restarted.`);
      await query.refetch();
      setPendingRole(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Could not restart ${row.label}.`);
    } finally { setRestartingRole(null); }
  }

  async function handleRunState(role: EngineKey, action: "start" | "stop") {
    const row = ENGINE_ROWS.find((candidate) => candidate.key === role);
    if (!row) return;
    setChangingRole(role);
    try {
      if (action === "stop") await api.stopEngineRole(role);
      else await api.startEngineRole(role);
      toast.success(`${row.label} ${action === "stop" ? "stopped" : "started"}.`);
      await query.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Could not ${action} ${row.label}.`);
    } finally { setChangingRole(null); }
  }

  const rows = [
    ...ENGINE_HEALTH_ROWS.map((row) => ({ ...row, state: engineState(health.engines[row.key]) })),
    ...(health.sidecars.some((item) => item.id === "kiwix-serve") ? [{ ...ENGINE_ROWS.find((row) => row.key === "library")!, state: { label: health.sidecars.find((item) => item.id === "kiwix-serve")?.status === "running" ? "Running" : health.sidecars.find((item) => item.id === "kiwix-serve")?.status === "starting" ? "Starting" : "Stopped", status: health.sidecars.find((item) => item.id === "kiwix-serve")?.status === "running" ? "online" as const : "degraded" as const } }] : []),
    { ...ENGINE_ROWS.find((row) => row.key === "hub")!, state: { label: "Running", status: "online" as const } },
  ];

  return <Card>
    <CardHeader><CardTitle>Parts</CardTitle>{/* deliberate type-floor exception: compact status legend */}<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="mr-1">Last 90 days</span>{([["fine", "Fine"], ["slow", "Slow"], ["down", "Down"], ["maintenance", "Maintenance"]] as const).map(([status, label]) => <span key={status} className="inline-flex items-center gap-1.5"><span aria-hidden="true" data-status-legend={status} className="size-2 rounded-sm" />{label}</span>)}</div></CardHeader>
    <CardContent className="flex flex-col divide-y divide-border">
      {health.engines.chat.context_message ? <p className="py-2 text-sm text-muted-foreground">{health.engines.chat.context_message}</p> : null}
      {health.engines.chat.context_per_slot ? <p className="py-2 text-sm text-muted-foreground">Chat window: {health.engines.chat.context_per_slot.toLocaleString()} tokens per slot ({health.engines.chat.context_slots} {health.engines.chat.context_slots === 1 ? "slot" : "slots"}).</p> : null}
      {rows.map((row) => {
        const Icon = getIcon(row.icon ?? "activity");
        const underMaintenance = maintenance.includes(row.key);
        const state = underMaintenance ? { label: "Under maintenance", status: "maintenance" as const } : row.state;
        const part = history?.components.find((item) => item.component === row.key);
        return <div key={row.key} className="flex flex-col gap-2 py-3 sm:gap-2">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex min-w-0 items-start gap-3"><Icon className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><div className="flex min-h-12 items-center gap-2"><span className="font-medium">{row.label}</span><TooltipIconButton tooltip={`About ${row.label}`} hitArea48><span aria-hidden="true">ⓘ</span></TooltipIconButton></div><p className="text-sm text-muted-foreground">{row.hint}</p></div></div>
            <div className="flex min-h-12 flex-wrap items-center gap-2 pl-8 sm:min-h-0 sm:pl-0"><span className="text-sm text-muted-foreground">{part ? part.uptime_percent === null ? "No data yet" : `${part.uptime_percent.toFixed(3)}% uptime` : null}</span><Status status={state.status}>{state.label}</Status>{canRestart && !underMaintenance && ENGINE_HEALTH_ROWS.some((engine) => engine.key === row.key) ? <><Button variant="secondary" onClick={() => void handleRunState(row.key as EngineKey, state.label === "Running" || state.label === "Demo mode" ? "stop" : "start")} disabled={restartingRole === row.key || changingRole === row.key}>{changingRole === row.key ? (state.label === "Running" || state.label === "Demo mode" ? "Stopping…" : "Starting…") : state.label === "Running" || state.label === "Demo mode" ? "Stop" : "Start"}</Button><Button variant="secondary" onClick={() => setPendingRole(row.key as EngineKey)} disabled={restartingRole === row.key || changingRole === row.key}>{restartingRole === row.key ? "Restarting…" : "Restart"}</Button></> : null}</div>
          </div>
          {part ? <div data-status-strip className="w-full min-w-0 overflow-hidden sm:pl-8"><UptimeStrip data={part.days.map(dayData)} summary={statusStripSummary(part.uptime_percent, history?.incidents.filter((incident) => incident.component === part.component) ?? [])} /></div> : null}
        </div>;
      })}
    </CardContent>
    <AlertDialog open={pendingRole !== null} onOpenChange={(open) => { if (!open && restartingRole === null) setPendingRole(null); }}>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Restart {ENGINE_HEALTH_ROWS.find((row) => row.key === pendingRole)?.label ?? "part"}?</AlertDialogTitle><AlertDialogDescription>Anything using it will pause for a moment.{pendingRole === "chat" ? " A reply being written right now will be cut off." : ""}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={restartingRole !== null}>Cancel</AlertDialogCancel><Button variant="destructive" onClick={handleRestart} disabled={restartingRole !== null}>{restartingRole !== null ? "Restarting…" : "Restart"}</Button></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </Card>;
}

export function OverallBanner({ summary, health }: { summary: { level: "online" | "degraded" | "offline" | "maintenance"; problems: string[] }; health?: HealthStatus }) {
  const sentence = summary.level === "online" ? `Everything is running.${health ? ` Up for ${formatUptime(health.uptimeSeconds)}.` : ""}`
    : summary.level === "degraded" ? "Something is starting up or slow."
      : summary.level === "maintenance" ? "Some parts are under maintenance."
        : `${summary.problems.join(", ").replace(/, ([^,]*)$/, " and $1")} ${summary.problems.length === 1 ? "isn't" : "aren't"} running.`;
  const state = summary.level === "offline" ? "offline" : summary.level;
  return <Alert className="flex flex-wrap items-center gap-3"><Status status={state}>{summary.level === "online" ? "Online" : summary.level === "offline" ? "Offline" : summary.level === "maintenance" ? "Maintenance" : "Degraded"}</Status><p className="min-w-0 text-base" role="status">{sentence}</p></Alert>;
}
