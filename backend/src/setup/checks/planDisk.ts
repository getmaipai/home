// The setup checks' disk row, sourced from the disk plan: the same plan,
// the same arithmetic and the same words as the installer's preflight and
// the wizard's plan step (lib/diskPlan.ts, shared/diskPlanMath.ts).
import type { StackInstallPlan } from "@/lib/stack/client";
import { defaultDiskPaths, planVolumes, recordedLevel, setupDiskVerdict, shippedPlanForLevel, type DiskIo } from "@/lib/diskPlan";

export type PlanDiskResult = { status: "green" | "amber" | "red"; message: string; fix?: string };

/** The plan this computer is held to: the Stack's own plan when it answers, otherwise the table shipped with Home for the recorded plan level. */
export function diskPlanOf(stackPlan: StackInstallPlan | null | undefined) {
  return stackPlan?.disk ?? shippedPlanForLevel(recordedLevel());
}

/** `aiFreeBytes`: the free space of the disk the Stack's data lives on, as the Stack reads it (null/undefined before a Stack exists). `aiElsewhere`: the Stack runs on another computer. */
export function planDiskCheck(options: { stackPlan?: StackInstallPlan | null; selected?: string[]; aiFreeBytes?: number | null; aiElsewhere?: boolean; io?: DiskIo }): PlanDiskResult {
  const plan = diskPlanOf(options.stackPlan);
  const volumes = planVolumes(defaultDiskPaths(), options.io ?? {}, { ...(options.aiFreeBytes !== undefined ? { aiFreeBytes: options.aiFreeBytes } : {}), ...(options.aiElsewhere ? { aiOnAnotherComputer: true } : {}) });
  const missingOnly = Boolean(options.stackPlan?.disk);
  // The checks come before the person picks what to install, so only the smallest setup can block here; a default setup that does not
  // fit is a warning that points at the plan screen, where turning off an extra or freeing space fixes it.
  const required = plan.rows.filter((row) => row.kind !== "engine" && row.need === "required").map((row) => row.id);
  const smallest = setupDiskVerdict(plan, required, volumes, { missingOnly, word: "smallest setup for this computer" });
  let verdict = smallest;
  if (smallest.state !== "red") {
    const full = setupDiskVerdict(plan, options.selected, volumes, { missingOnly });
    verdict = full.state === "red" ? { ...full, state: "amber", text: `${full.text.replace(/ Free up space, or choose a smaller plan\.$/, "")} The smallest setup fits: on the plan screen, turn off extras or free some space.`, fix: "Turn off extras on the plan screen, or free some space." } : full;
  }
  return { status: verdict.state, message: verdict.text, ...(verdict.fix ? { fix: verdict.fix } : {}) };
}
