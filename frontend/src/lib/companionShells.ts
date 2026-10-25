import { useQuery } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { createContext, useContext } from "react";

export const CompanionShellViewer = createContext<Roster | null>(null);

/** Returns undefined while the viewer's setting is loading; every other unresolved or unavailable case fails closed. */
export function useCompanionShells(): boolean | undefined {
  const person = useContext(CompanionShellViewer);
  const id = person?.id;
  const query = useQuery({
    queryKey: ["settings-values", "household", "companions.preview_shells"],
    queryFn: () => api.settingsValues("household", "companions.preview_shells"),
    enabled: Boolean(id),
    retry: false,
  });
  if (!id || query.isError) return false;
  if (query.data === undefined) return undefined;
  return query.data.find((setting) => setting.key === "companions.preview_shells")?.value === true;
}
