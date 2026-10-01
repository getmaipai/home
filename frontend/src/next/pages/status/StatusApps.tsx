import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Status } from "@maipai/ui/src/ui/status";
import { UptimeStrip } from "@maipai/ui/src/ui/uptime-strip";
import { isOwnerOrAdminRole, type Roster, type StatusApp } from "@/lib/api";
import { appStatusPresentation } from "@/shell/statusApps";

function appStripData(app: StatusApp) {
  return app.history.map((day) => ({
    status: day.state === "operational" ? "up" as const : day.state === "down" ? "down" as const : "degraded" as const,
    label: day.date,
    detail: `${day.uptime}% of the day working`,
  }));
}

function appStripSummary(app: StatusApp) {
  return `Last 90 days: ${app.uptimePercent.toFixed(3)}% uptime.`;
}

function needsSentence(app: StatusApp) {
  return `Needs: ${(app.needs ?? []).map((need) => `${need.name} (${need.state === "operational" ? "fine" : need.state.replaceAll("_", " ")})`).join(", ")}`;
}

export function StatusApps({ person, apps, behindTheScenes }: { person: Roster; apps: StatusApp[]; behindTheScenes?: ReactNode }) {
  const canSeeNeeds = isOwnerOrAdminRole(person.role);
  return <>
    <Card>
      <CardHeader><CardTitle>Apps</CardTitle></CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {apps.map((app) => {
          const presentation = appStatusPresentation(app.state);
          return <div key={app.id} className="flex flex-col gap-2 py-3">
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-3">
              <span className="font-medium">{app.name}</span>
              <div className="flex min-h-12 flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">{app.uptimePercent.toFixed(3)}% uptime</span>
                <Status status={presentation.status}>{presentation.label}</Status>
              </div>
            </div>
            {app.reason ? <p className="text-sm text-muted-foreground">{app.reason}</p> : null}
            {canSeeNeeds && app.needs?.length ? <p className="text-sm text-muted-foreground">{needsSentence(app)}</p> : null}
            <div data-status-strip className="w-full min-w-0 overflow-hidden"><UptimeStrip data={appStripData(app)} summary={appStripSummary(app)} /></div>
          </div>;
        })}
      </CardContent>
    </Card>
    {canSeeNeeds && behindTheScenes ? <section aria-labelledby="behind-scenes-title" className="flex flex-col gap-4">
      <h2 id="behind-scenes-title" className="text-lg font-semibold">Behind the scenes</h2>
      {behindTheScenes}
    </section> : null}
  </>;
}
