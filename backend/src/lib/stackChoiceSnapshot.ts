// STACK-MODELS-HOME-01: the Stack holds the model choices, and Home's turn pipeline still needs to know, synchronously, whether a level is switched
// off and which model a Boost or Max job names (`lib/tiers.ts` `readSlot`). This is a small in-memory copy of the Stack's answer, refreshed every
// 30 seconds and after every change made through Home's forwarder. It is a cache, never a store: nothing is written, it is lost on restart, and
// until the migration is done or while the Stack cannot be read, `readSlot` falls back to Home's old stored value exactly as before.
import { forwardToStack, StackChoicesError } from "@/lib/stackChoicesForward";
import { ensureChoicesMigrated, readMigrationRecord } from "@/lib/stackChoicesMigration";
import { isStackConfigured } from "@/lib/stackEngine";

type Level = "reduced" | "standard" | "boost" | "max";

interface Row { tier: Level; chosen: string | null; chosen_by: "household" | "recommended" | "off" | "none" }
let rows: Map<string, Row> | null = null;

/**
 * The model a level uses as Home's slot reader names it (`off`, a model id or `recommended`), or null while the Stack's answer is not known. The feature is
 * found by the Stack's feature id, which is also the category and the middle of the slot key, so Home keeps no list of the Stack's feature names. A level
 * nobody chose is `recommended`, except Reduced, which stays off until a household turns it on (Home's own default for "let big jobs simplify chat").
 */
export function stackSlotModel(feature: string, tier: Level): string | null {
  if (!rows) return null;
  const row = rows.get(`${feature}:${tier}`);
  if (!row) return null;
  if (row.chosen_by === "off") return "off";
  if (row.chosen_by === "household" && row.chosen) return row.chosen;
  return tier === "reduced" ? "off" : "recommended";
}

export function setStackChoiceSnapshot(view: { categories?: Array<{ id: string; role?: string | null; tiers?: Row[] }> } | null): void {
  if (!view?.categories) { rows = null; return; }
  const next = new Map<string, Row>();
  for (const category of view.categories) for (const row of category.tiers ?? []) next.set(`${category.id}:${row.tier}`, row);
  rows = next;
}
export function __resetChoiceSnapshotForTests(): void { rows = null; }

let refreshing: Promise<void> | null = null;
/** Reads the Stack's choices into the cache. Does nothing before Home's values were moved over (the old stored values stay in charge until then). */
export function refreshStackChoiceSnapshot(): Promise<void> {
  refreshing ??= (async () => {
    try {
      if (!isStackConfigured()) { rows = null; return; }
      if (!readMigrationRecord() && !(await ensureChoicesMigrated())) { rows = null; return; }
      setStackChoiceSnapshot((await forwardToStack("GET", "/stack/v1/choices")).body as never);
    } catch (error) {
      rows = null;
      if (!(error instanceof StackChoicesError)) throw error;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Boot: move Home's values over once (retried until the Stack answers) and keep the cache fresh. */
export function startStackChoiceSync(): void {
  if (timer) return;
  void refreshStackChoiceSnapshot().catch(() => undefined);
  timer = setInterval(() => { void refreshStackChoiceSnapshot().catch(() => undefined); }, 30_000);
  timer.unref?.();
}
