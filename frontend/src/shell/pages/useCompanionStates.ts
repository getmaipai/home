import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";

export const companionStatesKey = (id: string) => ["companions", id, "states"] as const;
export const companionAppearanceKey = (id: string) => ["companion-appearance", id] as const;
const networkError = "Could not reach Home. Check your connection and try again.";
const errorText = (error: unknown) => error instanceof ApiError ? error.message : networkError;

export function useCompanionStates(id: string, active: boolean) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: companionStatesKey(id), queryFn: () => api.companionStates(id), enabled: active, retry: false, refetchInterval: (current) => document.hidden ? false : current.state.data?.busy ? 2000 : false });
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [publishing, setPublishing] = useState(false);
  const data = query.data;
  useEffect(() => { if (data?.run?.job) setRunId(data.run.job); }, [data?.run?.job]);
  const runQuery = useQuery({ queryKey: [...companionStatesKey(id), "run", runId], queryFn: () => api.companionStateRun(id, runId!), enabled: active && !!runId, retry: false, refetchInterval: (current) => document.hidden ? false : current.state.data?.state === "queued" || current.state.data?.state === "running" || current.state.data === undefined ? 2000 : false });
  const run = runQuery.data;
  const running = !!runId && (!run || run.state === "queued" || run.state === "running");
  useEffect(() => {
    if (run && ["done", "failed", "cancelled"].includes(run.state)) {
      if (run.error) setError(run.error);
      setRunId(null);
      void Promise.all([client.invalidateQueries({ queryKey: companionStatesKey(id) }), client.invalidateQueries({ queryKey: companionAppearanceKey(id) })]);
    }
  }, [run, id, client]);
  const perform = useCallback(async (action: () => Promise<unknown>) => {
    setError("");
    try { await action(); await Promise.all([client.invalidateQueries({ queryKey: companionStatesKey(id) }), client.invalidateQueries({ queryKey: companionAppearanceKey(id) })]); }
    catch (cause) { setError(errorText(cause)); }
  }, [client, id]);
  async function start(action: () => Promise<{ job: string }>) {
    setError("");
    try { setRunId((await action()).job); }
    catch (cause) { setError(errorText(cause)); }
  }
  async function publish() {
    setError(""); setStatus(""); setPublishing(true);
    try {
      await api.publishCompanionAppearance(id);
      await Promise.all([
        client.invalidateQueries({ queryKey: companionAppearanceKey(id) }),
        client.invalidateQueries({ queryKey: companionStatesKey(id) }),
        client.invalidateQueries({ queryKey: ["companion-avatar"] }),
      ]);
      setStatus("Appearance published.");
    } catch (cause) {
      if (cause instanceof ApiError && (cause.status === 409 || cause.status === 422)) {
        setError([...(cause.reasons?.length ? cause.reasons : [cause.message]), cause.next].filter(Boolean).join(" ") || "Publishing failed. Review the appearance and try again.");
      } else setError(errorText(cause));
    } finally { setPublishing(false); }
  }
  return { query, data, run, running, runQuery, error, setError, perform, start, adopt: setRunId, runId, status, publishing, publish, stop: async () => {
    if (!runId) return;
    await perform(async () => { await api.stopCompanionStateRun(id, runId); setRunId(null); void client.invalidateQueries({ queryKey: companionStatesKey(id) }); });
  } };
}
