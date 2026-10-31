// MEM-SPACE-04 (Free up memory) and MEM-SPACE-05/06 (the capability table): Home's plain-words view of two Stack readings.
// Older Stacks answer 404; every reader then says "not available" instead of failing, and the page hides the feature.
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import type { StackCapabilities, StackReclaimList, StackReclaimResult } from "@/lib/stack/types";

export interface ReclaimView { available: boolean; models: number; bytes: number }
export interface ReclaimReaders { list?: () => Promise<StackReclaimList | undefined>; run?: () => Promise<StackReclaimResult | undefined> }

const stackCall = async <T>(read: (client: ReturnType<typeof getStackClient>) => Promise<T> | undefined): Promise<T | undefined> => {
  if (!isStackConfigured()) return undefined;
  try { return await read(getStackClient()); } catch { return undefined; }
};

/** What Free up memory would do now: how many idle models and about how many bytes. Names and ids stay in the Stack. */
export async function readReclaim(readers: ReclaimReaders = {}): Promise<ReclaimView> {
  const list = await (readers.list ?? (() => stackCall((client) => client.reclaimList?.())))();
  if (!list || !Array.isArray(list.items)) return { available: false, models: 0, bytes: 0 };
  return { available: true, models: list.items.length, bytes: list.total_bytes };
}

export async function runReclaim(readers: ReclaimReaders = {}): Promise<{ available: boolean; unloaded: number; freed_bytes: number }> {
  const result = await (readers.run ?? (() => stackCall((client) => client.reclaimRun?.())))();
  return result ? { available: true, unloaded: result.unloaded, freed_bytes: result.freed_bytes } : { available: false, unloaded: 0, freed_bytes: 0 };
}

const CATEGORY_LABELS = { chat: "Chat", image: "Pictures", video: "Videos", music: "Music", voice: "Voice" } as const;
const TIERS = ["standard", "boost", "max"] as const;
export interface CapabilityCell { tier: (typeof TIERS)[number]; fits: boolean; needs_bytes: number | null }
export interface CapabilityRow { category: keyof typeof CATEGORY_LABELS; label: string; cells: CapabilityCell[] }
export interface CapabilityView { available: boolean; machine_class: string; rows: CapabilityRow[] }

/** One row per category, one cell per tier the Stack lists; a tier the Stack does not list for a category is simply not offered on this computer. */
export function capabilityView(raw: StackCapabilities | undefined): CapabilityView {
  if (!raw || !Array.isArray(raw.rows)) return { available: false, machine_class: "unknown", rows: [] };
  const rows = (Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).flatMap((category): CapabilityRow[] => {
    const cells = TIERS.flatMap((tier): CapabilityCell[] => {
      const row = raw.rows.find((entry) => entry.category === category && entry.tier === tier);
      return row ? [{ tier, fits: row.fits_ever, needs_bytes: row.needs_bytes }] : [];
    });
    return cells.length > 0 ? [{ category, label: CATEGORY_LABELS[category], cells }] : [];
  });
  return { available: true, machine_class: raw.machine_class, rows };
}

export async function readCapabilities(read: () => Promise<StackCapabilities | undefined> = () => stackCall((client) => client.capabilities?.())): Promise<CapabilityView> {
  return capabilityView(await read());
}

/** MEM-SPACE-05: the setup jobs no tier of the capability table can ever run on this computer; the wizard leaves them off and downloads nothing for them. Chat is never listed (it is always installed). */
const JOBS_OF_CATEGORY: Partial<Record<CapabilityRow["category"], string[]>> = { image: ["pictures", "picturesdetailed"], video: ["videos"], music: ["music"], voice: ["voice"] };
export function cannotRunJobs(view: CapabilityView): string[] {
  if (!view.available) return [];
  return view.rows.filter((row) => row.cells.length > 0 && row.cells.every((cell) => !cell.fits)).flatMap((row) => JOBS_OF_CATEGORY[row.category] ?? []);
}
