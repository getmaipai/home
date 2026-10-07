import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Button } from "@maipai/ui/src/ui/button";
import { Status } from "@maipai/ui/src/ui/status";
import { UptimeStrip } from "@maipai/ui/src/ui/uptime-strip";
import { getIcon } from "@maipai/ui/src/icons";
import { isOwnerOrAdminRole, type Roster, type StatusApp, type StatusAppNeed } from "@/lib/api";
import { appStatusPresentation, summarizeStatusApp } from "@/shell/statusApps";
import { statusAppDayData } from "@/shell/pages/status/statusAppHistory";

function appStripData(app: StatusApp) {
  return app.history.map((day) => statusAppDayData(day));
}

function appStripSummary(app: StatusApp) {
  return `Last 90 days: ${app.uptimePercent.toFixed(3)}% uptime.`;
}

function appHasKnownProblem(app: StatusApp) {
  return app.needs?.some((need) => need.state !== "operational" && need.state !== "unknown") ?? false;
}

function needStateLabel(state: StatusAppNeed["state"]): string {
  if (state === "operational") return "fine";
  if (state === "waiting") return "waiting for internet";
  if (state === "unknown") return "no recent use";
  return state;
}

function NeedRow({ need }: { need: StatusAppNeed }) {
  return <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5">
    <span className="font-medium">{need.name}</span>
    <span className="text-sm text-muted-foreground">{needStateLabel(need.state)}</span>
    {need.last_success_at ? <span className="w-full text-sm text-muted-foreground">Last success: {need.last_success_at}</span> : null}
    {need.last_error_class ? <span className="w-full text-sm text-muted-foreground">Last error: {need.last_error_class.replaceAll("_", " ")}</span> : null}
  </li>;
}

function AppNeeds({ appId, needs }: { appId: string; needs: StatusAppNeed[] }) {
  const attention = needs.filter((need) => need.state !== "operational" && need.state !== "unknown");
  const working = needs.filter((need) => need.state === "operational");
  const unused = needs.filter((need) => need.state === "unknown");
  return <div className="flex flex-col gap-3 border-t border-border pt-3">
    {attention.length ? <section aria-labelledby={`needs-attention-${appId}`}>
      <h3 id={`needs-attention-${appId}`} className="text-sm font-semibold">Needs attention</h3>
      <ul className="divide-y divide-border">{attention.map((need) => <NeedRow key={`${need.kind}:${need.id}`} need={need} />)}</ul>
    </section> : null}
    {working.length ? <section aria-labelledby={`needs-working-${appId}`}>
      <h3 id={`needs-working-${appId}`} className="text-sm font-semibold">Working</h3>
      <ul className="divide-y divide-border">{working.map((need) => <NeedRow key={`${need.kind}:${need.id}`} need={need} />)}</ul>
    </section> : null}
    {unused.length ? <Collapsible>
      <CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md text-left text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span>No recent use: {unused.length} services</span><span aria-hidden="true">⌄</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y divide-border pl-3">{unused.map((need) => <li key={`${need.kind}:${need.id}`} className="py-1.5 text-sm text-muted-foreground">{need.name}</li>)}</ul>
      </CollapsibleContent>
    </Collapsible> : null}
  </div>;
}

function AppRow({ app, canExpand }: { app: StatusApp; canExpand: boolean }) {
  const hasDetails = canExpand && (app.needs?.length ?? 0) > 0;
  const [open, setOpen] = useState(() => appHasKnownProblem(app));
  const presentation = appStatusPresentation(app.state);
  const summary = summarizeStatusApp(app, canExpand);
  const detailsId = `app-needs-${app.id}`;
  const summaryContent = <>
    <p className="text-sm text-muted-foreground">{summary}</p>
    <div data-status-strip className="w-full min-w-0 overflow-hidden"><UptimeStrip data={appStripData(app)} summary={appStripSummary(app)} /></div>
  </>;
  const details = app.needs?.length ? <AppNeeds appId={app.id} needs={app.needs} /> : null;

  if (!hasDetails) return <div className="flex flex-col gap-2 py-3">
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-3">
      <span className="font-medium">{app.name}</span>
      <div className="flex min-h-12 flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{app.uptimePercent.toFixed(3)}% uptime</span>
        <Status status={presentation.status}>{presentation.label}</Status>
      </div>
    </div>
    {summaryContent}
  </div>;

  const ChevronDown = getIcon("chevron-down");
  return <Collapsible open={open} onOpenChange={setOpen}>
    <div className="flex flex-col gap-2 py-3">
      <div className="flex min-h-12 flex-wrap items-center gap-3">
        <span className="mr-auto font-medium">{app.name}</span>
        <span className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">{app.uptimePercent.toFixed(3)}% uptime</span>
          <Status status={presentation.status}>{presentation.label}</Status>
          <span className="inline-flex min-h-12 items-center">
            <CollapsibleTrigger aria-controls={detailsId} render={<Button type="button" variant="outline" size="sm" />}>
              {open ? "Hide details" : "Show details"}
              <ChevronDown data-testid="app-details-chevron" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            </CollapsibleTrigger>
          </span>
        </span>
      </div>
      {summaryContent}
      {details ? <CollapsibleContent id={detailsId} keepMounted>{details}</CollapsibleContent> : null}
    </div>
  </Collapsible>;
}

export function StatusApps({ person, apps, behindTheScenes }: { person: Roster; apps: StatusApp[]; behindTheScenes?: ReactNode }) {
  const canSeeNeeds = isOwnerOrAdminRole(person.role);
  return <>
    <Card>
      <CardHeader><CardTitle>Apps</CardTitle></CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {apps.map((app) => <AppRow key={app.id} app={app} canExpand={canSeeNeeds} />)}
      </CardContent>
    </Card>
    {canSeeNeeds && behindTheScenes ? <section aria-labelledby="behind-scenes-title" className="flex flex-col gap-4">
      <h2 id="behind-scenes-title" className="text-lg font-semibold">Behind the scenes</h2>
      {behindTheScenes}
    </section> : null}
  </>;
}
