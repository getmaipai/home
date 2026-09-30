import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Status } from "@maipai/ui/src/ui/status";
import { getIcon } from "@maipai/ui/src/icons";
import type { StatusHistory } from "@/lib/api";
import { ENGINE_ROWS } from "@/next/pages/status/StatusComponents";
import { durationWords } from "@/next/pages/status/statusHistoryFormat";

function joinNames(names: string[]) {
  if (names.length < 2) return names[0] ?? "Parts";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function StatusIncident({ level, problems, history }: { level: "online" | "degraded" | "offline" | "maintenance"; problems: string[]; history?: StatusHistory }) {
  if (level !== "offline" && level !== "degraded") return null;
  const names = joinNames(problems);
  const title = level === "degraded" ? `${names} ${problems.length === 1 ? "is" : "are"} starting up` : `${names} ${problems.length === 1 ? "isn't" : "aren't"} running`;
  const AlertIcon = getIcon("alert-triangle");
  const ongoing = history?.incidents.filter((incident) => incident.ongoing && incident.ended_at === null) ?? [];
  const earliest = ongoing.reduce<(typeof ongoing)[number] | undefined>((found, incident) => !found || incident.started_at < found.started_at ? incident : found, undefined);
  const affects = ongoing.map((incident) => ENGINE_ROWS.find((row) => row.key === incident.component)?.label).filter((name): name is string => Boolean(name));
  const elapsed = earliest ? Math.max(0, Math.floor((new Date(history!.generated_at).getTime() - new Date(earliest.started_at).getTime()) / 60_000)) : null;
  return <Card>
    <CardHeader className="flex flex-row items-start gap-3 pb-2"><AlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" /><CardTitle>{title}</CardTitle></CardHeader>
    <CardContent className="pl-11"><p className="text-sm">MaiPai is checking on it.</p><p className="mt-2 text-sm text-muted-foreground">{earliest && elapsed !== null ? `Investigating · Ongoing for ${durationWords(elapsed)} · Affects ${joinNames(affects)}` : `Investigating · Affects ${names}`}</p></CardContent>
  </Card>;
}

export function RecentProblems({ history }: { history?: StatusHistory }) {
  if (!history?.incidents.length) return null;
  const incidents = history.incidents.slice(0, 5);
  return <Card>
    <CardHeader><CardTitle>Recent problems</CardTitle></CardHeader>
    <CardContent className="flex flex-col divide-y divide-border">
      {incidents.map((incident, index) => {
        const part = ENGINE_ROWS.find((row) => row.key === incident.component)?.label ?? "Home";
        const start = new Date(incident.started_at);
        const end = incident.ended_at ? new Date(incident.ended_at) : null;
        const day = (value: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
        const clock = (value: Date) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(value);
        const startClock = clock(start);
        const endClock = end ? clock(end) : "";
        const samePeriod = end ? startClock.slice(-2) === endClock.slice(-2) : false;
        const startLabel = samePeriod ? startClock.replace(/\s[AP]M$/, "") : startClock;
        const when = end ? `${day(start)}, ${startLabel} to ${endClock}` : `Ongoing since ${day(start)}, ${startClock}`;
        return <div key={`${incident.component}-${incident.started_at}-${index}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-medium">{part}</p><p className="text-sm text-muted-foreground">{when} · {durationWords(incident.minutes)}</p></div>
          {incident.ongoing ? <Status status="offline">Offline</Status> : <Badge variant="outline">Ended</Badge>}
        </div>;
      })}
    </CardContent>
  </Card>;
}
