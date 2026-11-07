import { i18n } from "@lingui/core";

/** A list as words in the active language ("a, b and c" in English, "a, b y c" in Spanish). */
export function listWords(items: readonly string[]): string {
  return new Intl.ListFormat(i18n.locale, { style: "long", type: "conjunction" }).format(items);
}
