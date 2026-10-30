// The disk plan's arithmetic and words, shared by Home's backend (the
// installer preflight, the setup checks, the plan wording) and the setup
// wizard's plan step, so every screen adds up the same rows the same way.
// The rows come from the Stack's install plan (GET /stack/v1/install-plan,
// `disk`) or, before a Stack exists, from shared/diskPlan.json, a verbatim
// copy of the Stack's docs/disk-plan.json (backend/tests/diskPlanTable.test.ts
// holds the copy to the Stack's rules).

export type DiskNeed = "required" | "recommended" | "optional";
export interface DiskRow {
  id: string; label: string; note: string; kind: "home" | "model" | "engine"; need: DiskNeed; selectable: boolean;
  download_bytes: number; installed_bytes: number; peak_temp_bytes: number; model_ids: string[]; engines: string[]; installed: boolean; basis: "pins" | "measured" | "estimate";
}
export interface DiskTotals { download_bytes: number; installed_bytes: number; peak_temp_bytes: number; needed_bytes: number; required_free_bytes: number }
export interface DiskPlan {
  tier: "p16" | "p32" | "p64" | "p128"; level: "minimal" | "moderate" | "recommended"; margin_percent: number; headroom_warn_bytes: number;
  rows: DiskRow[]; default: DiskTotals; minimum: DiskTotals; everything: DiskTotals; measured_on: string; default_selected: string[];
}
export type DiskLevel = DiskPlan["level"];
export type DiskState = "green" | "amber" | "red";

export const GIB = 1_073_741_824;
/** The size a person reads: whole gigabytes from 10 up, one decimal below. Rounded up for what is needed and down for what is free, so the sentence never promises room that is not there. */
export function needGb(bytes: number): string { const gb = bytes / GIB; return gb >= 10 ? String(Math.ceil(gb)) : (Math.ceil(gb * 10) / 10).toFixed(1); }
export function freeGb(bytes: number): string { const gb = bytes / GIB; return gb >= 10 ? String(Math.floor(gb)) : (Math.floor(gb * 10) / 10).toFixed(1); }
/** A row's size for a list: what it takes once installed. */
export function sizeGb(bytes: number): string { const gb = bytes / 1e9; return gb >= 10 ? `${Math.round(gb)} GB` : gb >= 0.95 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`; }

/** Room set aside for Home's own records (people, chats, memories) beside the install. */
export const DATA_RESERVE_BYTES = 2 * GIB;

export const LEVEL_WORD: Record<DiskLevel, string> = { recommended: "recommended", moderate: "moderate", minimal: "minimal" };

/** The row ids counted for a selection: the chosen rows, the engine environments they name, each once. Rows already on this computer cost nothing more when `missingOnly`. */
function counted(plan: DiskPlan, selected: ReadonlySet<string>, missingOnly: boolean): DiskRow[] {
  const chosen = plan.rows.filter((row) => row.kind !== "engine" && selected.has(row.id) && !(missingOnly && row.installed));
  const engines = new Set(chosen.flatMap((row) => row.engines));
  return [...chosen, ...plan.rows.filter((row) => row.kind === "engine" && engines.has(row.id))];
}

export function selectionTotals(plan: DiskPlan, selected: Iterable<string>, options: { missingOnly?: boolean; only?: "home" | "ai" | "data" } = {}): DiskTotals {
  const set = new Set(selected);
  // Required rows are always in: a client's checkbox state never drops them.
  for (const row of plan.rows) if (row.kind !== "engine" && row.need === "required") set.add(row.id);
  const rows = counted(plan, set, options.missingOnly ?? false).filter((row) => options.only === undefined || (options.only === "home") === (row.kind === "home"));
  if (options.only === "data") return { download_bytes: 0, installed_bytes: 0, peak_temp_bytes: 0, needed_bytes: 0, required_free_bytes: 0 };
  const sum = (pick: (row: DiskRow) => number) => rows.reduce((acc, row) => acc + pick(row), 0);
  const installed = sum((row) => row.installed_bytes);
  const temp = sum((row) => row.peak_temp_bytes);
  return { download_bytes: sum((row) => row.download_bytes), installed_bytes: installed, peak_temp_bytes: temp, needed_bytes: installed + temp, required_free_bytes: installed === 0 && temp === 0 ? 0 : Math.ceil(installed * (1 + plan.margin_percent / 100)) + temp };
}

export interface DiskVolume {
  /** Free bytes on the volume, or null when it could not be read. */
  freeBytes: number | null;
  /** What lands here: Home's own files ("home"), the AI's models and engines ("ai"), Home's records ("data": a household's chats and memories, 2 GB set aside). One volume can take several when they share a disk. */
  needs: Array<"home" | "ai" | "data">;
}
export interface DiskVerdict {
  state: DiskState;
  /** The free space the setup asks for, summed over the volume's needs. */
  requiredBytes: number;
  freeBytes: number | null;
  /** The whole sentence, with the next step when it is not green. */
  text: string;
  /** What to do, short; empty when green. */
  fix: string;
}

/** What a disk must have free for the parts that land on it. Home's files and the AI's together are asked for as one plan (the margin on their sum). */
function volumeNeed(plan: DiskPlan, selected: readonly string[], needs: DiskVolume["needs"], missingOnly: boolean): number {
  const reserve = needs.includes("data") ? DATA_RESERVE_BYTES : 0;
  const home = needs.includes("home");
  const ai = needs.includes("ai");
  if (home && ai) return selectionTotals(plan, selected, { missingOnly }).required_free_bytes + reserve;
  if (home) return selectionTotals(plan, selected, { missingOnly, only: "home" }).required_free_bytes + reserve;
  if (ai) return selectionTotals(plan, selected, { missingOnly, only: "ai" }).required_free_bytes + reserve;
  return reserve;
}

/** The one check: does each volume have the room for what lands on it. Red when any volume is short (with the margin and the temporary space counted), amber when it fits by less than the plan's headroom, green otherwise. */
export function diskVerdict(plan: DiskPlan, selected: Iterable<string>, volumes: readonly DiskVolume[], options: { missingOnly?: boolean; smallerPlanHint?: boolean; word?: string } = {}): DiskVerdict {
  const set = [...selected];
  const word = options.word ?? `${LEVEL_WORD[plan.level]} setup`;
  let worst: DiskVerdict | null = null;
  for (const volume of volumes) {
    const need = volumeNeed(plan, set, volume.needs, options.missingOnly ?? false);
    if (volume.freeBytes === null) { worst ??= { state: "amber", requiredBytes: need, freeBytes: null, text: `Home could not read the free space on this computer. The ${word} needs about ${needGb(need)} GB free.`, fix: "Check that the disk shows at least that much free space, then go on." }; continue; }
    const hint = options.smallerPlanHint === false ? "Free up space" : "Free up space, or choose a smaller plan";
    if (volume.freeBytes < need) {
      const verdict: DiskVerdict = { state: "red", requiredBytes: need, freeBytes: volume.freeBytes, text: `This computer needs about ${needGb(need)} GB free for the ${word}; it has ${freeGb(volume.freeBytes)} GB. ${hint}.`, fix: hint };
      if (!worst || worst.state !== "red") worst = verdict;
    } else if (volume.freeBytes < need + plan.headroom_warn_bytes) {
      const verdict: DiskVerdict = { state: "amber", requiredBytes: need, freeBytes: volume.freeBytes, text: `The ${word} fits, but it leaves little room: it needs about ${needGb(need)} GB and this computer has ${freeGb(volume.freeBytes)} GB free. Your chats, pictures and updates need space too.`, fix: "Free some space if you can." };
      worst ??= verdict;
    }
  }
  if (worst) return worst;
  const needed = volumes.reduce((sum, volume) => sum + volumeNeed(plan, set, volume.needs, options.missingOnly ?? false), 0);
  const known = volumes.map((volume) => volume.freeBytes).filter((bytes): bytes is number => bytes !== null);
  return { state: "green", requiredBytes: needed, freeBytes: known.length ? Math.min(...known) : null, text: `There is enough room: about ${needGb(needed)} GB needed and ${known.length ? freeGb(Math.min(...known)) : "plenty of"} GB free.`, fix: "" };
}

/** The tier a machine with this much memory gets (Apple silicon and shared memory: its total; the tiers' own floors). Null below the smallest. */
export function tierForMemoryGb(memoryGb: number): DiskPlan["tier"] | null {
  const whole = Math.round(memoryGb);
  return whole >= 128 ? "p128" : whole >= 64 ? "p64" : whole >= 32 ? "p32" : whole >= 16 ? "p16" : null;
}
const TIER_LEVEL_CAP: Record<DiskLevel, DiskPlan["tier"]> = { minimal: "p16", moderate: "p32", recommended: "p128" };
const TIER_ORDER: DiskPlan["tier"][] = ["p16", "p32", "p64", "p128"];
/** The tier a plan level installs on a machine: the level's own tier, never more than the machine can run. A request for Recommended on a 64 GB machine is p64. */
export function tierForLevel(level: DiskLevel, machineTier: DiskPlan["tier"]): DiskPlan["tier"] {
  const cap = TIER_LEVEL_CAP[level];
  return TIER_ORDER.indexOf(cap) < TIER_ORDER.indexOf(machineTier) ? cap : machineTier;
}
