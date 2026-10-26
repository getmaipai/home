// AIMODELS-UNUSED-01: which installed parts of the AI are unused, and the
// plain words for it. Pure, no I/O and no Stack calls: the Free up space
// route supplies the disk plan, the Stack components and the household
// settings, and re-checks each id at removal time with whyKept. The rule is
// the seven points in docs/design/ai-models-simple-2026-10-25.md, section 6.
import { buildAiCards } from "../../../shared/aiChoices";
import type { AiCard, AiChoice, AiChoicesInput, AiChoicesResult, AiComponentLike } from "../../../shared/aiChoices";
import type { DiskPlan, DiskRow } from "../../../shared/diskPlanMath";

export interface UnusedItem { id: string; name: string; bytes: number; reason: string; lastUsedAt: string | null }
export interface UnusedResult { items: UnusedItem[]; totalBytes: number }
export interface UnusedComponent extends AiComponentLike { kind: "model" | "lora"; depends_on: string[]; plan_need: "required" | "recommended" | "optional" | null; group?: string }

// A part no job card offers (a second chat model, an offline coder) is named by what it does, never by its model name:
// model names belong under Details only.
const GROUP_NAMES: Record<string, string> = {
  chat: "Extra chat model", voice: "Extra voice", pictures: "Extra picture model", video: "Extra video model", music: "Extra music model", tools: "Extra picture tool",
};
export function plainPartName(component: { group?: string }): string {
  return (component.group ? GROUP_NAMES[component.group] : undefined) ?? "Extra model";
}
export interface UnusedInput extends Omit<AiChoicesInput, "components"> { components: UnusedComponent[]; now?: number }

const KEPT_REASONS = {
  removable: "It cannot be removed right now.",
  selected: "You use it now.",
  alwaysOn: "Home needs it.",
  dependedOn: "Another part needs it.",
  busy: "It is in use right now.",
  style: "A saved style needs it.",
  isStyle: "A saved style is removed from its own page, not here.",
} as const;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "Not used since August." for the Free up space list. A small local version
// of the settings page's lastUsedWords, which says "Used 5 months ago"; the
// backend does not import frontend code.
export function notUsedSince(iso: string | null): string {
  if (iso === null) return "Not used yet.";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "Not used yet.";
  const month = MONTHS[new Date(time).getMonth()];
  if (month === undefined) return "Not used yet.";
  return `Not used since ${month}.`;
}

interface UnusedContext {
  plan: DiskPlan;
  components: UnusedComponent[];
  rows: Map<string, DiskRow>;
  cards: AiChoicesResult;
  selected: Set<string>;
  alwaysOn: Set<string>;
}

function byRowId(plan: DiskPlan): Map<string, DiskRow> {
  return new Map(plan.rows.map((row) => [row.id, row] as const));
}

// The plan row a component is part of: its own row when it has one (engines),
// otherwise the row whose models name it.
function rowOf(context: UnusedContext, component: AiComponentLike): DiskRow | null {
  const own = context.rows.get(component.id);
  if (own) return own;
  for (const row of context.plan.rows) if (row.model_ids.includes(component.id)) return row;
  return null;
}

function buildContext(input: UnusedInput): UnusedContext {
  const plan = input.plan;
  const cards = buildAiCards(input);
  const rows = byRowId(plan);
  const selected = new Set<string>();
  for (const card of cards.cards) {
    for (const choice of card.choices) {
      if (!choice.current) continue;
      for (const component of input.components) {
        // The same row-to-component match as aiChoices: the component is its
        // own row or one of the row's models.
        if (choice.rowIds.some((rowId) => component.id === rowId || (rows.get(rowId)?.model_ids.includes(component.id) ?? false))) {
          selected.add(component.id);
        }
      }
    }
  }
  return { plan, components: input.components, rows, cards, selected, alwaysOn: new Set(cards.alwaysOn.rowIds) };
}

interface PartReasons { removable: string | null; selected: string | null; alwaysOn: string | null; busy: string | null; style: string | null; klein: boolean }

function baseReasons(context: UnusedContext, component: UnusedComponent): PartReasons {
  const row = rowOf(context, component);
  return {
    removable: component.state === "installed" && component.can_uninstall ? null : KEPT_REASONS.removable,
    selected: context.selected.has(component.id) ? KEPT_REASONS.selected : null,
    alwaysOn: (row !== null && (row.need === "required" || context.alwaysOn.has(row.id) || row.id === "chat")) || component.requirement === "required" ? KEPT_REASONS.alwaysOn : null,
    busy: component.job !== null || component.used_by.length > 0 ? KEPT_REASONS.busy : null,
    style: context.components.some((other) => other.kind === "lora" && other.state === "installed" && other.depends_on.includes(component.id)) ? KEPT_REASONS.style : null,
    klein: row?.id === "pictures",
  };
}

// The kept reason for every component: the first failing point of the rule,
// with the depends_on point settled to a fixpoint, since a part is kept when
// another kept part names it.
function keptReasons(context: UnusedContext): Map<string, string | null> {
  const base = new Map<string, PartReasons>();
  for (const component of context.components) base.set(component.id, baseReasons(context, component));
  const dependedOn = new Set<string>();
  const kept = (id: string): boolean => {
    const part = base.get(id);
    if (part === undefined) return false;
    return part.removable !== null || part.selected !== null || part.alwaysOn !== null || part.busy !== null || part.style !== null || part.klein || dependedOn.has(id);
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const other of context.components) {
      if (!kept(other.id)) continue;
      for (const id of other.depends_on) {
        if (id === other.id || dependedOn.has(id) || !base.has(id)) continue;
        dependedOn.add(id);
        changed = true;
      }
    }
  }
  const out = new Map<string, string | null>();
  for (const [id, part] of base) {
    // A saved style is never listed and never removed from here, whatever id a caller sends.
    if (context.components.find((component) => component.id === id)?.kind === "lora") { out.set(id, KEPT_REASONS.isStyle); continue; }
    out.set(id, part.removable ?? part.selected ?? part.alwaysOn ?? (part.klein || dependedOn.has(id) ? KEPT_REASONS.dependedOn : null) ?? part.busy ?? part.style ?? null);
  }
  return out;
}

export function whyKept(input: UnusedInput, componentId: string): string | null {
  const reasons = keptReasons(buildContext(input));
  if (!reasons.has(componentId)) return KEPT_REASONS.removable;
  return reasons.get(componentId) ?? null;
}

// The card choice a component appears in, walking the cards in their shown order.
function matchingChoice(context: UnusedContext, component: UnusedComponent): { card: AiCard; choice: AiChoice } | null {
  for (const card of context.cards.cards) {
    for (const choice of card.choices) {
      if (choice.rowIds.some((rowId) => component.id === rowId || (context.rows.get(rowId)?.model_ids.includes(component.id) ?? false))) return { card, choice };
    }
  }
  return null;
}

// Quick and Detailed mean pictures on one card and videos on another, so those two are named with their job; the music
// switch is named by its card, since its own label is a whole sentence.
export const qualified = (card: AiCard, choice: AiChoice): string => (card.id === "pictures" || card.id === "videos" ? `${choice.label} ${card.id}` : card.id === "music" ? card.title : choice.label);

function nameFor(context: UnusedContext, component: UnusedComponent): string {
  const match = matchingChoice(context, component);
  return match ? qualified(match.card, match.choice) : plainPartName(component);
}

function reasonFor(context: UnusedContext, component: UnusedComponent): string {
  const match = matchingChoice(context, component);
  const chosen = match?.card.choices.find((choice) => choice.current);
  if (match && chosen && chosen.id !== match.choice.id) return `You use ${qualified(match.card, chosen)} and no saved style needs this.`;
  return notUsedSince(component.last_used_at);
}

export function findUnused(input: UnusedInput): UnusedResult {
  const context = buildContext(input);
  const reasons = keptReasons(context);
  const items: UnusedItem[] = [];
  for (const component of context.components) {
    if (component.kind === "lora") continue; // A saved style is never listed.
    if ((reasons.get(component.id) ?? null) !== null) continue;
    const bytes = component.size_bytes ?? 0;
    if (bytes === 0) continue;
    // Point 7, leftover older versions of a model: the Stack cannot list them
    // yet, so they do not come back in this list.
    items.push({ id: component.id, name: nameFor(context, component), bytes, reason: reasonFor(context, component), lastUsedAt: component.last_used_at });
  }
  items.sort((a, b) => b.bytes - a.bytes);
  return { items, totalBytes: items.reduce((total, item) => total + item.bytes, 0) };
}
