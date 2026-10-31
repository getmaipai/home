import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/ui/button";
import { groupSettings, sectionTitle, type SettingsGroup } from "@maipai/ui/src/settings/groupSettings";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { SettingField } from "@/shell/pages/settings/SettingField";
import { api, ApiError, type ResolvedSetting } from "@/lib/api";
import type { KitSettingsKey } from "@/shell/pages/settings/settingsViewer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";

interface SettingsRendererProps {
  scope: "household" | "person" | "device";
  /** The runtime scope string the API expects: "household" or
   * "person:<id>" (lib/settings.ts's parseScope). */
  scopeValue: string;
  /** STORE-PAGE-01: render only the named `lives_in` group(s) - a second
   * page (the Storage settings page) embedding just its own caps group
   * reuses this exact renderer rather than a hand copy of its Card/
   * SettingField loop. Omitted (every existing call site) renders
   * every eligible group, unchanged. */
  only?: readonly string[];
  includeKeys?: readonly string[];
  includeKeysByGroup?: Readonly<Record<string, readonly string[]>>;
  expandAdvanced?: boolean;
  titleOverrides?: Readonly<Record<string, string>>;
  plainRows?: boolean;
  mergeGroups?: boolean;
  /** Read one narrowly authorized setting when embedding a person control. */
  settingKey?: string;
  optionsFrom?: Readonly<Record<string, readonly { value: string; label: string }[]>>;
  includeExpert?: boolean;
}

const REGISTRY_QUERY_KEY = ["settings-registry"];

/** SHELL-05's own row (docs/plans/shell-on-shadcndashboard-2026-09-21.md's
 * plan row) - docs/SETTINGS.md's generic renderer ("one declaration, one
 * implementation") pointed at the template's own form primitives via
 * `SettingField`, reading `GET /api/settings/registry` and `GET /api/
 * settings`, writing through the existing `PUT`/`reset` routes -
 * `groupSettings()`/`sectionTitle()` are reused directly from
 * `@maipai/ui/src/settings/groupSettings` (pure grouping logic, no UI,
 * the identical rule docs/SETTINGS.md Rule 4 both renderers honor: three
 * disclosure levels, expert filtered out, advanced folds once a section
 * has three or more). Sections render as the template's own `Card`/
 * `CardHeader`/`CardTitle` (the same shipped shell every other `/`
 * page's own section heading already uses) in place of the kit's
 * `Section` primitive `SettingsRenderer.tsx` renders with. `honouredBy`
 * is always "home": this repo is Home, the same constant `SettingsPage.
 * tsx`'s own instances already pass. */
export function SettingsRenderer({ scope, scopeValue, only, includeKeys, includeKeysByGroup, expandAdvanced = false, titleOverrides = {}, plainRows = false, mergeGroups = false, settingKey, optionsFrom, includeExpert = false }: SettingsRendererProps) {
  // NOTIFY-SHARE-02: SettingField's own PersonMultiSelect control
  // needs the viewer's own id to drop from its option list -
  // `scopeValue` is already exactly "person:<id>" for a person-scope
  // render (every call site renders a person's
  // own settings only, never someone else's), so it's parsed here once
  // rather than threading a second prop through every call site.
  const selfPersonId = scope === "person" ? scopeValue.slice("person:".length) : undefined;
  const queryClient = useQueryClient();
  // SHELL-SEARCH-02: `?section=<group.id>` (a SettingsKey's own
  // `lives_in`, the identical id `groupSettings()` groups by below) -
  // scrolled to once the matching group's own Card actually exists in
  // the DOM, not on mount, since the registry/values queries above are
  // still loading then. A ref map, not `document.getElementById`: two
  // scopes (household/me) can each render a group sharing the same
  // `lives_in` id (a key can be declared at more than one scope), so
  // only THIS renderer's own DOM is ever a candidate, never whichever
  // scope's element the DOM happens to return first.
  const [searchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const groupRefs = useRef(new Map<string, HTMLDivElement>());
  // Holds the section this renderer already scrolled to, not a plain
  // "have we ever scrolled" boolean - a review caught the boolean
  // latching permanently true, so a SECOND search result naming a
  // different section, clicked without leaving Settings (react-router
  // never remounts this component for a search-params-only URL
  // change), was silently ignored.
  const scrolledToRef = useRef<string | null>(null);
  const registryQuery = useQuery<SettingsKey[]>({
    queryKey: REGISTRY_QUERY_KEY,
    queryFn: () => api.settingsRegistry(),
    staleTime: Infinity,
  });
  const valuesQuery = useQuery<ResolvedSetting[]>({
    queryKey: settingKey ? ["settings-values", scopeValue, settingKey] : ["settings-values", scopeValue],
    queryFn: () => api.settingsValues(scopeValue, settingKey),
  });

  const [writeError, setWriteError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});
  const [removal, setRemoval] = useState<{ key: string; value: unknown; message: string } | null>(null);

  function replaceValue(next: ResolvedSetting) {
    queryClient.setQueryData<ResolvedSetting[]>(settingKey ? ["settings-values", scopeValue, settingKey] : ["settings-values", scopeValue], (prev) => (prev ?? []).map((v) => (v.key === next.key ? next : v)));
  }

  async function handleChange(key: string, value: unknown): Promise<boolean> {
    setPendingKey(key);
    setWriteError(null);
    try {
      let updated: ResolvedSetting;
      try { updated = await api.setSetting(scopeValue, key, value); }
      catch (first) {
        // CAP-GATE-01: turning a role off names the packages it removes; the
        // person confirms before anything is uninstalled.
        if (first instanceof ApiError && first.message.includes("users will lose access")) {
          setRemoval({ key, value, message: first.message });
          return false;
        }
        else throw first;
      }
      replaceValue(updated);
      if (key === "persona.active_id" && selfPersonId) void queryClient.invalidateQueries({ queryKey: ["companion-avatar", selfPersonId] });
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
      if (key === "persona.active_id" && selfPersonId) void queryClient.invalidateQueries({ queryKey: ["companion-avatar", selfPersonId] });
    } catch (e) {
      setWriteError(e instanceof ApiError ? e.message : "Could not reset that setting.");
    } finally {
      setPendingKey(null);
    }
  }

  const error = registryQuery.isError || valuesQuery.isError;
  const data = registryQuery.data && valuesQuery.data ? { registry: registryQuery.data, values: valuesQuery.data } : undefined;

  // Runs after every render once data has loaded (no dependency array):
  // the group Card a caller wants exists only once `groups.map()` above
  // has actually run. `scrolledToRef` makes this scroll to a given
  // `sectionParam` at most once (never re-scrolling on the renderer's
  // own later, unrelated re-renders - a value edit, a reset) while
  // still scrolling again when `sectionParam` itself changes to a
  // DIFFERENT section, a second search result clicked without leaving
  // Settings.
  useEffect(() => {
    if (!sectionParam || scrolledToRef.current === sectionParam || !data) return;
    const el = groupRefs.current.get(sectionParam);
    if (!el) return;
    scrolledToRef.current = sectionParam;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  return (
    <div className="flex flex-col gap-4">
      <AlertDialog open={removal !== null} onOpenChange={(open) => { if (!open) setRemoval(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn this feature off?</AlertDialogTitle>
            <AlertDialogDescription>{removal?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (!removal) return;
              const pending = removal;
              setRemoval(null);
              setPendingKey(pending.key);
              setWriteError(null);
              try { replaceValue(await api.setSetting(scopeValue, pending.key, pending.value, true)); }
              catch (e) { setWriteError(e instanceof ApiError ? e.message : "Could not save that change."); }
              finally { setPendingKey(null); }
            }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          const renderableRegistry = registry.filter((key) => key.selector !== "location" || key.key === "household.home") as KitSettingsKey[];
          const allGroups: SettingsGroup[] = groupSettings(renderableRegistry, values, scope, "home", includeExpert);
          let groups = (only ? allGroups.filter((g) => only.includes(g.id)) : allGroups).map((group) => {
            const companionsVisible = values.find((value) => value.key === "companions.allowed")?.value !== false;
            const eligible = (item: (typeof group.basic)[number]) =>
              (item.def.key !== "companions.allowed" || settingKey === "companions.allowed")
              && (companionsVisible || item.def.key !== "persona.active_id");
            const keys = includeKeysByGroup?.[group.id] ?? includeKeys;
            const basic = group.basic.filter(eligible);
            const advanced = group.advanced.filter(eligible);
            return keys ? { ...group, basic: basic.filter((item) => keys.includes(item.def.key)), advanced: advanced.filter((item) => keys.includes(item.def.key)) } : { ...group, basic, advanced };
          }).filter((group) => group.basic.length + group.advanced.length > 0);
          if (mergeGroups && groups.length > 1) {
            const first = groups[0];
            if (first) groups = [{ ...first, basic: groups.flatMap((group) => group.basic), advanced: groups.flatMap((group) => group.advanced), foldAdvanced: false }];
          }
          return groups.length === 0 ? (
            <EmptyState icon="inbox" text="No settings yet." />
          ) : (
            <>
              {groups.map((group) => plainRows ? (
                <div key={group.id} id={`settings-${group.id}`} className="flex flex-col divide-y divide-border">
                  {group.basic.map((s) => <SettingField key={s.def.key} setting={s} onChange={(v) => handleChange(s.def.key, v)} onReset={() => handleReset(s.def.key)} disabled={pendingKey === s.def.key} selfPersonId={selfPersonId} optionsFrom={optionsFrom} />)}
                  {group.advanced.map((s) => <SettingField key={s.def.key} setting={s} onChange={(v) => handleChange(s.def.key, v)} onReset={() => handleReset(s.def.key)} disabled={pendingKey === s.def.key} selfPersonId={selfPersonId} optionsFrom={optionsFrom} />)}
                </div>
              ) : (
                <Card
                  key={group.id}
                  // Scroll target named "settings-<group id>", so a test
                  // can stub scrollIntoView and assert on `this.id`.
                  id={`settings-${group.id}`}
                  ref={(el) => {
                    if (el) groupRefs.current.set(group.id, el);
                    else groupRefs.current.delete(group.id);
                  }}
                >
                  <CardHeader>
                    <CardTitle>{titleOverrides[group.id] ?? sectionTitle(group.id)}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col divide-y divide-border">
                    {group.basic.map((s) => (
                      <SettingField key={s.def.key} setting={s} onChange={(v) => handleChange(s.def.key, v)} onReset={() => handleReset(s.def.key)} disabled={pendingKey === s.def.key} selfPersonId={selfPersonId} optionsFrom={optionsFrom} />
                    ))}
                    {group.advanced.length > 0 ? (
                      group.foldAdvanced && !expandAdvanced && !advancedOpen[group.id] ? (
                        <div className="flex pt-3">
                          <Button
                            type="button"
                            variant="link"
                            onClick={() => setAdvancedOpen((prev) => ({ ...prev, [group.id]: true }))}
                          >
                            Show {group.advanced.length} advanced settings
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col divide-y divide-border border-t border-border pt-1">
                          {group.advanced.map((s) => (
                            <SettingField key={s.def.key} setting={s} onChange={(v) => handleChange(s.def.key, v)} onReset={() => handleReset(s.def.key)} disabled={pendingKey === s.def.key} selfPersonId={selfPersonId} optionsFrom={optionsFrom} />
                          ))}
                        </div>
                      )
                    ) : null}
                    </div>
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
