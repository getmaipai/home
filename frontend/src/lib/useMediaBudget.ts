import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, type MediaBudgetResponse } from "@/lib/api";

export const mediaBudgetQueryKey = (personId: string) => ["media-budget", personId] as const;

/** Players pass each successful progress response's budget here, including offline batch replies.
 * No extra polling loop: progress is the clock. Keep the signed-in identity in the cache key. */
export function updateMediaBudget(client: QueryClient, personId: string, budget: MediaBudgetResponse): void {
  client.setQueryData(mediaBudgetQueryKey(personId), budget);
}

/** Until the signed-in person's budget is known, pause. A failed read never grants extra time.
 * A zero leftMinutes with exhausted=false means the server configured no limit. */
export function useMediaBudget(personId: string): { exhausted: boolean; leftMinutes: number } {
  const query = useQuery({
    queryKey: mediaBudgetQueryKey(personId), queryFn: () => api.mediaBudget(),
    enabled: personId.length > 0, staleTime: 0, retry: false,
    refetchOnMount: "always", refetchOnWindowFocus: "always",
  });
  if (!query.data || query.isError) return { exhausted: true, leftMinutes: 0 };
  return { exhausted: query.data.exhausted, leftMinutes: query.data.left_min };
}
