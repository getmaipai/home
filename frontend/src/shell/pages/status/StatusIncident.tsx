import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import type { StatusHistory } from "@/lib/api";
import { ENGINE_ROWS } from "@/shell/pages/status/StatusComponents";
import { durationWords } from "@/shell/pages/status/statusHistoryFormat";

function joinNames(names: string[]) {
  if (names.length < 2) return names[0] ?? "Parts";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function StatusIncident({ level, problems, history, appReason }: { level: "online" | "degraded" | "offline" | "maintenance"; problems: string[]; history?: StatusHistory; appReason?: string }) {
  if (level !== "offline" && level !== "degraded") return null;
  const names = joinNames(problems);
  const chatSearchLimited = level === "degraded" && problems.length === 1 && problems[0] === "Chat" && /search is limited right now/i.test(appReason ?? "");
  const title = chatSearchLimited ? "Chat is working" : appReason ? `${names} ${problems.length === 1 ? "needs" : "need"} attention` : level === "degraded" ? `${names} ${problems.length === 1 ? "is" : "are"} starting up` : `${names} ${problems.length === 1 ? "isn't" : "aren't"} running`;
  const message = chatSearchLimited ? "Search is limited right now." : appReason ?? "MaiPai is checking on it.";
  const AlertIcon = getIcon("alert-triangle");
  const ongoing = appReason ? [] : history?.incidents.filter((incident) => incident.ongoing && incident.ended_at === null) ?? [];
  const earliest = ongoing.reduce<(typeof ongoing)[number] | undefined>((found, incident) => !found || incident.started_at < found.started_at ? incident : found, undefined);
  const affects = ongoing.map((incident) => ENGINE_ROWS.find((row) => row.key === incident.component)?.label).filter((name): name is string => Boolean(name));
  const elapsed = earliest ? Math.max(0, Math.floor((new Date(history!.generated_at).getTime() - new Date(earliest.started_at).getTime()) / 60_000)) : null;
  return <Card>
    <CardHeader className="flex flex-row items-start gap-3 pb-2"><AlertIcon className={`mt-0.5 size-5 shrink-0 ${chatSearchLimited ? "text-attention-fg" : "text-destructive"}`} aria-hidden="true" /><CardTitle>{title}</CardTitle></CardHeader>
    <CardContent className="pl-11"><p className="text-sm">{message}</p>{!appReason ? <p className="mt-2 text-sm text-muted-foreground">{earliest && elapsed !== null ? `Investigating · Ongoing for ${durationWords(elapsed)} · Affects ${joinNames(affects)}` : `Investigating · Affects ${names}`}</p> : null}</CardContent>
  </Card>;
}
