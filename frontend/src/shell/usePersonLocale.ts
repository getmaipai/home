import { useEffect, useState } from "react";
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

// One activation at a time, in call order, and only the newest request runs: a slow catalog chunk for an older choice (the household's)
// can never land after a newer one (the person's). Shared by every run of the hook, so a re-run on sign-in joins the same line.
let queue: Promise<void> = Promise.resolve();
let newest = 0;
function activateNewest(locale: string): Promise<void> {
  const mine = ++newest;
  queue = queue.then(() => (mine === newest ? activateLocale(locale) : undefined));
  return queue;
}
const FIRST_ACTIVATION_WAIT_MS = 4000;

/** Signed out (`null`): the household language from the public GET /api/auth/locale. Signed in: the person's `person.locale`, else
 * `household.locale`; activated again, without a reload, whenever either setting's cached values change. `undefined` means "not known
 * yet" and waits. Returns true once the first language is active (or after a short wait, or at once when `enabled` is false), so the
 * root can hold the router back and no page, `/setup` and the sign-in page included, first shows English and then flips. */
export function usePersonLocale(person: Pick<SignedInPerson, "id"> | null | undefined, enabled = true): boolean {
  const queryClient = useQueryClient();
  const personId = person?.id;
  const unknown = person === undefined;
  const [ready, setReady] = useState(!enabled);
  // The kit draws registry text as sent; this keeps the shared settings caches in the active language.
  useEffect(() => installSettingCopyCache(queryClient), [queryClient]);
  useEffect(() => {
    if (!enabled || unknown) return;
    let current = true;
    let first = true;
    const timer = setTimeout(() => setReady(true), FIRST_ACTIVATION_WAIT_MS);
    const activate = (locale: string) => {
      const done = activateNewest(locale);
      if (first) { first = false; void done.then(() => { if (current) setReady(true); }); }
    };
    if (!personId) {
      void api.locale().then(({ locale }) => { if (current) activate(locale); }).catch(() => { if (current) activate("en-US"); });
      return () => { current = false; clearTimeout(timer); };
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
    return () => { current = false; clearTimeout(timer); unsubscribe(); };
  }, [personId, unknown, enabled, queryClient]);
  return ready;
}
