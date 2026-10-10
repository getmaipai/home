// Baseline key identity across renames, defined once (platform principle 4).
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

/** NEXT-RETIRE-02E-GUARD: exactly four quoted data-slot literals, never a
 * prefix or wildcard (so next-chat-showcase-shell stays itself). Delete the
 * entries once origin/main contains NEXT-RETIRE-02E; the expiry test in
 * kitElementLints.test.ts fails until you do. */
export const SLOT_RENAMES: ReadonlyArray<{ from: string; to: string; item: "NEXT-RETIRE-02E" }> = [
  { from: 'data-slot="next-chat-pane"', to: 'data-slot="chat-pane"', item: "NEXT-RETIRE-02E" },
  { from: 'data-slot="next-chat-shell"', to: 'data-slot="chat-shell"', item: "NEXT-RETIRE-02E" },
  { from: 'data-slot="next-chat-rail"', to: 'data-slot="chat-rail"', item: "NEXT-RETIRE-02E" },
  { from: 'data-slot="next-chat-header"', to: 'data-slot="chat-header"', item: "NEXT-RETIRE-02E" },
];

export const renameSlots = (key: string): string => SLOT_RENAMES.reduce((k, r) => k.split(r.from).join(r.to), key);

/** Old-side key normalization: the git-mv map, then the slot renames. */
export const normalizeBaseKey = (key: string): string => renameSlots(moveKey(key));

/** Normalizes the keys (and string values, as before) of an old-side baseline. */
export function normalizeOldBaseline(value: unknown): unknown {
  if (typeof value === "string") return normalizeBaseKey(value);
  if (Array.isArray(value)) return value.map(normalizeOldBaseline);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [normalizeBaseKey(key), normalizeOldBaseline(entry)]));
}

export type NestedBaseline = Record<string, Record<string, unknown>>;

/** Old keys (per file) that a slot rename rewrites: a rewrite applies only
 * when the old key exists in the base set. */
export function renamedKeys(oldBaseline: NestedBaseline): Array<{ oldFile: string; file: string; from: string; to: string }> {
  return Object.entries(oldBaseline).flatMap(([oldFile, by]) =>
    Object.keys(by ?? {}).flatMap((from) => {
      const to = renameSlots(from);
      return to !== from ? [{ oldFile, file: moveKey(oldFile), from, to }] : [];
    }),
  );
}

/** A renamed entry must keep its reason, ed and properties exactly. */
export function renamedEntryProblems(oldBaseline: NestedBaseline, current: NestedBaseline): string[] {
  const out: string[] = [];
  for (const { oldFile, file, from, to } of renamedKeys(oldBaseline)) {
    const now = current[file]?.[to];
    if (now === undefined) continue; // lost or stale entries are reported by the existing checks
    if (JSON.stringify(oldBaseline[oldFile]?.[from]) !== JSON.stringify(now)) out.push(`${file}: ${to} changed while being renamed from ${from} (a rename keeps its reason, ed and properties)`);
  }
  return out;
}

/** True while some old key still uses the entry's old name (the entry is needed). */
export const renameStillNeeded = (entry: (typeof SLOT_RENAMES)[number], oldBaselines: NestedBaseline[]): boolean =>
  oldBaselines.some((b) => Object.values(b).some((by) => Object.keys(by ?? {}).some((k) => k.includes(entry.from))));
