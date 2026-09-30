import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Status } from "@maipai/ui/src/ui/status";
import { getIcon } from "@maipai/ui/src/icons";
import { HealthSection } from "@/apps/settings/HealthSection";
import { api, type HealthStatus, type Roster } from "@/lib/api";
import { statusSummary } from "@/shell/statusSummary";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const StatusIcon = getIcon("activity");

function overallSentence(level: ReturnType<typeof statusSummary>["level"]): string {
  if (level === "offline") return "Something is not working.";
  if (level === "degraded") return "Some parts may be starting or having trouble.";
  return "Everything is running.";
}

export function NextStatusPage({ person }: { person: Roster }) {
  useDocumentTitle("Status");
  const query = useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.health(),
    retry: false,
    refetchInterval: (current) => statusSummary(current.state.data).level === "online" ? 15_000 : 5_000,
  });
  const summary = statusSummary(query.data);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Status status={summary.level}>{summary.text}</Status>
          <p className="min-w-0 text-base" role="status">{overallSentence(summary.level)}</p>
        </CardContent>
      </Card>
      <HealthSection person={person} />
    </div>
  );
}
