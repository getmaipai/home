import { i18n } from "@lingui/core";

/** The language tag dates, numbers and lists should follow: the active catalog locale without the child or teen mode suffix ("es-x-child" -> "es"). */
export function activeLocale(): string {
  return (i18n.locale || "en-US").replace(/-x-.*$/, "");
}
