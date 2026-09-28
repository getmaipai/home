import type { PrivacyConnection } from "@/lib/api";

/** "Remember and Recall", "Remember, Recall, and Notes". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Use the family-facing product name, not the internal platform label. */
export function sourceName(row: PrivacyConnection): string {
  return row.sourceKind === "platform" ? "MaiPai Home itself" : row.source;
}
