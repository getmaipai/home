import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ResolvedSetting, type Roster } from "@/lib/api";
import { getDeviceSettingsScope } from "@/lib/deviceSettingsScope";
import { meetsMinRole } from "@/apps/people/roles";

export const WAKEWORD_SETTING_KEY = "voice.wakeword.enabled";
const REGISTRY_QUERY_KEY = ["settings-registry"] as const;

/** The composer and generic SettingsRenderer share the same device scope and
 * React Query value row; this hook only supplies the composer/controller
 * behavior around that shared registry setting. */
export function useDeviceWakeWordSetting(person: Roster) {
  const scopeValue = useMemo(() => getDeviceSettingsScope(), []);
  const queryClient = useQueryClient();
  const adult = meetsMinRole(person.role, "adult");
  const registryQuery = useQuery({
    queryKey: REGISTRY_QUERY_KEY,
    queryFn: () => api.settingsRegistry(),
  });
  const assetQuery = useQuery({
    queryKey: ["wakeword-assets"],
    queryFn: () => api.wakewordStatus(),
  });
  const available = assetQuery.data?.installed === true && Array.isArray(registryQuery.data) && registryQuery.data.some((entry) => entry.key === WAKEWORD_SETTING_KEY);
  const valuesQuery = useQuery({
    queryKey: ["settings-values", scopeValue],
    queryFn: () => api.settingsValues(scopeValue),
    enabled: adult && available,
  });
  const setting = valuesQuery.data?.find((entry) => entry.key === WAKEWORD_SETTING_KEY);
  const enabled = setting?.value === true;

  const setEnabled = useCallback(async (next: boolean): Promise<boolean> => {
    if (!adult || !available) return false;
    const oldRows = queryClient.getQueryData<ResolvedSetting[]>(["settings-values", scopeValue]);
    queryClient.setQueryData<ResolvedSetting[]>(["settings-values", scopeValue], (rows) =>
      (rows ?? []).map((row) => row.key === WAKEWORD_SETTING_KEY ? { ...row, value: next, source: "user" } : row),
    );
    try {
      const updated = await api.setSetting(scopeValue, WAKEWORD_SETTING_KEY, next);
      queryClient.setQueryData<ResolvedSetting[]>(["settings-values", scopeValue], (rows) =>
        (rows ?? []).map((row) => row.key === WAKEWORD_SETTING_KEY ? updated : row),
      );
      return true;
    } catch {
      if (oldRows) queryClient.setQueryData(["settings-values", scopeValue], oldRows);
      return false;
    }
  }, [adult, available, queryClient, scopeValue]);

  return {
    adult,
    available,
    enabled,
    loading: registryQuery.isLoading || assetQuery.isLoading || (adult && available && valuesQuery.isLoading),
    scopeValue,
    setEnabled,
  };
}
