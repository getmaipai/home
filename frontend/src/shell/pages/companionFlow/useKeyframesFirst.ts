import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type CompanionLookJob } from "@/lib/api";
import { companionStatesKey, type useCompanionStates } from "@/shell/pages/useCompanionStates";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";

type Plan = { ids: string[]; queue: string[]; jobId: string | null; starting: boolean };
const running = (job: CompanionLookJob | undefined) => job === undefined || job.state === "queued" || job.state === "running";

/**
 * Clip requests that make keyframes first. Home answers 409 needs_keyframe with the animations that lack a keyframe;
 * this makes those pictures one at a time (each job read through the existing look-job poll, no new loop), skips an
 * animation whose picture fails or is withheld, and then asks again for the rest.
 */
export function useKeyframesFirst(companionId: string, states: ReturnType<typeof useCompanionStates>) {
  const client = useQueryClient();
  const [plan, setPlanState] = useState<Plan | null>(null);
  const [failed, setFailedState] = useState<Record<string, string>>({});
  const planRef = useRef<Plan | null>(null), failedRef = useRef<Record<string, string>>({});
  const setPlan = (next: Plan | null) => { planRef.current = next; setPlanState(next); };
  const setFailed = (next: Record<string, string>) => { failedRef.current = next; setFailedState(next); };
  const jobId = plan?.jobId ?? null;
  const jobQuery = useQuery<CompanionLookJob>({
    queryKey: [...companionStatesKey(companionId), "keyframe-plan", jobId], queryFn: () => api.companionLookJob(companionId, jobId!), enabled: jobId !== null, retry: false,
    refetchInterval: (q) => document.hidden ? false : running(q.state.data) ? 1500 : false,
  });
  const job = jobQuery.data;

  /** Done with the first animation in the queue: record why it failed, then start the next or ask for the clips. */
  function pop(reason?: string) {
    const current = planRef.current;
    if (!current) return;
    if (reason) setFailed({ ...failedRef.current, [current.queue[0]!]: reason });
    const rest = current.queue.slice(1);
    if (rest.length) { setPlan({ ...current, queue: rest, jobId: null, starting: false }); return; }
    setPlan(null);
    const ready = current.ids.filter((state) => !failedRef.current[state]);
    if (ready.length) void ask(ready, true);
  }
  async function ask(ids: string[], retry: boolean) {
    states.setError("");
    try { states.adopt((await api.generateCompanionStates(companionId, { states: ids, count: 1 })).job); }
    catch (cause) {
      if (!retry && cause instanceof ApiError && cause.code === "needs_keyframe" && cause.missingKeyframes?.length) {
        setPlan({ ids, queue: cause.missingKeyframes, jobId: null, starting: false });
      } else states.setError(flowErrorText(cause));
    }
  }
  /** Ask for clips for these animations; if some lack a keyframe, those pictures come first. */
  function request(ids: string[]) {
    const next = { ...failedRef.current }; for (const id of ids) delete next[id];
    setFailed(next);
    void ask(ids, false);
  }

  useEffect(() => {
    if (!plan || plan.jobId !== null || plan.starting || plan.queue.length === 0) return;
    setPlan({ ...plan, starting: true });
    api.generateCompanionKeyframe(companionId, plan.queue[0]!).then(
      ({ job: made }) => { const now = planRef.current; if (now) setPlan({ ...now, jobId: made }); },
      (cause: unknown) => {
        // Another picture is still being made: wait and try this one again, never show that to the person.
        if (cause instanceof ApiError && cause.status === 409) { setTimeout(() => { const now = planRef.current; if (now) setPlan({ ...now, starting: false }); }, 2500); return; }
        pop(flowErrorText(cause));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  useEffect(() => {
    if (!job || jobId === null || planRef.current?.jobId !== jobId) return;
    if (job.state === "done") { void client.invalidateQueries({ queryKey: companionStatesKey(companionId) }); pop(); }
    else if (job.state === "failed") { void client.invalidateQueries({ queryKey: companionStatesKey(companionId) }); pop(job.error ?? "That picture could not be made. Try again."); }
    else if (job.state === "cancelled") pop("That picture was stopped. Try again.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, jobId]);

  /** Stops the pictures being made for a clip request: the one under way is cancelled and the rest of the queue is dropped. */
  function stop() {
    const current = planRef.current; setPlan(null);
    if (current?.jobId) void api.cancelCompanionLookJob(companionId, current.jobId).catch(() => undefined);
  }
  return { request, stop, ids: plan?.ids ?? [], busy: plan !== null, making: plan?.queue[0] ?? null, waiting: plan?.queue.slice(1) ?? [], percent: job?.percent ?? 0, failed };
}
