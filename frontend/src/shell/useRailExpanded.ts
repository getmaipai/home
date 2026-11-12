import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const key = (personId: string) => ["settings", "person", personId, "ui.rail_expanded"] as const;
const setting = "ui.rail_expanded";

export function useRailExpanded(personId: string): [boolean, (expanded: boolean) => void] {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["settings-values", `person:${personId}`], queryFn: () => api.settingsValues(`person:${personId}`) });
  const row = query.data?.find((item) => item.key === setting);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(row?.source === "user" && row.value === "true");
  }, [personId, row?.source, row?.value]);
  const mutation = useMutation({
    mutationFn: (next: boolean) => api.setSetting(`person:${personId}`, setting, String(next)),
    onMutate: async (next) => {
      await client.cancelQueries({ queryKey: key(personId) });
      const previous = client.getQueryData<Awaited<ReturnType<typeof api.settingsValues>>>(["settings-values", `person:${personId}`]);
      client.setQueryData(["settings-values", `person:${personId}`], (old: typeof previous) => [...(old ?? []).filter((item) => item.key !== setting), { key: setting, value: String(next), source: "user" }]);
      return { previous };
    },
    onError: (_error, _next, context) => client.setQueryData(["settings-values", `person:${personId}`], context?.previous),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: key(personId) });
    },
  });
  return [expanded, (next) => { setExpanded(next); mutation.mutate(next); }];
}
