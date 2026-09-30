import { useQuery } from "@tanstack/react-query";
import { Status, StatusIndicator as StatusDot } from "@maipai/ui/src/ui/status";
import { Link } from "react-router-dom";
import { api, type HealthStatus } from "@/lib/api";
import { statusSummary } from "@/shell/statusSummary";

export function StatusIndicator() {
  const query = useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.health(),
    retry: false,
    refetchInterval: (current) => statusSummary(current.state.data).level === "online" ? 15_000 : 5_000,
  });
  const summary = statusSummary(query.data);
  const title = summary.problems.length > 0 ? `Problems: ${summary.problems.join(", ")}` : summary.text;

  return (
    <Link
      to="/status"
      aria-label={summary.text}
      title={title}
      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Status status={summary.level} className="gap-1.5 px-2 py-1">
        <StatusDot status={summary.level} className="overflow-hidden" />
        <span className="hidden sm:inline">{summary.text}</span>
      </Status>
    </Link>
  );
}
