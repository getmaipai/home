// Home's words for the Stack's install plan. The Stack reports the level
// and the models; this file only says them plainly (Recommended, Moderate,
// Minimal, or below the minimum) so the page and the settings agree.
import type { StackInstallPlan } from "@/lib/stack/client";

export interface PlanWording {
  level: "recommended" | "moderate" | "minimal" | "below_minimum" | "unknown";
  headline: string;
  detail: string;
  /** What this level can do, one short line each. */
  gets: string[];
  /** Set when the person must say how much graphics memory they have. */
  needsMemoryAnswer: boolean;
  sizeLine: string | null;
  diskLine: string | null;
}

const GB = 1_073_741_824;
export const gbText = (bytes: number) => `${(bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0)} GB`;

const ALWAYS = ["Chat with Home", "Talk to Home and hear it answer", "Home remembers what matters"];
const GETS = {
  minimal: [...ALWAYS],
  moderate: [...ALWAYS, "Better answers from a second, smaller AI that double-checks"],
  recommended: [...ALWAYS, "Better answers from a second, smaller AI that double-checks", "Make pictures"],
} as const;

export function wordPlan(plan: StackInstallPlan | null): PlanWording {
  if (!plan) {
    return { level: "unknown", headline: "Home can't see this computer's AI yet", detail: "The AI engine isn't answering. Wait a minute and press Check again.", gets: [], needsMemoryAnswer: false, sizeLine: null, diskLine: null };
  }
  if (!plan.level) {
    if (plan.memory_source === "unknown") {
      return { level: "unknown", headline: "How much graphics memory does this computer have?", detail: "Home couldn't read it. Pick the total (VRAM) from the list, and Home will choose the right AI for it.", gets: [], needsMemoryAnswer: true, sizeLine: null, diskLine: null };
    }
    return { level: "below_minimum", headline: "This computer is too small to run the AI", detail: "Home needs about 16 GB of memory for the AI. You can use a bigger computer on your network for the AI instead. Go back and choose two computers.", gets: [], needsMemoryAnswer: false, sizeLine: null, diskLine: null };
  }
  const name = plan.level === "recommended" ? "Recommended" : plan.level === "moderate" ? "Moderate" : "Minimal";
  const headline = `${name} setup for this computer`;
  const sizeLine = plan.models.length ? `Download: ${gbText(plan.remaining_bytes)}` : null;
  const diskLine = plan.fits_disk === false ? `There is not enough free disk space. Home needs ${gbText(plan.remaining_bytes)} and this computer has ${gbText(plan.free_disk_bytes ?? 0)} free. Free some space or pick another folder.` : null;
  return { level: plan.level, headline, detail: plan.label, gets: [...GETS[plan.level]], needsMemoryAnswer: false, sizeLine, diskLine };
}
