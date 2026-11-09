import { i18n } from "@lingui/core";
import type { StatusCardProps } from "@maipai/ui/src/elements/status-card";
import { getIcon } from "@maipai/ui/src/icons";
import type { statusSummary } from "@/shell/statusSummary";
import { formatUptime } from "@/shell/pages/status/StatusComponents";
import { joinNames } from "@/shell/pages/status/statusBoardFormat";
import { formatTime } from "@/lib/format";
import "@/shell/pages/status/statusBanner.css";

type Summary = ReturnType<typeof statusSummary>;
const icons = { online: getIcon("check"), degraded: getIcon("alert-triangle"), offline: getIcon("alert-triangle"), maintenance: getIcon("wrench") };

/** The copy and kind for the overall-status kit StatusCard; StatusPage renders the card itself. */
export function statusBannerCard({ summary, uptimeSeconds, maintenanceEndsAt, message }: { summary: Summary; uptimeSeconds?: number; maintenanceEndsAt?: string; message?: string }): StatusCardProps {
  const Icon = icons[summary.level];
  const headline = summary.level === "online" ? i18n._({ id: "We're fully operational", message: "We're fully operational" }) : summary.level === "degraded" ? i18n._({ id: "Some parts are starting up", message: "Some parts are starting up" }) : summary.level === "offline" ? i18n._({ id: "We're having problems", message: "We're having problems" }) : i18n._({ id: "Scheduled maintenance is in progress", message: "Scheduled maintenance is in progress" });
  const body = message ?? (summary.level === "online" ? (uptimeSeconds === undefined ? i18n._({ id: "Everything is running.", message: "Everything is running." }) : i18n._({ id: "Everything is running. Up for {uptime}.", message: "Everything is running. Up for {uptime}.", values: { uptime: formatUptime(uptimeSeconds ?? 0) } }))
    : summary.level === "degraded" ? i18n._({ id: "It should be back in a moment.", message: "It should be back in a moment." })
      : summary.level === "offline" ? i18n._({ id: "We're looking into it.", message: "We're looking into it." })
        : maintenanceEndsAt ? i18n._({ id: "Until {time}", message: "Until {time}", values: { time: formatTime(maintenanceEndsAt) } }) : i18n._({ id: "Scheduled work is underway.", message: "Scheduled work is underway." }));
  const kind = summary.level === "online" ? "done" : summary.level === "offline" ? "problem" : summary.level === "degraded" ? "attention" : "info";
  const iconLabel = summary.level === "online" ? i18n._({ id: "Operational", message: "Operational" }) : summary.level === "maintenance" ? i18n._({ id: "Maintenance", message: "Maintenance" }) : i18n._({ id: "Attention needed", message: "Attention needed" });
  const names = summary.level === "maintenance" && summary.problems.length ? i18n._({ id: "{names}. ", message: "{names}. ", values: { names: joinNames(summary.problems) } }) : "";
  return { textStyle: "status", kind, stateWord: summary.level === "offline" && summary.problems.length ? joinNames(summary.problems) : undefined, title: headline, icon: <Icon className="size-5" aria-label={iconLabel} />,
    line: <span className="block whitespace-normal">{names}{body}</span> };
}
