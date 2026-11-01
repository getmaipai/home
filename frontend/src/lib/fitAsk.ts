// TIER-PRIO-07: the two answers a held Boost or Max job's card offers when the level they picked is not ready.
// The card carries `fit_ask` only while the question is open and only for the job's owner or an admin.
import { toast } from "sonner";
import { requestJson } from "@/lib/api";
import type { PendingAction } from "@maipai/ui/src/elements/pending-actions";

export type FitAnswer = "allow" | "wait";

export const fitAskApi = {
  answer: (jobId: string, answer: FitAnswer) =>
    requestJson<{ answered: boolean }>(`/api/ai/jobs/${encodeURIComponent(jobId)}/fit-answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer }) }),
};

/** The error line: what went wrong and what to do. */
const FAILED = "Home could not send your answer. Check your connection and tap the button again.";
const LATE = "That question already closed. The job is moving on by itself, so there is nothing more to do.";

/** The two buttons, or undefined when the card is not asking this viewer. `refresh` reloads the card after the answer. */
export function fitAskActions(fitAsk: { job_id: string; picked?: string | null; actual?: string | null } | null | undefined, refresh: () => void): PendingAction[] | undefined {
  if (!fitAsk) return undefined;
  const send = (answer: FitAnswer) => () => {
    void fitAskApi.answer(fitAsk.job_id, answer)
      .then((result) => { if (!result.answered) toast.message(LATE); refresh(); })
      .catch(() => { toast.error(FAILED); refresh(); });
  };
  return [
    { label: `Make it now with ${fitAsk.actual ?? "Standard"}`, onSelect: send("allow"), variant: "default" },
    { label: fitAsk.picked ? `Wait for ${fitAsk.picked}` : "Wait for it", onSelect: send("wait") },
  ];
}
