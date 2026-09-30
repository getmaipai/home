import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";

function joinNames(names: string[]) {
  if (names.length < 2) return names[0] ?? "Parts";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function StatusIncident({ level, problems }: { level: "online" | "degraded" | "offline" | "maintenance"; problems: string[] }) {
  if (level !== "offline" && level !== "degraded") return null;
  const names = joinNames(problems);
  const title = level === "degraded" ? `${names} ${problems.length === 1 ? "is" : "are"} starting up` : `${names} ${problems.length === 1 ? "isn't" : "aren't"} running`;
  const AlertIcon = getIcon("alert-triangle");
  return <Card>
    <CardHeader className="flex flex-row items-start gap-3 pb-2"><AlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" /><CardTitle>{title}</CardTitle></CardHeader>
    <CardContent className="pl-11"><p className="text-sm">MaiPai is checking on it.</p><p className="mt-2 text-sm text-muted-foreground">Investigating · Affects {names}</p></CardContent>
  </Card>;
}
