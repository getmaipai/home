import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Button } from "@maipai/ui/src/ui/button";
import { Badge } from "@maipai/ui/src/ui/badge";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { toast } from "sonner";
import { api, ApiError, isOwnerOrAdminRole, type HealthStatus, type Roster } from "@/lib/api";
import type { EngineHealthEntry } from "@/lib/api";

interface HealthSectionProps {
  person: Roster;
}

const SIDECAR_VARIANT: Record<HealthStatus["sidecars"][number]["status"], "outline" | "destructive" | "secondary"> = {
  running: "secondary",
  starting: "outline",
  stopped: "outline",
  unhealthy: "destructive",
  crashed: "destructive",
};

// Dad-language state for one engine, from a real probe (app.ts's
// healthRoute): before 2026-09-07 this page printed the engine's
// configured kind ("selection"), which stayed the same after the process
// behind it had died - "why didn't our health page show bad health when
// these are down" (Jesse). `alive` is the answer to that: true/false when
// something should be up, null when nothing is (yet).
function engineState(engine: EngineHealthEntry): { label: string; variant: "secondary" | "destructive" | "outline" } {
  // The built-in stand-in (no model chosen yet, or no speech program
  // installed) answers health checks fine but is not the real thing, and
  // this page must not call it "Running" - the chat dock's own pill
  // already calls it demo mode.
  if (engine.kind === "stub") return { label: "Demo mode", variant: "outline" };
  // ENGINE-PORT-01: checked before the alive probe below - a blocked
  // engine never got the chance to be "not answering," something else
  // already holds its port and MaiPai refused to touch it, on purpose.
  if (engine.kind === "blocked") return { label: "Blocked by another program", variant: "destructive" };
  if (engine.alive === true) return { label: "Running", variant: "secondary" };
  if (engine.alive === false) return { label: "Not answering", variant: "destructive" };
  if (engine.kind === "restarting") return { label: "Restarting", variant: "destructive" };
  if (engine.kind === "failed") return { label: "Keeps stopping", variant: "destructive" };
  if (engine.kind === "stalled") return { label: "Start is stuck", variant: "destructive" };
  if (engine.kind === "starting") return { label: "Starting", variant: "outline" };
  if (engine.kind === "stopped") return { label: "Stopped", variant: "outline" };
  return { label: "Starts when needed", variant: "outline" };
}

export const ENGINE_ROWS: Array<{ key: keyof HealthStatus["engines"]; label: string; hint: string }> = [
  { key: "chat", label: "Brain", hint: "Answers your conversations." },
  { key: "embed", label: "Understanding", hint: "Matches what you say to skills and memories." },
  { key: "background", label: "Memory", hint: "Keeps household memories up to date." },
  { key: "voice", label: "Voice", hint: "Speaks replies out loud." },
];

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "just started";
}

const HEALTH_QUERY_KEY = ["health"];

// Settings -> Household -> Health (docs/SETTINGS.md rule 2 lists Health
// as its own central page, separate from Repairs): "is MaiPai Home
// actually running" for every signed-in household member (GET /api/
// health is requireAuth, not requireRole - see app.ts's own comment), with
// the restart control next to it for whoever can use it - "restart the
// entire server under settings household, next to something that tells
// me the health of the app" (Jesse, 2026-09-07). The restart button gates
// itself by role rather than the whole page/route, since Health itself
// stays visible to everyone.
export function HealthSection({ person }: HealthSectionProps) {
  const query = useQuery<HealthStatus>({ queryKey: HEALTH_QUERY_KEY, queryFn: () => api.health(), refetchInterval: 15_000 });
  const [pendingRole, setPendingRole] = useState<keyof HealthStatus["engines"] | null>(null);
  const [restartingRole, setRestartingRole] = useState<keyof HealthStatus["engines"] | null>(null);
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
    } finally {
      setRestartingRole(null);
    }
  }

  return (
    <Section heading="Health">
      <AsyncState
        data={query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load health."}
        loadingLabel="Loading health"
      >
        {(health) => (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base" role="status">
              <span className="font-medium">{health.ok ? "Everything is running." : "Something is not answering."}</span>
              <span>
                <span className="text-[var(--muted-foreground)]">Up for: </span>
                {formatUptime(health.uptimeSeconds)}
              </span>
            </div>
            {!health.ok ? (
              <p className="text-base text-[var(--muted-foreground)]">MaiPai restarts a stopped engine on its own. If one keeps stopping, Repairs has a button to start it again.</p>
            ) : null}

            <div className="flex flex-col divide-y divide-[var(--border)]">
              {ENGINE_ROWS.map((row) => {
                const state = engineState(health.engines[row.key]);
                return (
                  <div key={row.key} className="flex items-center justify-between gap-3 py-2 text-base">
                    <span className="flex flex-col">
                      <span>{row.label}</span>
                      <span className="text-sm text-[var(--muted-foreground)]">{row.hint}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={state.variant}>{state.label}</Badge>
                      {canRestart ? (
                        <Button variant="secondary" onClick={() => setPendingRole(row.key)} disabled={restartingRole === row.key}>
                          {restartingRole === row.key ? "Restarting…" : "Restart"}
                        </Button>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>

            {health.sidecars.length > 0 ? (
              <div className="flex flex-col divide-y divide-[var(--border)]">
                {health.sidecars.map((sidecar) => (
                  <div key={sidecar.id} className="flex items-center justify-between gap-3 py-2 text-base">
                    <span>{sidecar.id}</span>
                    <Badge variant={SIDECAR_VARIANT[sidecar.status]}>{sidecar.status}</Badge>
                  </div>
                ))}
              </div>
            ) : null}

          </div>
        )}
      </AsyncState>
      <AlertDialog open={pendingRole !== null} onOpenChange={(open) => { if (!open && restartingRole === null) setPendingRole(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart {ENGINE_ROWS.find((row) => row.key === pendingRole)?.label ?? "engine"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything using it will pause for a moment.
              {pendingRole === "chat" ? " A reply being written right now will be cut off." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restartingRole !== null}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={handleRestart} disabled={restartingRole !== null}>
              {restartingRole !== null ? "Restarting…" : "Restart engine"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
