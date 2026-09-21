import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// HOME-UI-04b: widened to match ui.look's own enum (backend/src/
// settings/uiKeys.ts) - the seven shadcn base-color presets only have
// CSS on /next (useNextLook), never a `data-look` value here, so an
// old-shell person who picked one sees no change there until the old
// shell retires. HOME-UI-04e adds "navy" the same way. LOOK-01
// (2026-09-21, owner ruling - "the default is a named shadcn theme,
// not a Home name that hides what it is") drops "studio" and "calm":
// both were geometry presets over the one shared palette "neutral"
// (the new default) already renders byte-for-byte, so neither needs a
// preset of its own anymore, and the reference's own default geometry
// already matches what "studio" set. `isLook()` below still rejects a
// stale "studio"/"calm" the same as any other unrecognized value (the
// backend's own migration, db/migrations/
// 0057_look_studio_calm_to_neutral.sql, is the real fix for a stored
// row; this is just the ordinary "unrecognized value falls back to
// the default" path every other invalid value already took).
export const LOOKS = ["neutral", "stone", "zinc", "mauve", "olive", "mist", "taupe", "navy"] as const;
export type Look = (typeof LOOKS)[number];

function isLook(value: unknown): value is Look {
  return (LOOKS as readonly unknown[]).includes(value);
}

/** `ui.look` (person scope, backend/src/settings/uiKeys.ts): the owner's
 * LOOK-01 ruling (2026-09-21) - "Neutral" (the reference's own default
 * shadcn theme, matched byte-for-byte) is the hub's own default; the
 * rest are shadcn's other base-color presets, plus "navy" (Home's own
 * former default). All eight resolve through one `data-look` attribute
 * on `<html>` here.
 *
 * Unlike `ui.appearance`'s own dedicated header control
 * (ThemeToggle.tsx), Look has no second control outside Settings > Me >
 * Appearance - so this reads the exact TanStack Query cache entry
 * `SettingsRenderer` already writes to (`["settings-values",
 * scopeValue]`, the same key HomePage.tsx's own `useHouseholdSettings`
 * shares for household scope) rather than a one-shot fetch of its own:
 * changing "Look" in Settings applies it live, in this same session,
 * with no reload and no second write path.
 *
 * The resolution itself (`useLookValue`) is shared with `@/next/
 * useNextLook.ts`: same setting, same cache entry, two different
 * mechanisms for applying it (this shell's `data-look` attribute vs.
 * the vendored template's `.style-<look>` body class) - one definition
 * of what `ui.look` resolves to, not two (getmaipai/CLAUDE.md: "a
 * settings key ... is declared exactly once"). */
export function useLookValue(personId: string): Look {
  const scopeValue = `person:${personId}`;
  const query = useQuery({
    queryKey: ["settings-values", scopeValue],
    queryFn: () => api.settingsValues(scopeValue),
  });
  const found = query.data?.find((v) => v.key === "ui.look")?.value;
  return isLook(found) ? found : "neutral";
}

export function useLook(personId: string): Look {
  const look = useLookValue(personId);

  useEffect(() => {
    document.documentElement.setAttribute("data-look", look);
  }, [look]);

  return look;
}
