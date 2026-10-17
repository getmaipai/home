// Home's words for the Stack's install plan. The Stack reports the level
// and the models; this file only says them plainly (Recommended, Moderate,
// Minimal, or below the minimum) so the page and the settings agree.
import type { StackInstallPlan } from "@/lib/stack/client";
import { shippedDiskPlan } from "@/lib/diskPlan";
import { diskVerdict, needGb, selectionTotals, sizeGb, type DiskPlan, type DiskVolume } from "../../../shared/diskPlanMath";

/** The plan step's disk list (INSTALL-DISK-01): every install with its size, which are on by default, where the files land and how much room each place has, so the page can total a choice and check it live with the same function the installer uses. */
export interface PlanDiskView {
  source: "stack" | "shipped";
  plan: DiskPlan;
  volumes: DiskVolume[];
  /** The verdict for the default selection. */
  verdict: { state: "green" | "amber" | "red"; text: string; fix: string; requiredBytes: number; freeBytes: number | null };
}

export interface PlanWording {
  level: "recommended" | "moderate" | "minimal" | "below_minimum" | "unknown";
  headline: string;
  detail: string;
  /** What this level can do, one short line each. */
  gets: string[];
  /** Set when the person must say how much graphics memory they have. */
  needsMemoryAnswer: boolean;
  sizeLine: string | null;
  /** Set when the default selection does not fit on disk (the state "red"); it blocks Install. */
  diskLine: string | null;
  /** The disk plan: rows with sizes, the volumes, the verdict. Null when there is no plan to size. */
  disk: PlanDiskView | null;
}

const GB = 1_073_741_824;
export const gbText = (bytes: number) => `${(bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0)} GB`;

/** SETUP-VOICE-01: voice is in every plan (speech to text and speech out). The line names it so the person
 * sees it is included; the microphone is asked at first use, not in setup. */
export const VOICE_LINE = "Voice: talk to Home";
const ALWAYS = ["Chat with Home", "Home remembers what matters"];
const GETS = {
  minimal: [...ALWAYS],
  moderate: [...ALWAYS, "Better answers from a second, smaller AI that double-checks"],
  recommended: [...ALWAYS, "Better answers from a second, smaller AI that double-checks", "Make pictures"],
} as const;

/** The plan lists voice when its models carry both voice roles; a plan with no model list yet falls back to the
 * role lists in setupDownloads.ts, which hold both for every level. */
function planHasVoice(plan: StackInstallPlan): boolean {
  if (plan.models.length === 0) return true;
  const roles = new Set(plan.models.map((model) => model.role));
  return roles.has("stt") && roles.has("tts");
}

export function wordPlan(plan: StackInstallPlan | null, volumes?: DiskVolume[]): PlanWording {
  if (!plan) {
    return { level: "unknown", headline: "Home can't see this computer's AI yet", detail: "The AI engine isn't answering. Wait a minute and press Check again.", gets: [], needsMemoryAnswer: false, sizeLine: null, diskLine: null, disk: null };
  }
  if (!plan.level) {
    if (plan.memory_source === "unknown") {
      return { level: "unknown", headline: "How much graphics memory does this computer have?", detail: "Home couldn't read it. Pick the total (VRAM) from the list, and Home will choose the right AI for it. On a Mac, pick the Mac's total memory, because a Mac shares one pool of memory between the apps and the AI.", gets: [], needsMemoryAnswer: true, sizeLine: null, diskLine: null, disk: null };
    }
    const macLine = plan.memory_source === "unified" ? ` This Mac has ${Math.round(plan.memory_gb)} GB of memory in total.` : "";
    return { level: "below_minimum", headline: "This computer is too small to run the AI", detail: `Home needs about 16 GB of memory for the AI.${macLine} You can use a bigger computer on your network for the AI instead. Go back and choose two computers.`, gets: [], needsMemoryAnswer: false, sizeLine: null, diskLine: null, disk: null };
  }
  const name = plan.level === "recommended" ? "Recommended" : plan.level === "moderate" ? "Moderate" : "Minimal";
  const headline = `${name} setup for this computer`;
  const diskPlan = plan.disk ?? (plan.tier ? shippedDiskPlan(plan.tier) : null);
  const places = volumes ?? [{ freeBytes: plan.free_disk_bytes, needs: ["home", "data", "ai"] as Array<"home" | "data" | "ai"> }];
  let disk: PlanDiskView | null = null;
  let sizeLine = plan.models.length ? `Download: ${gbText(plan.remaining_bytes)}` : null;
  let diskLine: string | null = null;
  if (diskPlan) {
    const verdict = diskVerdict(diskPlan, diskPlan.default_selected, places, { missingOnly: Boolean(plan.disk) });
    disk = { source: plan.disk ? "stack" : "shipped", plan: diskPlan, volumes: places, verdict: { state: verdict.state, text: verdict.text, fix: verdict.fix, requiredBytes: verdict.requiredBytes, freeBytes: verdict.freeBytes } };
    const totals = selectionTotals(diskPlan, diskPlan.default_selected);
    sizeLine = `On disk: ${sizeGb(totals.installed_bytes)}. Needs ${needGb(verdict.requiredBytes)} GB free while it installs.`;
    diskLine = verdict.state === "red" ? verdict.text : null;
  }
  return { level: plan.level, headline, detail: plan.label, gets: [...GETS[plan.level]].flatMap((line, i) => (i === 1 && planHasVoice(plan) ? [VOICE_LINE, line] : [line])), needsMemoryAnswer: false, sizeLine, diskLine, disk };
}
