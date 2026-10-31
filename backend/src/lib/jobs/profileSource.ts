import type { Category, CellState, Hardware, ProfileRow, Tier } from "./profileTable";
import type { ProfileSource } from "./admissionFit";
import { closeSettingsFrom } from "./closeApps";
import type { BudgetResponse } from "../stack/types";
import { currentHardware } from "./stackHardware";

const GIB = 1_073_741_824;
const gb = (bytes: number) => Math.round(bytes / GIB * 100) / 100;

export function hardwareFromBudget(budget: BudgetResponse): Hardware | null {
  if (!budget.slots?.length || budget.margin_bytes === undefined) return null;
  const residentGb: Hardware["residentGb"] = {};
  const peakGb: Hardware["peakGb"] = {};
  const categoryMap = { chat: "chat", pictures: "picture", video: "video", music: "music" } as const;
  for (const slot of budget.slots) {
    if (!slot.verified) continue;
    const category = categoryMap[slot.category];
    (residentGb[category] ??= {})[slot.tier] = gb(slot.peak_bytes);
    if (slot.tier !== "reduced") (peakGb[category] ??= {})[slot.tier] = gb(slot.peak_bytes);
  }
  const tools = budget.loaded.find((item) => item.id === "image-tools");
  if (tools) {
    (residentGb.tools ??= {}).standard = gb(tools.peakBytes);
    (peakGb.tools ??= {}).standard = gb(tools.peakBytes);
  }
  return { budgetGb: gb(budget.capBytes), marginGb: gb(budget.margin_bytes), residentGb, peakGb };
}

const LEADS: Record<string, Category> = { image: "picture", video: "video", chat: "chat", music: "music", tools: "tools" };
const TIERS = new Set<string>(["standard", "boost", "max"]);
const STATES = new Set<string>(["reduced", "standard", "boost", "max", "queued", "off"]);

function json(raw: unknown): unknown {
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return undefined; }
}

/** The Performance page's `resources.profiles` JSON as validated-shape rows: "image.max": { chat: "standard", ... }. Unknown rows and cells are skipped. */
export function rowsFromSetting(raw: unknown): ProfileRow[] {
  const parsed = json(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const rows: ProfileRow[] = [];
  for (const [name, cells] of Object.entries(parsed as Record<string, unknown>)) {
    const [kind, tier] = name.split(".");
    const lead = kind ? LEADS[kind] : undefined;
    if (!lead || !tier || !TIERS.has(tier) || !cells || typeof cells !== "object") continue;
    const out: ProfileRow["cells"] = {};
    for (const [category, state] of Object.entries(cells as Record<string, unknown>)) {
      const key = LEADS[category];
      if (key && typeof state === "string" && STATES.has(state)) out[key] = { state: state as CellState };
    }
    rows.push({ lead, tier: tier as Tier, cells: out });
  }
  return rows;
}

/** "Order of importance", most important first, as weights (higher means lowered last). */
export function weightsFromPriority(raw: unknown): Partial<Record<Category, number>> {
  const parsed = json(raw);
  if (!Array.isArray(parsed)) return {};
  const weights: Partial<Record<Category, number>> = {};
  parsed.forEach((name, index) => { const key = typeof name === "string" ? LEADS[name] : undefined; if (key) weights[key] = parsed.length - index; });
  return weights;
}

export function profileSourceFromSettings(read: (key: string) => unknown, hw: Hardware | null = currentHardware()): ProfileSource | null {
  if (!hw) return null;
  const table = rowsFromSetting(read("resources.profiles"));
  if (table.length === 0) return null;
  const lowerWithoutAsking: Partial<Record<Category, boolean>> = {};
  for (const [kind, category] of [["chat", "chat"], ["image", "picture"], ["video", "video"], ["music", "music"]] as const) lowerWithoutAsking[category] = read(`resources.lower_without_asking.${kind}`) === true;
  return { table, hw, pins: {}, priorityWeight: weightsFromPriority(read("resources.priority")), lowerWithoutAsking, close: closeSettingsFrom(read) };
}
