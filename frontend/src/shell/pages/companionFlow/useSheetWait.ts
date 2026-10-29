import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CompanionLookJob } from "@/lib/api";
import { companionStatesKey } from "@/shell/pages/useCompanionStates";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";

/** Approving the picture makes the character sheet behind the scenes; this follows that job so the animations screen can wait for it, show how far it is and start again if it failed. */
export function useSheetWait(companionId: string, jobId: string | null, pictureId: string | null) {
  const client = useQueryClient();
  const [job, setJob] = useState<string | null>(jobId);
  const [error, setError] = useState("");
  const query = useQuery<CompanionLookJob>({
    queryKey: ["companions", companionId, "sheet-job", job], queryFn: () => api.companionLookJob(companionId, job!), enabled: job !== null, retry: false,
    refetchInterval: (q) => q.state.data && q.state.data.state !== "queued" && q.state.data.state !== "running" ? false : 2000,
  });
  const state = query.data?.state;
  useEffect(() => { if (state === "done") void client.invalidateQueries({ queryKey: companionStatesKey(companionId) }); }, [state, client, companionId]);
  const failed = state === "failed" || state === "cancelled" || query.isError;
  const waiting = job !== null && !failed && state !== "done";
  async function retry() {
    if (!pictureId) return;
    setError("");
    try { const result = await api.approveCompanionLook(companionId, pictureId); setJob(result.job); await client.invalidateQueries({ queryKey: companionStatesKey(companionId) }); }
    catch (e) { setError(flowErrorText(e)); }
  }
  const message = error || (failed ? (query.data?.error ?? (query.isError ? flowErrorText(query.error) : "The character could not be made ready. Try again.")) : "");
  return { waiting, failed, percent: query.data?.percent ?? 0, label: query.data?.label ?? "Getting your character ready", message, retry };
}
