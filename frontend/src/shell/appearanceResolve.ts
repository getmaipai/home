/** The one definition of "what does `ui.appearance` (person scope,
 * backend/src/settings/uiKeys.ts) resolve to on screen" - pulled out of
 * `useAppearance.ts` (a code review on FACE-02J, 2026-09-29: a
 * shell-less route needed the identical computation but can't call that
 * hook directly, since it also depends on the vendored `useTheme()` and
 * a `<ThemeProvider>` ancestor that route never mounts. Before this,
 * the old, no-longer-called `@/shell/useAppearance.ts` already carried
 * its own third copy of the same few lines - org standard 1 ("one
 * definition, one implementation, one store") the reason this is a
 * shared module now, not a second inline copy). */
export type Appearance = "system" | "light" | "dark";

export function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

/** "system" resolves against the OS media query; "light"/"dark" are the
 * person's own explicit override. Matches `useAppearance.ts`'s own
 * paint effect and the old `useAppearance.ts`'s `applyAppearance`,
 * byte-for-byte. */
export function resolveDark(appearance: Appearance, systemPrefersDark: boolean): boolean {
  return appearance === "dark" || (appearance === "system" && systemPrefersDark);
}

/** Finds `ui.appearance` in a `GET /api/settings?scope=...` response and
 * falls back to "system" for a missing or corrupt value - the other
 * half of `useAppearance.ts`'s own resolution `usePaintAppearance-
 * ForShellLessRoute` (FaceEnrollmentPage.tsx) needed too (a second
 * review on FACE-02J, 2026-09-29: the first version of that hook left
 * this half inline instead of sharing it here alongside `resolveDark`).
 * `values` is `undefined` while the settings-values query hasn't
 * resolved yet - kept distinct from a resolved "system" default by the
 * caller, the same "not yet known" state `useAppearance.ts` tracks
 * with its own `appearance: Appearance | undefined`. */
export function pickAppearance(values: { key: string; value: unknown }[] | undefined): Appearance | undefined {
  if (!values) return undefined;
  const found = values.find((v) => v.key === "ui.appearance")?.value;
  return isAppearance(found) ? found : "system";
}

/** Device preference wins when present; `null` means use the person's setting. */
export function resolveAppearance(person: Appearance, device: Appearance | null): Appearance {
  return device ?? person;
}
