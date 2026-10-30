import type { Category, CellState, Hardware, ProfileRow, Tier } from "./profileTable";
import type { ProfileSource } from "./admissionFit";
import { closeSettingsFrom } from "./closeApps";

// The Studio hardware class (resource-tiers note section 4): budget 116.8 GB, margin 20 GB. Every figure below is a measured peak or
// resident size from docs/design/tier-evaluations-2026-10-30.md; a slot with no measurement has no figure, so its row is not fitted.
export const STUDIO_HARDWARE: Hardware = {
  budgetGb: 116.8,
  marginGb: 20,
  residentGb: {
    chat: { reduced: 5.7, standard: 19, boost: 16.6 },
    picture: { standard: 18.8, boost: 25.8, max: 37.4 },
    video: { standard: 44, boost: 46 },
    music: { standard: 16.4 },
    tools: { standard: 1.75 },
  },
  peakGb: {
    picture: { standard: 18.8, boost: 25.8, max: 37.4 },
    video: { standard: 44, boost: 46 },
    music: { standard: 16.4 },
    tools: { standard: 1.75 },
  },
};

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

export function profileSourceFromSettings(read: (key: string) => unknown, hw: Hardware = STUDIO_HARDWARE): ProfileSource | null {
  const table = rowsFromSetting(read("resources.profiles"));
  if (table.length === 0) return null;
  const lowerWithoutAsking: Partial<Record<Category, boolean>> = {};
  for (const [kind, category] of [["chat", "chat"], ["image", "picture"], ["video", "video"], ["music", "music"]] as const) lowerWithoutAsking[category] = read(`resources.lower_without_asking.${kind}`) === true;
  return { table, hw, pins: {}, priorityWeight: weightsFromPriority(read("resources.priority")), lowerWithoutAsking, close: closeSettingsFrom(read) };
}
