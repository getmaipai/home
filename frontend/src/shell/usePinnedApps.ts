import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// `ui.pinned_apps` (person scope, backend/src/settings/uiKeys.ts): a JSON
// array of `NavEntry.to` values, in pin order. Read/write through
// TanStack Query rather than `useAppearance.ts`'s plain useState (step 2,
// written before the query layer existed in step 3): this setting has
// two independent write sites (Home's strip, and each app's own header
// pin toggle in Shell.tsx), and the query cache is what keeps them in
// sync without either one knowing the other exists.
const queryKey = (personId: string) => ["settings", "person", personId, "ui.pinned_apps"] as const;

function parsePinned(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function usePinnedApps(personId: string): {
  pinned: string[];
  isPinned: (navTo: string) => boolean;
  togglePin: (navTo: string) => void;
  isLoading: boolean;
} {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKey(personId),
    queryFn: async () => {
      const values = await api.settingsValues(`person:${personId}`);
      return parsePinned(values.find((v) => v.key === "ui.pinned_apps")?.value);
    },
  });

  const mutation = useMutation({
    mutationFn: (next: string[]) => api.setSetting(`person:${personId}`, "ui.pinned_apps", JSON.stringify(next)),
    // Optimistic: a pin toggle is a light, frequent, low-stakes action
    // (unlike a destructive batch action, which waits for the real
    // result) - the cache is set immediately so both the header button
    // and Home's strip update in the same frame the household member
    // clicks, and corrected if the write itself fails.
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: queryKey(personId) });
      const previous = queryClient.getQueryData<string[]>(queryKey(personId));
      queryClient.setQueryData(queryKey(personId), next);
      return { previous };
    },
    onError: (_err, _next, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey(personId), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKey(personId) }),
  });

  const pinned = query.data ?? [];

  function isPinned(navTo: string): boolean {
    return pinned.includes(navTo);
  }

  function togglePin(navTo: string): void {
    mutation.mutate(isPinned(navTo) ? pinned.filter((id) => id !== navTo) : [...pinned, navTo]);
  }

  return { pinned, isPinned, togglePin, isLoading: query.isLoading };
}
