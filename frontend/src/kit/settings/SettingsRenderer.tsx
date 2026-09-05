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

// The registry (unlike a scope's values) never varies by which
// SettingsRenderer is asking - every instance on the page wants the
// exact same GET /api/settings/registry response. A code review
// (2026-09-04, on SettingsPage.tsx gaining a second instance - person
// scope, alongside the original household one) found each instance
// fetching it independently with no cache between them: two identical
// registry requests on every Settings page visit, a duplication that
// only compounds as the Household/Profile picker (Rule 2's still-missing
// second real render site) adds more instances. Cached for the page
// session, not just deduped mid-flight: the registry is generated at
// build/dev time (spec/settings/keys.json), not something that changes
// while a household is looking at the Settings page.
let cachedRegistry: Promise<SettingsKey[]> | null = null;
function fetchRegistryCached(): Promise<SettingsKey[]> {
  if (!cachedRegistry) {
    cachedRegistry = api.settingsRegistry().catch((err: unknown) => {
      cachedRegistry = null; // a failed fetch shouldn't wedge every later instance - let the next one retry
      throw err;
    });
  }
  return cachedRegistry;
}

/** Test-only: cachedRegistry is module state, shared across every test in
 * a file unless reset between them. */
export function __resetSettingsRegistryCacheForTests(): void {
  cachedRegistry = null;
}

// docs/SETTINGS.md's generic renderer: "one declaration, one
// implementation," pointed at a scope. Two real instances now
// (SettingsPage.tsx: household, then person, 2026-09-04) - the central
// Household/Profile lists Rule 2 describes as a further, still-missing
// render site for the same component.
export function SettingsRenderer({ scope, scopeValue }: SettingsRendererProps) {
  const [registry, setRegistry] = useState<SettingsKey[] | null>(null);
  const [values, setValues] = useState<ResolvedSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setError(null);
    Promise.all([fetchRegistryCached(), api.settingsValues(scopeValue)])
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
        <Button variant="secondary" onClick={load}>
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
    <div className="flex flex-col gap-6 p-4">
      {error ? (
        <div className="rounded-[var(--radius)] bg-[hsl(var(--muted))] px-3 py-2 text-base text-[hsl(var(--destructive))]">
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
                  className="min-h-12 w-fit text-base text-[hsl(var(--muted-foreground))] hover:underline"
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
