import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type SettingsKey, type ResolvedSetting } from "@/lib/api";
import { groupSettings, sectionTitle, type SettingsGroup, type MergedSetting } from "@/kit/settings/groupSettings";
import { SettingField } from "@/kit/settings/SettingField";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Section } from "@/kit/primitives/Section";
import { Button } from "@/kit/ui/button";

interface SettingsRendererProps {
  scope: "household" | "person" | "device";
  /** The runtime scope string the API expects: "household",
   * "person:<id>", or "device:<id>" (lib/settings.ts's parseScope). */
  scopeValue: string;
  /** Step 7's search filter over label and help text, lifted from
   * `SettingsPage.tsx`'s single search box rather than each renderer
   * instance keeping its own - one query, both scopes, the same box
   * VS Code's own Settings editor uses. Case-insensitive substring
   * match; a group with nothing matching renders nothing at all, and a
   * match inside a folded advanced key surfaces it directly rather than
   * leaving it hidden behind "Show N advanced settings". */
  filter?: string;
}

// The registry (unlike a scope's values) never varies by which
// SettingsRenderer is asking - every instance on the page wants the
// exact same GET /api/settings/registry response. A code review
// (2026-09-04, on SettingsPage.tsx gaining a second instance - person
// scope, alongside the original household one) found each instance
// fetching it independently with no cache between them. The data layer
// (docs/plans/session-b-ui.md step 3) owns this now: one query key,
// `staleTime: Infinity` since the registry is generated at build/dev time
// (spec/settings/keys.json) and never changes while a household is
// looking at the page, shared by every SettingsRenderer instance through
// the app's one QueryClient rather than a hand-rolled module-level
// promise cache.
const REGISTRY_QUERY_KEY = ["settings-registry"];

// docs/SETTINGS.md's generic renderer: "one declaration, one
// implementation," pointed at a scope. Two real instances now
// (SettingsPage.tsx: household, then person, 2026-09-04) - the central
// Household/Profile lists Rule 2 describes as a further, still-missing
// render site for the same component.
export function SettingsRenderer({ scope, scopeValue, filter }: SettingsRendererProps) {
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
    queryClient.setQueryData<ResolvedSetting[]>(["settings-values", scopeValue], (prev) =>
      (prev ?? []).map((v) => (v.key === next.key ? next : v)),
    );
  }

  // Returns whether the write actually landed: a code review (2026-09-04)
  // found SettingField had no way to know a commit failed, so a rejected
  // value (below a key's min, etc.) stayed showing in the input forever -
  // resolved.value never changes on failure, so the resync effect keyed
  // on it never fires either. SettingField reverts its own draft when
  // this comes back false.
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
      // A code review (2026-09-04) found this used to ignore the reset
      // response and re-fetch the whole scope just to learn the value it
      // already knew was the registry default; the route now returns it
      // directly (backend/src/lib/settings.ts's resetValue), symmetric
      // with setSetting.
      const restored = await api.resetSetting(scopeValue, key);
      replaceValue(restored);
    } catch (e) {
      setWriteError(e instanceof ApiError ? e.message : "Could not reset that setting.");
    } finally {
      setPendingKey(null);
    }
  }

  const error = registryQuery.isError || valuesQuery.isError;
  const data =
    registryQuery.data && valuesQuery.data ? { registry: registryQuery.data, values: valuesQuery.data } : undefined;

  // Found live in the browser (2026-09-05, while checking that the new
  // persona.active_id setting actually renders): `flex-1 overflow-y-auto`
  // here turns this component into its own independently-scrolling
  // region - harmless with exactly one instance on a page, but
  // SettingsPage.tsx renders TWO (household scope, then person scope) as
  // plain flex-col siblings, so the two `flex-1` boxes split the SAME
  // available height between them. With enough real settings (this
  // session added a fourth household.ai key's own section AND the new
  // person.persona one), the person-scope instance's box collapsed to
  // ~32px - its content didn't disappear, it was real and hit-testable,
  // just clipped to a sliver and scrollable only within that tiny box,
  // never the page. This component doesn't need to scroll itself at
  // all: the actual page-level container SettingsPage.tsx renders it
  // inside already provides the real scrolling.
  return (
    <div className="flex flex-col gap-4">
      {writeError ? (
        <div className="rounded-lg bg-muted px-3 py-2 text-base text-destructive">{writeError}</div>
      ) : null}
      <AsyncState
        data={data}
        error={error}
        isFetching={registryQuery.isFetching || valuesQuery.isFetching}
        onRetry={() => {
          // Only the query that actually failed, not both unconditionally
          // (a code review, 2026-09-05, caught the registry - staleTime:
          // Infinity, so it succeeds once and never needs retrying again
          // - being re-fetched every time only the values query failed).
          if (registryQuery.isError) registryQuery.refetch();
          if (valuesQuery.isError) valuesQuery.refetch();
        }}
        errorMessage="Could not load settings."
        loadingLabel="Loading settings"
      >
        {({ registry, values }) => {
          const groups: SettingsGroup[] = groupSettings(registry, values, scope);
          const needle = filter?.trim().toLowerCase();
          const matches = (s: MergedSetting) =>
            !needle || s.def.label.toLowerCase().includes(needle) || (s.def.help?.toLowerCase().includes(needle) ?? false);
          const visibleGroups = needle
            ? groups
                .map((g) => ({ ...g, basic: g.basic.filter(matches), advanced: g.advanced.filter(matches) }))
                .filter((g) => g.basic.length > 0 || g.advanced.length > 0)
            : groups;
          return visibleGroups.length === 0 ? (
            <p className="text-base text-muted-foreground">
              {needle ? "No settings match that search." : "No settings yet."}
            </p>
          ) : (
            <>
              {visibleGroups.map((group) => (
                <Section key={group.id} id={`settings-${group.id}`} heading={sectionTitle(group.id)}>
                  <div className="divide-y divide-border">
                    {group.basic.map((s) => (
                      <SettingField
                        key={s.def.key}
                        setting={s}
                        onChange={(v) => handleChange(s.def.key, v)}
                        onReset={() => handleReset(s.def.key)}
                        disabled={pendingKey === s.def.key}
                      />
                    ))}
                  </div>
                  {group.advanced.length > 0 ? (
                    // A search match inside a folded advanced key has to
                    // surface directly - hiding it behind "Show N advanced
                    // settings" after the household member just searched
                    // for it would defeat the search entirely.
                    group.foldAdvanced && !advancedOpen[group.id] && !needle ? (
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => setAdvancedOpen((prev) => ({ ...prev, [group.id]: true }))}
                        className="h-auto min-h-12 w-fit text-muted-foreground"
                      >
                        Show {group.advanced.length} advanced settings
                      </Button>
                    ) : (
                      <div className="divide-y divide-border border-t border-border pt-1">
                        {group.advanced.map((s) => (
                          <SettingField
                            key={s.def.key}
                            setting={s}
                            onChange={(v) => handleChange(s.def.key, v)}
                            onReset={() => handleReset(s.def.key)}
                            disabled={pendingKey === s.def.key}
                          />
                        ))}
                      </div>
                    )
                  ) : null}
                </Section>
              ))}
            </>
          );
        }}
      </AsyncState>
    </div>
  );
}
