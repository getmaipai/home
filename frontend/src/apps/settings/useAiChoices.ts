// AIMODELS-PAGE-01: the one read of /api/ai/choices that the page's summary and every job card share (same query key, so the
// cards and the summary never disagree). The cards refresh on their own bar only while a choice is installing (rule S6).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aiChoicesApi } from "@/lib/aiChoicesApi";

export const AI_CHOICES_KEY = ["ai", "choices"] as const;

export function useAiChoices() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: AI_CHOICES_KEY, queryFn: aiChoicesApi.overview,
    refetchInterval: (q) => (q.state.data?.cards?.some((card) => card.choices.some((choice) => choice.state === "installing")) ? 2000 : 30_000),
  });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: AI_CHOICES_KEY }); void queryClient.invalidateQueries({ queryKey: ["components"] }); };
  return { query, refresh };
}
