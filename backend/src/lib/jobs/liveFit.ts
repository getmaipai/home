import type { Category, CellState, Hardware, ProfileCell, ProfileRow, Tier } from "./profileTable";

export interface MemoryNow { freeGb: number; evictableGb: number }
export interface FitInput {
  row: ProfileRow;
  table: readonly ProfileRow[];
  hw: Hardware;
  memory: MemoryNow;
  pins: Partial<Record<Category, CellState>>;
  priorityWeight: Partial<Record<Category, number>>;
  pickedTier: Tier;
  lowerWithoutAsking: Partial<Record<Category, boolean>>;
}
export interface FitResult {
  outcome: "run" | "ask" | "queue" | "refuse";
  applied: ProfileRow | null;
  steps: string[];
  lowered: Category[];
  leadTier: Tier;
  belowPick: boolean;
  needGb: number;
  /** What the profile as written would have needed, for the ask line. */
  requestedNeedGb: number;
  haveGb: number;
  reason: "fits" | "profile_lowered" | "lead_lowered" | "no_room_now" | "never_fits";
  /** Internal comparison baseline used by appliedProfile; contains no app or person data. */
  requested?: ProfileRow;
  /** MEM-SPACE-10: counts and bytes of the apps the close step quit for this job; never names. */
  closed?: { apps: number; bytes: number };
}

const categories: Category[] = ["chat", "voice", "picture", "video", "music", "tools"];
const ranks: Record<CellState, number> = { off: 0, queued: 0, reduced: 1, standard: 2, boost: 3, max: 4 };
const tierDown: Partial<Record<Tier, Tier>> = { max: "boost", boost: "standard" };
const stateDown: Partial<Record<CellState, CellState>> = { max: "boost", boost: "standard", standard: "reduced" };

/** Mirrors validateProfileTable's lead peak plus resident support arithmetic. */
export function needGb(row: ProfileRow, hw: Hardware): number {
  const peak = hw.peakGb[row.lead]?.[row.tier];
  if (peak === undefined) return Infinity;
  let need = peak;
  for (const category of categories) {
    if (category === row.lead) continue;
    const cell = row.cells[category];
    if (!cell || cell.phase === "before" || cell.state === "queued" || cell.state === "off") continue;
    const resident = hw.residentGb[category]?.[cell.state as "reduced" | Tier];
    if (resident === undefined) return Infinity;
    need += resident;
  }
  return need;
}

function cloneRow(row: ProfileRow, cells: Partial<Record<Category, ProfileCell>> = row.cells): ProfileRow {
  return { ...row, cells: Object.fromEntries(Object.entries(cells).map(([category, cell]) => [category, cell && { ...cell }])) as ProfileRow["cells"] };
}
function score(row: ProfileRow, weights: FitInput["priorityWeight"]): number {
  return categories.reduce((total, category) => total + (weights[category] ?? 0) * ranks[row.cells[category]?.state ?? "off"], 0);
}
/** Picks a fitting profile using the finite, one-move-at-a-time admission ladder. */
export function liveFit(input: FitInput): FitResult {
  const room = input.memory.freeGb + input.memory.evictableGb;
  const haveGb = input.memory.freeGb;
  const steps: string[] = [];
  if (input.memory.evictableGb > 0) steps.push("cleared waste");
  const initialNeed = needGb(input.row, input.hw);
  const noRow: FitResult = { outcome: "run", applied: null, steps, lowered: [], leadTier: "standard", belowPick: false, needGb: 0, requestedNeedGb: 0, haveGb, reason: "fits" };
  if (!input.table.some((row) => row.lead === input.row.lead && row.tier === input.row.tier)) return noRow;
  const pinBroken = (row: ProfileRow): boolean => categories.some((category) => { const pin = input.pins[category]; const cell = row.cells[category]; return pin !== undefined && cell !== undefined && ranks[cell.state] < ranks[pin]; });
  const pinConflict = pinBroken(input.row);
  if (initialNeed <= room && !pinConflict) return { outcome: "run", applied: cloneRow(input.row), steps, lowered: [], leadTier: input.row.tier, belowPick: false, needGb: initialNeed, requestedNeedGb: initialNeed, haveGb, reason: "fits", requested: cloneRow(input.row) };

  const requested = cloneRow(input.row);
  let current = cloneRow(input.row);
  // Supporting cells belong to the stage before the lead; they yield before ordinary cells.
  // Pinned cells are immutable; a conflicting table row cannot be selected.
  if (pinConflict) return { ...noRow, outcome: "queue", applied: null, needGb: initialNeed, reason: "no_room_now", requested };
  let changed = false;
  const moved = new Set<Category>();
  // The phase order is a strict preference: ordinary categories, supporting cells, then lead tier.
  while (true) {
    const mainCandidates: { row: ProfileRow; category: Category; label: string; lead: boolean }[] = [];
    const phaseCandidates = categories.filter((item) => item !== current.lead && current.cells[item]?.phase !== "before").sort((a, b) => (input.priorityWeight[a] ?? 0) - (input.priorityWeight[b] ?? 0)).flatMap((category) => {
      const cell = current.cells[category];
      if (!cell || input.pins[category] !== undefined || category === "chat" && cell.state === "reduced" || category === "voice") return [];
      const next = stateDown[cell.state];
      if (next) {
        const cells = { ...current.cells, [category]: { ...cell, state: next } };
        return [{ row: cloneRow(current, cells), category, label: `${category} lowered`, lead: false }];
      } else if (cell.state !== "queued" && cell.state !== "off") {
        const cells = { ...current.cells, [category]: { ...cell, state: "queued" } };
        return [{ row: cloneRow(current, cells), category, label: `${category} queued`, lead: false }];
      } else if (cell.state === "queued") {
        const cells = { ...current.cells, [category]: { ...cell, state: "off" } };
        return [{ row: cloneRow(current, cells), category, label: `${category} off`, lead: false }];
      }
      return [];
    });
    mainCandidates.push(...phaseCandidates);
    const supportCandidates = categories.filter((item) => current.cells[item]?.phase === "before").sort((a, b) => (input.priorityWeight[a] ?? 0) - (input.priorityWeight[b] ?? 0)).flatMap((category) => {
        const cell = current.cells[category];
        if (!cell || input.pins[category] !== undefined || category === current.lead || category === "voice") return [];
        const next = stateDown[cell.state];
        if (next) return [{ row: cloneRow(current, { ...current.cells, [category]: { ...cell, state: next } }), category, label: `${category} lowered`, lead: false }];
        return [];
    });
    const leadCandidates: { row: ProfileRow; category: Category; label: string; lead: boolean }[] = [];
    const lower = tierDown[current.tier];
    const lowerRow = lower && input.table.find((row) => row.lead === current.lead && row.tier === lower);
    if (lower && lowerRow) leadCandidates.push({ row: cloneRow(lowerRow), category: current.lead, label: `lead lowered to ${lower}`, lead: true });
    const candidates = [...supportCandidates, ...mainCandidates, ...leadCandidates];
    if (!candidates.length) break;
    // If one step can fit, choose the highest weighted fit; otherwise use the ladder class order.
    const fitting = candidates.filter((candidate) => needGb(candidate.row, input.hw) <= room).sort((a, b) => score(b.row, input.priorityWeight) - score(a.row, input.priorityWeight));
    const chosen = fitting[0] ?? candidates[0];
    if (!chosen) break;
    current = chosen.row;
    changed = true;
    moved.add(chosen.category);
    steps.push(chosen.label);
    if (needGb(current, input.hw) <= room && !pinBroken(current)) {
      const belowPick = current.tier !== input.pickedTier;
      const outcome = belowPick && !input.lowerWithoutAsking[current.lead] ? "ask" : "run";
      return { outcome, applied: current, steps, lowered: [...moved], leadTier: current.tier, belowPick, needGb: needGb(current, input.hw), requestedNeedGb: initialNeed, haveGb,
        reason: belowPick ? "lead_lowered" : changed ? "profile_lowered" : "fits", requested };
    }
  }

  const lowest = input.table.filter((row) => row.lead === input.row.lead).sort((a, b) => ranks[a.tier] - ranks[b.tier])[0];
  const everNeed = Math.min(lowest ? needGb(lowest, input.hw) : initialNeed, changed ? needGb(current, input.hw) : initialNeed);
  const fitsEver = everNeed <= input.hw.budgetGb - input.hw.marginGb;
  const currentNeed = changed ? needGb(current, input.hw) : initialNeed;
  return { outcome: fitsEver ? "queue" : "refuse", applied: null, steps, lowered: [...moved], leadTier: current.tier, belowPick: current.tier !== input.pickedTier,
    needGb: fitsEver ? everNeed : currentNeed, requestedNeedGb: initialNeed, haveGb, reason: fitsEver ? "no_room_now" : "never_fits", requested };
}

const tierName: Record<Tier, string> = { standard: "Standard", boost: "Boost", max: "Max" };
export function askLine(result: FitResult, audience: "admin" | "adult" | "child"): string | null {
  if (result.outcome !== "ask" || !result.applied || audience === "child") return null;
  const picked = tierName[result.requested?.tier ?? result.leadTier];
  const actual = tierName[result.leadTier];
  const sentence = `Making this at ${actual}, not ${picked}: there is not enough room right now`;
  return audience === "admin" ? `${sentence} (${picked} needs about ${Math.round(result.requestedNeedGb)} GB, ${Math.round(result.haveGb)} GB is free). Wait for ${picked} instead?` : `${sentence}. Wait for ${picked} instead?`;
}

export function appliedProfile(result: FitResult): { lowered: number; queued: number; off: number; closed_apps: number; closed_bytes: number } {
  const profile = { lowered: 0, queued: 0, off: 0, closed_apps: result.closed?.apps ?? 0, closed_bytes: result.closed?.bytes ?? 0 };
  if (!result.applied) return profile;
  for (const [category, cell] of Object.entries(result.applied.cells) as [Category, ProfileCell][]) {
    if (category === result.applied.lead) continue;
    if (cell.state === "queued") profile.queued += 1;
    else if (cell.state === "off") profile.off += 1;
    else {
      const original = result.requested?.cells[category];
      if (original && ranks[cell.state] < ranks[original.state]) profile.lowered += 1;
    }
  }
  return profile;
}

export function stagesFor(row: ProfileRow): ProfileCell[][] {
  const before: ProfileCell[] = [];
  const main: ProfileCell[] = [];
  for (const cell of Object.values(row.cells)) if (cell) (cell.phase === "before" ? before : main).push({ ...cell });
  return [before, main].filter((stage) => stage.length > 0);
}
export function chatMayReturnBetweenStages(opts: { quietOk: boolean; cooldownOk: boolean }): boolean { return opts.quietOk && opts.cooldownOk; }
