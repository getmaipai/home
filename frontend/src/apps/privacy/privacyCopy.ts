import { i18n } from "@lingui/core";
import type { PrivacyConnection } from "@/lib/api";
import { formatList } from "@/lib/format";

/** "Remember and Recall", "Remember, Recall, and Notes". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return formatList(names);
}

/** Use the family-facing product name, not the internal platform label. */
export function sourceName(row: PrivacyConnection): string {
  return row.sourceKind === "platform" ? i18n._({ id: "MaiPai Home itself", message: "MaiPai Home itself" }) : row.source;
}
