// GENUI-05: the answer blocks a bundled Tier 0 package returns from data its
// own run already holds. The pinned recipe interpreter has no `blocks` output
// (a recipe binds `reply`, `data` and `actions`), so a recipe package names the
// kinds it may return in its manifest's `returns_blocks`, binds the typed
// fields in its `format` step's `data` (or, for a list read, in the host's own
// capture of the rows it already read), and the hub shapes them here, in the
// same run, from nothing else. No fetch, no model, no second read.
//
// What this returns is raw: filterAnswerBlocks() (answerBlocks.ts) still
// validates every block against the spec, checks the manifest allowlist,
// applies the age band and the output floor to each string and drops what
// fails, one block at a time. A producer that cannot build a block returns
// nothing; the package reply is never affected.
import { nextHlc } from "@/lib/hlc";

/** Rows a host read already holds, handed to the block producers of the same
 * run. Filled by packageHost.ts (never by a package). */
export interface BlockCapture {
  /** The open rows of the shopping list, as list-view read them. */
  listItems?: { id: string; text: string }[];
}

type RecipeResult = { reply?: { text: string }; data?: Record<string, unknown> };

const ALT_MAX = 300;
const NAME_MAX = 200;
const LIST_ITEMS_MAX = 100;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}\u2026`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** The one envelope every block here carries: a fresh id, the producing
 * package, the run's provenance and a stamp from the hub's own clock. */
export function blockEnvelope(kind: string, producer: string, alt: string, provenance: string, props: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `blk-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind,
    schema_version: 1,
    producer,
    alt: clip(alt, ALT_MAX),
    provenance,
    created_at: new Date().toISOString(),
    hlc: nextHlc(),
    props,
  };
}

function scheduleCard(producer: string, provenance: string, verb: string, name: string | null, whenText: string | null): Record<string, unknown>[] {
  if (!name || !whenText) return [];
  return [blockEnvelope(
    "schedule_card",
    producer,
    `${verb}: ${name} (${whenText}).`,
    provenance,
    { name: clip(name, NAME_MAX), cadence: "Once", nextRun: whenText, enabled: true, history: [] },
  )];
}

function todoList(producer: string, provenance: string, items: readonly { id: string; text: string }[]): Record<string, unknown>[] {
  const rows = items.filter((item) => item.id.length > 0 && item.text.trim().length > 0).slice(0, LIST_ITEMS_MAX);
  if (rows.length === 0) return [];
  const count = rows.length === 1 ? "1 item" : `${rows.length} items`;
  return [blockEnvelope(
    "todo_list",
    producer,
    `Shopping list, ${count}: ${rows.map((row) => row.text.trim()).join(", ")}.`,
    provenance,
    { title: "Shopping list", items: rows.map((row) => ({ id: row.id, text: row.text.trim(), status: "pending" })) },
  )];
}

/** The blocks a Tier 0 recipe package returns for one successful run, or an
 * empty array. Only a kind the manifest lists in `returns_blocks` is built. */
export function blocksForRecipeRun(
  manifest: { id: string; returns_blocks?: readonly string[] },
  result: RecipeResult,
  capture: BlockCapture,
  turnId?: string,
): Record<string, unknown>[] {
  const allowed = manifest.returns_blocks ?? [];
  const provenance = `${manifest.id} result${turnId ? ` in turn ${turnId}` : ""}`;
  switch (manifest.id) {
    case "remind":
      return allowed.includes("schedule_card")
        ? scheduleCard(manifest.id, provenance, "Reminder set", text(result.data?.task), text(result.data?.when_text))
        : [];
    case "timer":
      return allowed.includes("schedule_card")
        ? scheduleCard(manifest.id, provenance, "Timer set", text(result.data?.label), text(result.data?.when_text))
        : [];
    case "list-view":
      return allowed.includes("todo_list") ? todoList(manifest.id, provenance, capture.listItems ?? []) : [];
    default:
      return [];
  }
}
