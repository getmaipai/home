import type { StatusHistory, StatusHistoryIncident } from "@/lib/api";
import { durationWords } from "@/shell/pages/status/statusHistoryFormat";

const PART_LABELS: Record<StatusHistoryIncident["component"], string> = {
  chat: "Brain",
  embed: "Understanding",
  background: "Memory",
  voice: "Voice",
  library: "Library",
  hub: "Home",
  engine_computer: "Engine computer",
};

function timeOf(value: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function statusTimelineEvents(history?: StatusHistory) {
  return (history?.incidents ?? []).slice(0, 5).map((incident, index) => ({
    id: `${incident.component}-${incident.started_at}-${index}`,
    when: incident.ongoing ? "now" as const : "past" as const,
    time: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(incident.started_at)),
    title: PART_LABELS[incident.component],
    detail: incident.ongoing
      ? `Ongoing since ${timeOf(incident.started_at)} · ${durationWords(incident.minutes)}`
      : `Ended ${timeOf(incident.ended_at ?? incident.started_at)} · ${durationWords(incident.minutes)}`,
  }));
}
