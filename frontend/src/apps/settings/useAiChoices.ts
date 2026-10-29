// AIMODELS-PAGE-01: the one read of /api/ai/choices that the page's summary and every job card share (same query key, so the
// cards and the summary never disagree). The cards refresh on their own bar only while a choice is installing (rule S6).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aiChoicesApi } from "@/lib/aiChoicesApi";

export const AI_CHOICES_KEY = ["ai", "choices"] as const;

// The last answer this browser saw, drawn at once while the fresh one loads behind it: the page never waits blank on the engine's
// reply. Only the household's own AI cards, kept per browser (the route is for admins), and replaced by every fresh answer.
const STORE_KEY = "maipai.ai-choices.v1";
function storedOverview(): Awaited<ReturnType<typeof aiChoicesApi.overview>> | undefined {
  try { const raw = localStorage.getItem(STORE_KEY); const value = raw ? JSON.parse(raw) as { stack?: string } : null; return value?.stack === "ok" ? value as never : undefined; } catch { return undefined; }
}
async function readOverview() {
  const overview = await aiChoicesApi.overview();
  try { if (overview.stack === "ok") localStorage.setItem(STORE_KEY, JSON.stringify(overview)); } catch { /* a full or blocked store only means the next visit waits */ }
  return overview;
}

export function useAiChoices() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: AI_CHOICES_KEY, queryFn: readOverview, initialData: storedOverview, initialDataUpdatedAt: 0,
    refetchInterval: (q) => (q.state.data?.cards?.some((card) => card.choices.some((choice) => choice.state === "installing")) ? 2000 : 30_000),
  });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: AI_CHOICES_KEY }); void queryClient.invalidateQueries({ queryKey: ["components"] }); };
  return { query, refresh };
}
