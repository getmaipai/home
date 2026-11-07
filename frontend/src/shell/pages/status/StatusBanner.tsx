import { i18n } from "@lingui/core";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { getIcon } from "@maipai/ui/src/icons";
import type { statusSummary } from "@/shell/statusSummary";
import { formatUptime } from "@/shell/pages/status/StatusComponents";
import { joinNames } from "@/shell/pages/status/statusBoardFormat";
import { formatTime } from "@/lib/format";
import "@/shell/pages/status/statusBanner.css";

type Summary = ReturnType<typeof statusSummary>;
const icons = { online: getIcon("check"), degraded: getIcon("alert-triangle"), offline: getIcon("alert-triangle"), maintenance: getIcon("wrench") };

export function StatusBanner({ summary, uptimeSeconds, maintenanceEndsAt, message }: { summary: Summary; uptimeSeconds?: number; maintenanceEndsAt?: string; message?: string }) {
  const Icon = icons[summary.level];
  const color = summary.level === "offline" ? "border-destructive/25 bg-destructive/10 text-destructive" : "";
  const headline = summary.level === "online" ? i18n._({ id: "We're fully operational", message: "We're fully operational" }) : summary.level === "degraded" ? i18n._({ id: "Some parts are starting up", message: "Some parts are starting up" }) : summary.level === "offline" ? i18n._({ id: "We're having problems", message: "We're having problems" }) : i18n._({ id: "Scheduled maintenance is in progress", message: "Scheduled maintenance is in progress" });
  const body = message ?? (summary.level === "online" ? (uptimeSeconds === undefined ? i18n._({ id: "Everything is running.", message: "Everything is running." }) : i18n._({ id: "Everything is running. Up for {uptime}.", message: "Everything is running. Up for {uptime}.", values: { uptime: formatUptime(uptimeSeconds ?? 0) } }))
    : summary.level === "degraded" ? i18n._({ id: "It should be back in a moment.", message: "It should be back in a moment." })
      : summary.level === "offline" ? i18n._({ id: "We're looking into it.", message: "We're looking into it." })
        : maintenanceEndsAt ? i18n._({ id: "Until {time}", message: "Until {time}", values: { time: formatTime(maintenanceEndsAt) } }) : i18n._({ id: "Scheduled work is underway.", message: "Scheduled work is underway." }));
  return <section aria-label={i18n._({ id: "Overall status", message: "Overall status" })} data-status-banner={summary.level} className="w-full overflow-hidden rounded-xl border border-border">
    <div className={`flex min-h-20 items-center gap-4 border-b px-5 py-4 ${color}`}>
      <Icon className="size-8 shrink-0" aria-label={summary.level === "online" ? i18n._({ id: "Operational", message: "Operational" }) : summary.level === "maintenance" ? i18n._({ id: "Maintenance", message: "Maintenance" }) : i18n._({ id: "Attention needed", message: "Attention needed" })} />
      <h2 className="min-w-0 text-lg font-semibold sm:text-xl">{headline}</h2>
    </div>
    <div className="flex min-h-16 flex-wrap items-center gap-2 px-5 py-4">
      {summary.level === "offline" || summary.level === "maintenance" ? <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label={i18n._({ id: "Affected parts", message: "Affected parts" })}>{summary.problems.map((problem) => <Badge key={problem} variant={summary.level === "offline" ? "destructive" : "secondary"}>{problem}</Badge>)}</div> : null}
      <p className="min-w-0 text-sm text-foreground">{summary.level === "maintenance" && summary.problems.length ? i18n._({ id: "{names}. ", message: "{names}. ", values: { names: joinNames(summary.problems) } }) : ""}{body}</p>
    </div>
  </section>;
}
