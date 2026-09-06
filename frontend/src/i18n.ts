import { i18n } from "@lingui/core";
import { messages as messagesEnUS } from "@/locales/en-US/messages.po";
import { messages as messagesEnGB } from "@/locales/en-GB/messages.po";

// Session E step 8: i18n scaffolding, decided by the design-resolver
// agent against docs/ENGINEERING.md's "Language and locale" rule and the
// real, already-existing `household.locale` setting (backend/src/
// settings/coreKeys.ts, `range.options`). `lingui.config.ts` still has
// to declare its own copy of this locale list (extraction needs it
// independent of any runtime code) - a real, small duplication tracked
// in docs/BACKLOG.md - but this file derives its own list from the
// catalogs actually imported below rather than keeping a second,
// separately-maintained array in step with them (a code review,
// 2026-09-06, found an earlier version hand-declaring both, three total
// copies of the same list across the repo instead of two).
const CATALOGS = {
  "en-US": messagesEnUS,
  "en-GB": messagesEnGB,
};
export type SupportedLocale = keyof typeof CATALOGS;
export const SUPPORTED_LOCALES = Object.keys(CATALOGS) as SupportedLocale[];

// Both catalogs loaded eagerly, not dynamically imported per locale:
// two small `.po` catalogs today, nowhere near the size where a lazy
// per-locale chunk would matter - simpler beats "faster" for a pair of
// files this small (org standard 1). `en-US`, the source locale, active
// immediately so `<Trans>`/`i18n._()` always have a locale to resolve
// against, including on the pre-auth SignIn screen (no household is
// known yet to read a real locale preference from).
i18n.load(CATALOGS);
i18n.activate("en-US");

/** Called once `household.locale` is known (App.tsx, once `GET /api/
 * settings?scope=household` resolves) - a no-op for any value outside
 * the catalogs actually loaded above, so a stale or unrecognized stored
 * locale never leaves the app with nothing active. */
export function activateLocale(locale: string): void {
  if ((SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    i18n.activate(locale as SupportedLocale);
  }
}

export { i18n };
