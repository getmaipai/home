import { useEffect } from "react";
import { api } from "@/lib/api";
import { activateLocale } from "@/i18n";

/** `household.locale` (backend/src/settings/coreKeys.ts) only means
 * anything once someone is signed in - there is no household to read a
 * preference from before that, so `@/i18n`'s own default (the source
 * locale) stays active for the sign-in screen itself. `enabled` (a
 * plain boolean, not the signed-in person object) is deliberate - a
 * code review (2026-09-06) found an earlier version depending on
 * `[person]` directly, which re-fired this fetch on every unrelated
 * settings save that produces a fresh `Roster` object (a profile edit,
 * a PIN change), refetching and reactivating the same already-active
 * locale each time. Household locale doesn't change per person anyway,
 * so "has anyone signed in yet" is the only real trigger this needs.
 * Mirrors `useAppearance.ts`'s own "fetch scope, find key, silently
 * ignore failure" shape - the same pattern, a household- rather than
 * person-scoped setting. */
export function useHouseholdLocale(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    api
      .settingsValues("household")
      .then((values) => {
        const locale = values.find((v) => v.key === "household.locale")?.value;
        if (typeof locale === "string") activateLocale(locale);
      })
      .catch(() => {
        // A failed read just keeps the default locale active, the same
        // fail-open shape `useAppearance.ts`'s own read has.
      });
  }, [enabled]);
}
