// Baseline key identity across git-mv renames, defined once (platform principle 4).
// Used by kitElementLints.test.ts (merge-base comparison) and uiRulesGuard.ts
// (staged vs HEAD comparison). Applied only to the OLD side (merge-base or
// HEAD), key strings only, never to the current baseline.

/** NEXT-RETIRE-01 git-mv path and symbol mapping. */
export function moveKey(key: string): string {
  return key
    .replace(/(^|\/)next\//g, "$1shell/")
    .replace(/(^|\/)Next([A-Z])/g, "$1$2")
    .replace(/^Next([A-Z])/, "$1")
    .replace(/nextPage/g, "page")
    .replace(/nextChat/g, "chat");
}

/** Normalizes the keys (and string values, as before) of an old-side baseline. */
export function normalizeOldBaseline(value: unknown): unknown {
  if (typeof value === "string") return moveKey(value);
  if (Array.isArray(value)) return value.map(normalizeOldBaseline);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [moveKey(key), normalizeOldBaseline(entry)]));
}
