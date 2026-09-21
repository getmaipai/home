import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@maipai/ui/src/dashboard/context/shadcntheme/ThemeContext";
import { api, type ResolvedSetting } from "@/lib/api";

type Appearance = "system" | "light" | "dark";

function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

/** `ui.appearance` (person scope, backend/src/settings/uiKeys.ts) fed
 * into the vendored template's own ThemeProvider on `/next`
 * (mounted in NextRoutes.tsx) - HOME-UI-04d's own name, "one theme
 * writer": the provider is the only thing that ever writes `.dark`/
 * `.light` on `<html>` here (its own effect, unedited), never this
 * hook directly and never `@/shell/useAppearance.ts` (NextRoutes
 * stops calling it - the two writers disagreeing, one from the
 * setting and one from `prefers-color-scheme`, was the bug: the
 * header's logo and every other `dark:*` utility follow the
 * provider's class, the kit's own tokens.css variables followed the
 * media query instead, and they only agreed when the setting already
 * matched the OS). This hook only keeps the setting and the
 * provider's own state in sync, in both directions: the setting
 * seeds the provider on load and after any change made elsewhere
 * (Settings > Me > Appearance), and the header's own Light-Dark
 * toggle - which only calls the provider's `setTheme`, per the
 * template's own file, never told about the setting - gets its
 * choice written back so a reload sees the same one.
 *
 * Named gap, found in review: `ui.appearance = "system"` doesn't
 * live-track the OS if it changes while `/next` is already open. The
 * provider's own effect (unedited, ThemeContext.tsx) keys only on its
 * `theme` state (`"system"` itself, unchanged), never on the media
 * query firing - `@/shell/useAppearance.ts`'s live `matchMedia`
 * listener has no equivalent here, and adding one would mean writing
 * the class from a second place, exactly the "two writers" bug this
 * item exists to remove. Self-corrects on the next reload or
 * navigation, which re-seeds the provider fresh; not part of this
 * item's own acceptance (an explicit light/dark choice against a
 * mismatched OS, which is real-time correct either way). */
export function useNextAppearance(personId: string): void {
  const scopeValue = `person:${personId}`;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["settings-values", scopeValue],
    queryFn: () => api.settingsValues(scopeValue),
  });
  // `undefined` (not yet resolved) is its own state, kept distinct
  // from the resolved "system" default - a review caught the earlier
  // version treating them the same, so the write-back effect below
  // could see the provider's own `localStorage`-seeded `theme` (a
  // bare, unscoped key - a stale value from a previous person on the
  // same shared household browser included) disagree with a fetch
  // that simply hadn't landed yet, and PUT that stale value over the
  // real setting before ever reading it.
  const found = query.data?.find((v) => v.key === "ui.appearance")?.value;
  const appearance: Appearance | undefined = query.data ? (isAppearance(found) ? found : "system") : undefined;

  const { theme, setTheme } = useTheme();
  // The last setting value this hook itself synced the provider to -
  // tells the one effect below whether `appearance` changing is the
  // setting moving (seed the provider) or just this hook's own last
  // write echoing back through the cache (settle quietly). One effect,
  // not two: a review caught the original two-effects version racing
  // within a single render - the write-back effect read that render's
  // still-stale `theme` even after the seed effect, running moments
  // earlier in the same flush, had already dispatched a `setTheme`
  // call whose result wouldn't land until the next render, so it PUT
  // the pre-seed `theme` as if it were a real toggle.
  const syncedTo = useRef<Appearance | undefined>(undefined);

  useEffect(() => {
    if (appearance === undefined) return;

    if (appearance !== syncedTo.current) {
      // The setting moved (first load, a change elsewhere, or our own
      // write echoing back through the cache) - seed the provider,
      // never treat this pass as a toggle to write back.
      syncedTo.current = appearance;
      if (theme !== appearance) setTheme(appearance);
      return;
    }

    // The setting hasn't moved since we last synced it, but the
    // provider's own theme now differs - only the header's Light-Dark
    // toggle (which calls the provider's `setTheme` directly, per
    // Light-Dark.tsx) does that. Write it back, updating the query
    // cache the same way SettingsRenderer's own successful writes do
    // (ui/src/settings/SettingsRenderer.tsx) so this effect sees its
    // own write on the next pass instead of racing a refetch.
    if (theme === appearance) return;
    api
      .setSetting(scopeValue, "ui.appearance", theme)
      .then((updated: ResolvedSetting) => {
        queryClient.setQueryData<ResolvedSetting[]>(["settings-values", scopeValue], (prev) =>
          (prev ?? []).map((v) => (v.key === updated.key ? updated : v)),
        );
      })
      .catch(() => {
        // The provider's own class change already applied optimistically;
        // a failed write just means it doesn't persist past this session.
      });
  }, [theme, appearance, scopeValue, queryClient, setTheme]);
}
