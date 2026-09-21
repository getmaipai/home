import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { groupSettings, sectionTitle, type SettingsGroup } from "@maipai/ui/src/settings/groupSettings";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { NextSettingField } from "@/next/pages/settings/NextSettingField";
import { api, ApiError, type ResolvedSetting } from "@/lib/api";

interface NextSettingsRendererProps {
  scope: "household" | "person" | "device";
  /** The runtime scope string the API expects: "household" or
   * "person:<id>" (lib/settings.ts's parseScope). */
  scopeValue: string;
}

const REGISTRY_QUERY_KEY = ["settings-registry"];

/** SHELL-05's own row (docs/plans/shell-on-shadcndashboard-2026-09-21.md's
 * plan row) - docs/SETTINGS.md's generic renderer ("one declaration, one
 * implementation") pointed at the template's own form primitives via
 * `NextSettingField`, reading `GET /api/settings/registry` and `GET /api/
 * settings`, writing through the existing `PUT`/`reset` routes -
 * `groupSettings()`/`sectionTitle()` are reused directly from
 * `@maipai/ui/src/settings/groupSettings` (pure grouping logic, no UI,
 * the identical rule docs/SETTINGS.md Rule 4 both renderers honor: three
 * disclosure levels, expert filtered out, advanced folds once a section
 * has three or more). Sections render as the template's own `Card`/
 * `CardHeader`/`CardTitle` (the same shipped shell every other `/next`
 * page's own section heading already uses) in place of the kit's
 * `Section` primitive `SettingsRenderer.tsx` renders with. `honouredBy`
 * is always "home": this repo is Home, the same constant `SettingsPage.
 * tsx`'s own instances already pass. */
export function NextSettingsRenderer({ scope, scopeValue }: NextSettingsRendererProps) {
  const queryClient = useQueryClient();
  const registryQuery = useQuery<SettingsKey[]>({
    queryKey: REGISTRY_QUERY_KEY,
    queryFn: () => api.settingsRegistry(),
    staleTime: Infinity,
  });
  const valuesQuery = useQuery<ResolvedSetting[]>({
    queryKey: ["settings-values", scopeValue],
    queryFn: () => api.settingsValues(scopeValue),
  });

  const [writeError, setWriteError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});

  function replaceValue(next: ResolvedSetting) {
    queryClient.setQueryData<ResolvedSetting[]>(["settings-values", scopeValue], (prev) => (prev ?? []).map((v) => (v.key === next.key ? next : v)));
  }

  async function handleChange(key: string, value: unknown): Promise<boolean> {
    setPendingKey(key);
    setWriteError(null);
    try {
      const updated = await api.setSetting(scopeValue, key, value);
      replaceValue(updated);
      return true;
    } catch (e) {
      setWriteError(e instanceof ApiError ? e.message : "Could not save that change.");
      return false;
    } finally {
      setPendingKey(null);
    }
  }

  async function handleReset(key: string) {
    setPendingKey(key);
    setWriteError(null);
    try {
      const restored = await api.resetSetting(scopeValue, key);
      replaceValue(restored);
    } catch (e) {
      setWriteError(e instanceof ApiError ? e.message : "Could not reset that setting.");
    } finally {
      setPendingKey(null);
    }
  }

  const error = registryQuery.isError || valuesQuery.isError;
  const data = registryQuery.data && valuesQuery.data ? { registry: registryQuery.data, values: valuesQuery.data } : undefined;

  return (
    <div className="flex flex-col gap-4">
      {writeError ? <div className="rounded-lg bg-muted px-3 py-2 text-sm text-destructive">{writeError}</div> : null}
      <AsyncState
        data={data}
        error={error}
        isFetching={registryQuery.isFetching || valuesQuery.isFetching}
        onRetry={() => {
          if (registryQuery.isError) registryQuery.refetch();
          if (valuesQuery.isError) valuesQuery.refetch();
        }}
        errorMessage="Could not load settings."
        loadingLabel="Loading settings"
      >
        {({ registry, values }: { registry: SettingsKey[]; values: ResolvedSetting[] }) => {
          const groups: SettingsGroup[] = groupSettings(registry, values, scope, "home");
          return groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No settings yet.</p>
          ) : (
            <>
              {groups.map((group) => (
                <Card key={group.id}>
                  <CardHeader>
                    <CardTitle>{sectionTitle(group.id)}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col divide-y divide-border">
                    {group.basic.map((s) => (
                      <NextSettingField key={s.def.key} setting={s} onChange={(v) => handleChange(s.def.key, v)} onReset={() => handleReset(s.def.key)} disabled={pendingKey === s.def.key} />
                    ))}
                    {group.advanced.length > 0 ? (
                      group.foldAdvanced && !advancedOpen[group.id] ? (
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => setAdvancedOpen((prev) => ({ ...prev, [group.id]: true }))}
                          className="h-auto w-fit p-0 pt-3 text-muted-foreground"
                        >
                          Show {group.advanced.length} advanced settings
                        </Button>
                      ) : (
                        <div className="flex flex-col divide-y divide-border border-t border-border pt-1">
                          {group.advanced.map((s) => (
                            <NextSettingField key={s.def.key} setting={s} onChange={(v) => handleChange(s.def.key, v)} onReset={() => handleReset(s.def.key)} disabled={pendingKey === s.def.key} />
                          ))}
                        </div>
                      )
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </>
          );
        }}
      </AsyncState>
    </div>
  );
}
