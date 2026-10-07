import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { TraceWaterfall } from "@maipai/ui/src/elements/trace-waterfall";
import { Button } from "@maipai/ui/src/ui/button";
import { api, ApiError } from "@/lib/api";

export function TurnTracePage() {
  const { turnId = "" } = useParams();
  const query = useQuery({ queryKey: ["turn-trace", turnId], queryFn: () => api.turnTrace(turnId), enabled: Boolean(turnId) });

  return (
    <>
      <h1>Turn trace</h1>
      {query.data ? <TraceWaterfall spans={query.data.spans} totalMs={query.data.totalMs} visibleCount={query.data.visibleCount} /> : null}
      {query.isPending ? <p>Loading turn trace…</p> : null}
      {query.isError ? <p role="alert">{query.error instanceof ApiError ? query.error.message : "Could not load this trace."} <Button type="button" onClick={() => void query.refetch()}>Try again</Button></p> : null}
    </>
  );
}
