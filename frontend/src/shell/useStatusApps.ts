import { useQuery } from "@tanstack/react-query";
import { api, type StatusAppsResponse } from "@/lib/api";

export const STATUS_APPS_QUERY_KEY = ["status-apps"] as const;

export function useStatusApps() {
  return useQuery<StatusAppsResponse>({
    queryKey: STATUS_APPS_QUERY_KEY,
    queryFn: () => api.statusApps(),
    retry: false,
    refetchInterval: (query) => query.state.data?.apps?.some((app) => app.state !== "operational") ? 5_000 : 15_000,
  });
}
