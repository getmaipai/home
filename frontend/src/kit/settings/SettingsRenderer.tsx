import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type SettingsKey, type ResolvedSetting } from "@/lib/api";
import { groupSettings, sectionTitle, type SettingsGroup } from "@/kit/settings/groupSettings";
import { SettingField } from "@/kit/settings/SettingField";
import { Progress } from "@/kit/primitives/Progress";
import { Section } from "@/kit/primitives/Section";
import { Button } from "@/kit/components/Button";

interface SettingsRendererProps {
  scope: "household" | "person" | "device";
  /** The runtime scope string the API expects: "household",
   * "person:<id>", or "device:<id>" (lib/settings.ts's parseScope). */
  scopeValue: string;
}

// docs/SETTINGS.md's generic renderer: "one declaration, one
// implementation," pointed at a scope. Tonight this is invoked from
// exactly one place (SettingsPage.tsx, household scope) - the central
// Household/Profile lists Rule 2 describes as a second render site for
// the same component don't exist yet (no Household or Profile page has
// been built), so that reuse is real but currently unexercised, the same
// "typed, one caller so far" posture the rest of this codebase uses.
export function SettingsRenderer({ scope, scopeValue }: SettingsRendererProps) {
  const [registry, setRegistry] = useState<SettingsKey[] | null>(null);
  const [values, setValues] = useState<ResolvedSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.settingsRegistry(), api.settingsValues(scopeValue)])
      .then(([reg, vals]) => {
        setRegistry(reg);
        setValues(vals);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load settings."));
  }, [scopeValue]);

  useEffect(load, [load]);

  function replaceValue(next: ResolvedSetting) {
    setValues((prev) => (prev ?? []).map((v) => (v.key === next.key ? next : v)));
  }

  // Returns whether the write actually landed: a code review (2026-09-04)
  // found SettingField had no way to know a commit failed, so a rejected
  // value (below a key's min, etc.) stayed showing in the input forever -
  // resolved.value never changes on failure, so the resync effect keyed
  // on it never fires either. SettingField reverts its own draft when
  // this comes back false.
  async function handleChange(key: string, value: unknown): Promise<boolean> {
    setPendingKey(key);
    setError(null);
    try {
      const updated = await api.setSetting(scopeValue, key, value);
      replaceValue(updated);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save that change.");
      return false;
    } finally {
      setPendingKey(null);
    }
  }

  async function handleReset(key: string) {
    setPendingKey(key);
    setError(null);
    try {
      // A code review (2026-09-04) found this used to ignore the reset
      // response and re-fetch the whole scope just to learn the value it
      // already knew was the registry default; the route now returns it
      // directly (backend/src/lib/settings.ts's resetValue), symmetric
      // with setSetting.
      const restored = await api.resetSetting(scopeValue, key);
      replaceValue(restored);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reset that setting.");
    } finally {
      setPendingKey(null);
    }
  }

  if (error && registry === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-base text-[hsl(var(--destructive))]">{error}</p>
        <Button variant="secondary" size="sm" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  if (registry === null || values === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Progress mode="spinner" label="Loading settings" />
      </div>
    );
  }

  const groups: SettingsGroup[] = groupSettings(registry, values, scope);

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
      {error ? (
        <div className="rounded-[var(--radius)] bg-[hsl(var(--muted))] px-3 py-2 text-sm text-[hsl(var(--destructive))]">
          {error}
        </div>
      ) : null}
      {groups.length === 0 ? (
        <p className="text-base text-[hsl(var(--muted-foreground))]">No settings yet.</p>
      ) : (
        groups.map((group) => (
          <Section key={group.id} heading={sectionTitle(group.id)}>
            <div className="divide-y divide-[hsl(var(--border))]">
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
              group.foldAdvanced && !advancedOpen[group.id] ? (
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((prev) => ({ ...prev, [group.id]: true }))}
                  className="w-fit text-sm text-[hsl(var(--muted-foreground))] hover:underline"
                >
                  Show {group.advanced.length} advanced settings
                </button>
              ) : (
                <div className="divide-y divide-[hsl(var(--border))] border-t border-[hsl(var(--border))] pt-1">
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
        ))
      )}
    </div>
  );
}
