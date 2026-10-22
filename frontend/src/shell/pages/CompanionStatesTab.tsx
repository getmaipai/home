import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { GRID_COLUMNS } from "@maipai/ui/src/responsive";
import { ApiError, api } from "@/lib/api";
import { CompanionStateContents } from "@/shell/pages/CompanionStateCard";

const key = (id: string) => ["companions", id, "states"] as const;
const networkError = "Could not reach Home. Check your connection and try again.";
const errorText = (error: unknown) => error instanceof ApiError ? error.message : networkError;
const titleState = (state: string) => state.split("_").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");

export function CompanionStatesTab({ id, active }: { id: string; active: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key(id), queryFn: () => api.companionStates(id), enabled: active, retry: false });
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const data = query.data;
  useEffect(() => { if (data?.run?.job) setRunId(data.run.job); }, [data?.run?.job]);
  const runQuery = useQuery({ queryKey: [...key(id), "run", runId], queryFn: () => api.companionStateRun(id, runId!), enabled: active && !!runId, retry: false, refetchInterval: (current) => document.hidden ? false : current.state.data?.state === "queued" || current.state.data?.state === "running" || current.state.data === undefined ? 2000 : false });
  const run = runQuery.data;
  const running = !!runId && (!run || run.state === "queued" || run.state === "running");
  useEffect(() => {
    if (run && ["done", "failed", "cancelled"].includes(run.state)) {
      if (run.error) setError(run.error);
      setRunId(null);
      void client.invalidateQueries({ queryKey: key(id) });
    }
  }, [run, id, client]);
  const perform = useCallback(async (action: () => Promise<unknown>) => {
    setError("");
    try { await action(); await client.invalidateQueries({ queryKey: key(id) }); }
    catch (cause) { setError(errorText(cause)); }
  }, [client, id]);
  async function start(action: () => Promise<{ job: string }>) {
    setError("");
    try { setRunId((await action()).job); }
    catch (cause) { setError(errorText(cause)); }
  }
  if (!active) return null;
  if (query.isError) return <AsyncState data={null} error onRetry={() => void query.refetch()} errorMessage={errorText(query.error)} loadingLabel="Loading companion clips">{() => null}</AsyncState>;
  if (!data) return <AsyncState data={undefined} isFetching={query.isFetching} onRetry={() => void query.refetch()} loadingLabel="Loading companion clips">{() => null}</AsyncState>;
  if (!data.sheet_ready) return <EmptyState icon="inbox" text="Approve the character sheet in the Look tab first. Every clip starts from it." />;
  const missing = data.counts.required_missing.map(titleState);
  return <div className="flex flex-col gap-4">
    {!data.start_ready ? <Alert><AlertDescription>{data.start_reason}</AlertDescription></Alert> : null}
    <section aria-label="Clip readiness" className="flex flex-col gap-2"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{data.counts.approved} of {data.counts.total} ready</h2></div><Progress value={data.counts.approved / data.counts.total * 100} aria-label="Approved clips" />{missing.length ? <p className="text-sm text-muted-foreground">Still needed: {missing.join(", ")}</p> : null}
      <div className="flex flex-wrap gap-2"><Button disabled={!data.start_ready || running || !data.states.some((state) => !state.approved)} onClick={() => void start(() => api.generateCompanionStates(id, { required_only: false }))}>Make the missing clips</Button><Button variant="outline" disabled={!data.start_ready || running || data.counts.required_missing.length === 0} onClick={() => void start(() => api.generateCompanionStates(id, { required_only: true }))}>Make the required clips</Button></div>
    </section>
    {running ? <section aria-label="Clip run progress" className="flex flex-col gap-2"><p>{run?.label ?? data.run?.label ?? "Starting clip run"}</p><Progress value={run?.percent ?? data.run?.percent ?? 0} aria-label={run?.label ?? "Clip run progress"} /><Button type="button" variant="outline" onClick={() => void perform(async () => { await api.stopCompanionStateRun(id, runId!); setRunId(null); void client.invalidateQueries({ queryKey: key(id) }); })}>Stop</Button></section> : null}
    {runQuery.isError ? <Alert variant="destructive"><AlertDescription>{errorText(runQuery.error)}</AlertDescription></Alert> : null}
    <ul aria-label="Companion states" className={`grid list-none gap-4 p-0 ${GRID_COLUMNS.default}`}>{data.states.map((state, index) => <li key={state.id}><Card><CardContent><CompanionStateContents id={id} state={state} index={index} busy={running} startReady={data.start_ready} onAction={perform} onError={setError} /></CardContent></Card></li>)}</ul>
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
  </div>;
}
