import { i18n } from "@lingui/core";
import type { PrivacyConnection } from "@/lib/api";

/** "Remember and Recall", "Remember, Recall, and Notes". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (!i18n.locale.startsWith("en")) return new Intl.ListFormat(i18n.locale, { style: "long", type: "conjunction" }).format(names);
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Use the family-facing product name, not the internal platform label. */
export function sourceName(row: PrivacyConnection): string {
  return row.sourceKind === "platform" ? i18n._({ id: "MaiPai Home itself", message: "MaiPai Home itself" }) : row.source;
}
