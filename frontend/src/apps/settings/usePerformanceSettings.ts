import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import { specDefault } from "@/apps/settings/performanceModel";

/** Household settings values for the Performance page: one read, one write path, spec defaults for anything unset. */
export function usePerformanceSettings() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["settings-values", "household"], queryFn: () => api.settingsValues("household") });
  const value = useCallback((key: string): unknown => settings.data?.find((setting) => setting.key === key)?.value ?? specDefault(key), [settings.data]);
  const write = useCallback(async (changes: Record<string, unknown>) => {
    for (const [key, next] of Object.entries(changes)) await api.setSetting("household", key, next);
    await client.invalidateQueries({ queryKey: ["settings-values", "household"] });
  }, [client]);
  return { ready: settings.isSuccess, value, write };
}

export interface RunningApps { installed: boolean; apps: { bundleId: string; name: string; bytes: number; frontmost: boolean }[] }
export function useRunningApps() {
  return useQuery({ queryKey: ["performance-apps"], queryFn: () => request<RunningApps>("/api/performance/apps").catch((): RunningApps => ({ installed: false, apps: [] })), staleTime: 15_000 });
}
