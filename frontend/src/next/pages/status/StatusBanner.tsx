import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { getIcon } from "@maipai/ui/src/icons";
import type { statusSummary } from "@/shell/statusSummary";
import { formatUptime } from "@/next/pages/status/StatusComponents";
import "@/next/pages/status/statusBanner.css";

type Summary = ReturnType<typeof statusSummary>;
const icons = { online: getIcon("check"), degraded: getIcon("alert-triangle"), offline: getIcon("alert-triangle"), maintenance: getIcon("wrench") };

function joinNames(names: string[]) {
  if (names.length < 2) return names[0] ?? "Parts";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function StatusBanner({ summary, uptimeSeconds, maintenanceEndsAt, message }: { summary: Summary; uptimeSeconds?: number; maintenanceEndsAt?: string; message?: string }) {
  const Icon = icons[summary.level];
  const color = summary.level === "offline" ? "border-destructive/25 bg-destructive/10 text-destructive" : "";
  const headline = summary.level === "online" ? "We're fully operational" : summary.level === "degraded" ? "Some parts are starting up" : summary.level === "offline" ? "We're having problems" : "Scheduled maintenance is in progress";
  const body = message ?? (summary.level === "online" ? `Everything is running.${uptimeSeconds === undefined ? "" : ` Up for ${formatUptime(uptimeSeconds)}.`}`
    : summary.level === "degraded" ? "It should be back in a moment."
      : summary.level === "offline" ? "We're looking into it."
        : maintenanceEndsAt ? `Until ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(maintenanceEndsAt))}` : "Scheduled work is underway.");
  return <section aria-label="Overall status" data-status-banner={summary.level} className="w-full overflow-hidden rounded-xl border border-border">
    <div className={`flex min-h-20 items-center gap-4 border-b px-5 py-4 ${color}`}>
      <Icon className="size-8 shrink-0" aria-label={summary.level === "online" ? "Operational" : summary.level === "maintenance" ? "Maintenance" : "Attention needed"} />
      <h2 className="min-w-0 text-lg font-semibold sm:text-xl">{headline}</h2>
    </div>
    <div className="flex min-h-16 flex-wrap items-center gap-2 px-5 py-4">
      {summary.level === "offline" || summary.level === "maintenance" ? <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Affected parts">{summary.problems.map((problem) => <Badge key={problem} variant="outline" className={summary.level === "offline" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10 text-primary"}>{problem}</Badge>)}</div> : null}
      <p className="min-w-0 text-sm text-foreground">{summary.level === "maintenance" && summary.problems.length ? `${joinNames(summary.problems)}. ` : ""}{body}</p>
    </div>
  </section>;
}
