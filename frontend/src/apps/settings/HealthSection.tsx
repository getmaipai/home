import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Section } from "@/kit/primitives/Section";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Button } from "@/kit/ui/button";
import { Badge } from "@/kit/ui/badge";
import { useToast } from "@/kit/primitives/Toast";
import { api, ApiError, type HealthStatus, type Roster } from "@/lib/api";

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
  const { push } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const canRestart = person.role === "owner" || person.role === "admin";

  async function handleRestart() {
    setRestarting(true);
    try {
      await api.restartServer();
      push("Restarting MaiPai Home. This page will reconnect once it's back.");
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Could not restart MaiPai Home.");
      setRestarting(false);
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
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
              <span>
                <span className="text-[var(--muted-foreground)]">Uptime: </span>
                {formatUptime(health.uptimeSeconds)}
              </span>
              <span>
                <span className="text-[var(--muted-foreground)]">Brain: </span>
                {health.brain}
              </span>
              <span>
                <span className="text-[var(--muted-foreground)]">Voice: </span>
                {health.voice}
              </span>
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

            {canRestart ? (
              confirming ? (
                <div className="flex flex-col gap-2 py-1">
                  <p className="text-base font-medium">Restart MaiPai Home?</p>
                  <p className="text-base text-[var(--muted-foreground)]">
                    Everyone's conversation and anything playing will drop for about a minute while it comes back up.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="destructive" onClick={handleRestart} disabled={restarting}>
                      {restarting ? "Restarting…" : "Yes, restart now"}
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirming(false)} disabled={restarting}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setConfirming(true)} className="w-fit">
                  Restart server
                </Button>
              )
            ) : null}
          </div>
        )}
      </AsyncState>
    </Section>
  );
}
