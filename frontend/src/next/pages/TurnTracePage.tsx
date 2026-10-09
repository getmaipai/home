import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { TraceWaterfall } from "@maipai/ui/src/elements/trace-waterfall";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { api, ApiError, type TurnTrace } from "@/lib/api";

export function TurnTracePage() {
  const { turnId = "" } = useParams<{ turnId: string }>();
  const query = useQuery<TurnTrace>({ queryKey: ["turn-trace", turnId], queryFn: () => api.turnTrace(turnId), enabled: Boolean(turnId) });
  return (
    <>
    <h1 className="sr-only">Turn trace</h1>
    <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load this trace."} loadingLabel="Loading turn trace">
      {(trace) => <TraceWaterfall spans={trace.spans} totalMs={trace.totalMs} visibleCount={trace.spans.length} />}
    </AsyncState>
    </>
  );
}
