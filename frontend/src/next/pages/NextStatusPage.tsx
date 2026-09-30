import { useQuery } from "@tanstack/react-query";
import { OverallBanner, StatusComponents } from "@/next/pages/status/StatusComponents";
import { api, type HealthStatus, type Roster } from "@/lib/api";
import { statusSummary } from "@/shell/statusSummary";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { getIcon } from "@maipai/ui/src/icons";

export const StatusIcon = getIcon("activity");

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
      <OverallBanner summary={summary} health={query.data} />
      {query.data ? <StatusComponents person={person} health={query.data} /> : null}
    </div>
  );
}
