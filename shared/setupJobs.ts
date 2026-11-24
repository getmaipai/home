// The units of the setup wizard's plan step: one per Stack feature row (plus the two parts the hub holds itself), each turned on or
// off as a whole at its recommended level. Pure: the tier's disk plan (every row names its `feature`), the words and the state of the
// hub's own parts in, the units out. Replaces the old per-job card builder: there is no per-feature table here, only
// shared/hubParts.json (ids, order, icons, copy keys).
import hubParts from "./hubParts.json";
import type { DiskPlan, DiskRow } from "./diskPlanMath";

/** The ids of the wizard's units. */
export type SetupJobId = "chat" | "pictures" | "videos" | "music" | "stems" | "voice" | "vision" | "coding" | "faces" | "ingredients";
/** The plan-row ids that stand in for the hub's own parts: the wizard uses them, no disk plan holds them. */
export const FACES_ROW_ID = "faces-finder";
export const INGREDIENTS_ROW_ID = "ingredients-adapter";

interface JobDef { id: SetupJobId; feature?: string; hub?: boolean; rowId?: string; icon: string; copy: string }
const JOBS = hubParts.jobs as unknown as JobDef[];

export interface SetupCopy { card(copyKey: string): { title: string; summary: string } }
/** A part the hub itself holds: where it stands on this computer. */
export interface SetupHubPart { installed: boolean; bytes: number; installing?: boolean; failure?: string | null; /** Why it cannot be installed now, in words that say what to do. Never set while installed. */ blockedReason?: string | null; /** The one line that names it (its own name and what it does). */ label: string; description: string }
export interface SetupJobsInput { plan: DiskPlan; copy: SetupCopy; /** WAN-DEFAULT-01: a child or teen lives here, so the minors-only model starts on. */ householdHasMinors: boolean; hub: Partial<Record<"faces" | "ingredients", SetupHubPart | null>> }

/** One unit as the wizard shows it. */
export interface SetupJob {
  job: SetupJobId; title: string; summary: string; icon: string;
  /** What turning it on installs: the plan rows of its recommended level (the first optional model row when the plan recommends none). */
  rowIds: string[];
  /** Every plan row of the unit at any level: the wizard asks about these through the unit, so the plan's defaults for them are not added again. */
  askedRowIds: string[];
  /** The model the unit installs, for the line under its name. */
  label: string; description: string;
  installedBytes: number;
  state: "installed" | "installing" | "notInstalled" | "failed";
  /** The unit cannot be turned off: one of its rows is required. */
  required: boolean;
  /** The unit starts on: the plan recommends it, or it is the minors-only model of a home with a child or teen (WAN-DEFAULT-01). */
  defaultOn: boolean;
  hubPart: boolean;
  /** Why it cannot be installed from the wizard (the adapter needs a Hugging Face token and an accepted licence); null when it can. */
  blocked: string | null;
  failure: string | null;
}

const isModel = (row: DiskRow) => row.kind === "model" && row.feature !== null && row.feature !== undefined;

/** Every plan row of the unit's feature (any level), for the code that drops or asks about a whole unit. */
export function jobRowIds(plan: DiskPlan, job: SetupJobId): string[] {
  const def = JOBS.find((candidate) => candidate.id === job);
  return def?.feature ? plan.rows.filter((row) => isModel(row) && row.feature === def.feature).map((row) => row.id) : [];
}
/** The unit that owns a plan row, or null when no unit asks about it (the always-on rows). */
export function jobOfRow(plan: DiskPlan, rowId: string): SetupJobId | null {
  const row = plan.rows.find((candidate) => candidate.id === rowId);
  return JOBS.find((def) => def.feature && row && isModel(row) && row.feature === def.feature)?.id ?? null;
}

export function buildSetupJobs(input: SetupJobsInput): SetupJob[] {
  const { plan, copy, householdHasMinors, hub } = input;
  const chosen = new Set(plan.default_selected);
  const out: SetupJob[] = [];
  for (const def of JOBS) {
    const words = copy.card(def.copy);
    if (def.hub) {
      const part = hub[def.id as "faces" | "ingredients"];
      if (!part) continue;
      const state = part.installed ? "installed" : part.installing ? "installing" : part.failure ? "failed" : "notInstalled";
      // A hub part is no plan row: the face finder starts on (it is small and the wizard installs it); the adapter needs a token and a licence first.
      out.push({ job: def.id, title: words.title, summary: words.summary, icon: def.icon, rowIds: [def.rowId!], askedRowIds: [def.rowId!], label: part.label, description: part.description, installedBytes: part.bytes, state, required: false, defaultOn: !part.blockedReason && (def.id === "faces" || part.installed), hubPart: true, blocked: part.installed ? null : part.blockedReason ?? null, failure: part.failure ?? null });
      continue;
    }
    const all = plan.rows.filter((row) => isModel(row) && row.feature === def.feature && (row.selectable || row.need === "required"));
    const base = all.filter((row) => householdHasMinors || row.minors_only !== true);
    if (base.length === 0) continue;
    const defaults = base.filter((row) => row.need === "required" || chosen.has(row.id) || (householdHasMinors && row.minors_only === true));
    const rows = defaults.length > 0 ? defaults : [base[0]!];
    const lead = rows.find((row) => row.need !== "required") ?? rows[0]!;
    const installed = rows.every((row) => row.installed);
    out.push({ job: def.id, title: words.title, summary: words.summary, icon: def.icon, rowIds: rows.map((row) => row.id), askedRowIds: all.map((row) => row.id), label: lead.label, description: lead.note, installedBytes: rows.reduce((total, row) => total + row.installed_bytes, 0), state: installed ? "installed" : "notInstalled", required: base.some((row) => row.need === "required"), defaultOn: defaults.length > 0, hubPart: false, blocked: null, failure: null });
  }
  return out;
}
