import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type SignedInPerson } from "@/lib/api";
import { activateLocale } from "@/i18n";
import { installSettingCopyCache } from "@/lib/settingCopyCache";

type Values = Array<{ key: string; value: unknown }> | undefined;
const valueOf = (values: Values, key: string): unknown => values?.find((entry) => entry.key === key)?.value;

/** The person's own value, else the household's, else en-US ("household" is the sentinel for "follow the home"). */
export function chooseLocale(personValue: unknown, householdValue: unknown): string {
  if (typeof personValue === "string" && personValue !== "household") return personValue;
  return typeof householdValue === "string" ? householdValue : "en-US";
}

/** Signed out: the household language from the public GET /api/auth/locale. Signed in: the person's `person.locale`, else
 * `household.locale`; activated again, without a reload, whenever either setting's cached values change. */
export function usePersonLocale(person: Pick<SignedInPerson, "id"> | null | undefined, enabled = true): void {
  const queryClient = useQueryClient();
  const personId = person?.id;
  // The kit draws registry text as sent; this keeps the shared settings caches in the active language.
  useEffect(() => installSettingCopyCache(queryClient), [queryClient]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    // One activation at a time, in call order, so a slow chunk can never land after a newer choice.
    let queue: Promise<void> = Promise.resolve();
    const activate = (locale: string) => { queue = queue.then(() => activateLocale(locale)); };
    if (!personId) {
      void api.locale().then(({ locale }) => { if (current) activate(locale); }).catch(() => { if (current) activate("en-US"); });
      return () => { current = false; };
    }
    const personScope = `person:${personId}`;
    let personValue: unknown;
    let householdValue: unknown;
    // The settings caches are rewritten on every language change (installSettingCopyCache), which raises this subscriber again:
    // activating an unchanged choice would re-fire the language change and loop forever, so only a new choice activates.
    let lastChosen: string | undefined;
    const apply = () => {
      const chosen = chooseLocale(personValue, householdValue);
      if (chosen === lastChosen) return;
      lastChosen = chosen;
      activate(chosen);
    };
    void Promise.all([api.settingsValues(personScope, "person.locale"), api.settingsValues("household", "household.locale")])
      .then(([personValues, householdValues]) => {
        if (!current) return;
        personValue = valueOf(personValues, "person.locale");
        householdValue = valueOf(householdValues, "household.locale");
        apply();
      })
      .catch(() => { if (current) activate("en-US"); });
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.query.queryKey[0] !== "settings-values") return;
      const scope = event.query.queryKey[1];
      const values = event.query.state.data as Values;
      if (scope === personScope && valueOf(values, "person.locale") !== undefined) {
        personValue = valueOf(values, "person.locale");
        apply();
      } else if (scope === "household" && valueOf(values, "household.locale") !== undefined) {
        householdValue = valueOf(values, "household.locale");
        apply();
      }
    });
    return () => { current = false; unsubscribe(); };
  }, [personId, enabled, queryClient]);
}
