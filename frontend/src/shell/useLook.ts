import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type Look = "calm" | "studio";

function isLook(value: unknown): value is Look {
  return value === "calm" || value === "studio";
}

/** `ui.look` (person scope, backend/src/settings/uiKeys.ts): the owner's
 * "Two looks, one setting" ruling (2026-09-20) - Studio (the reference's
 * own look, matched exactly) is the hub's default; Calm is the softer
 * look HOME-UI-01/02 shipped first. Both are the same components under
 * one `data-look` attribute on `<html>`; `tokens.css`'s `studio:`
 * variant and its look-scoped tokens key off it.
 *
 * Unlike `ui.appearance`'s own dedicated header control
 * (ThemeToggle.tsx), Look has no second control outside Settings > Me >
 * Appearance - so this reads the exact TanStack Query cache entry
 * `SettingsRenderer` already writes to (`["settings-values",
 * scopeValue]`, the same key HomePage.tsx's own `useHouseholdSettings`
 * shares for household scope) rather than a one-shot fetch of its own:
 * changing "Look" in Settings applies it live, in this same session,
 * with no reload and no second write path. */
export function useLook(personId: string): Look {
  const scopeValue = `person:${personId}`;
  const query = useQuery({
    queryKey: ["settings-values", scopeValue],
    queryFn: () => api.settingsValues(scopeValue),
  });
  const found = query.data?.find((v) => v.key === "ui.look")?.value;
  const look: Look = isLook(found) ? found : "studio";

  useEffect(() => {
    document.documentElement.setAttribute("data-look", look);
  }, [look]);

  return look;
}
