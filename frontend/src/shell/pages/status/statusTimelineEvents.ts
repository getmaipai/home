import { i18n } from "@lingui/core";
import { engineRows } from "@/shell/pages/status/StatusComponents";
import type { StatusHistory, StatusHistoryIncident } from "@/lib/api";
import { durationWords } from "@/shell/pages/status/statusHistoryFormat";
import { formatDate, formatTime } from "@/lib/format";

const partLabel = (component: StatusHistoryIncident["component"]): string =>
  component === "engine_computer" ? i18n._({ id: "Engine computer", message: "Engine computer" }) : engineRows().find((row) => row.key === component)?.label ?? component;

function timeOf(value: string) {
  return formatTime(value);
}

export function statusTimelineEvents(history?: StatusHistory) {
  return (history?.incidents ?? []).slice(0, 5).map((incident, index) => ({
    id: `${incident.component}-${incident.started_at}-${index}`,
    when: incident.ongoing ? "now" as const : "past" as const,
    time: formatDate(incident.started_at, { month: "short", day: "numeric" }),
    title: partLabel(incident.component),
    detail: incident.ongoing
      ? i18n._({ id: "Ongoing since {time} · {duration}", message: "Ongoing since {time} · {duration}", values: { time: timeOf(incident.started_at), duration: durationWords(incident.minutes) } })
      : i18n._({ id: "Ended {time} · {duration}", message: "Ended {time} · {duration}", values: { time: timeOf(incident.ended_at ?? incident.started_at), duration: durationWords(incident.minutes) } }),
  }));
}
