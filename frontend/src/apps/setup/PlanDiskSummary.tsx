import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import type { PlanDiskView } from "@/lib/api";
import { diskVerdict, freeGb, needGb, selectionTotals, sizeGb } from "../../../../shared/diskPlanMath";

const OkIcon = getIcon("check");
const WarnIcon = getIcon("alert-triangle");
const BadIcon = getIcon("circle-alert");

/** The live disk verdict for a choice: the same function the installer and the setup checks run. */
export function liveVerdict(disk: PlanDiskView, selected: ReadonlySet<string>) {
  return diskVerdict(disk.plan, selected, disk.volumes, { missingOnly: disk.source === "stack" });
}

/** INSTALL-DISK-01: the total for the choice, the free space and a green, amber or red check that says what to do. The job cards above it change `selected`, and all of it follows. */
export function PlanDiskSummary({ disk, selected }: { disk: PlanDiskView; selected: ReadonlySet<string> }) {
  const rows = disk.plan.rows.filter((row) => row.kind !== "engine");
  const missingOnly = disk.source === "stack";
  const totals = selectionTotals(disk.plan, selected, { missingOnly });
  const verdict = liveVerdict(disk, selected);
  const free = verdict.freeBytes;
  const Icon = verdict.state === "red" ? BadIcon : verdict.state === "amber" ? WarnIcon : OkIcon;
  return (
    <div className="flex flex-col gap-3" data-testid="plan-disk">
      <p className="flex items-baseline justify-between gap-3 font-medium"><span>Total on disk</span><span className="tabular-nums">{sizeGb(totals.installed_bytes)}</span></p>
      <p className="text-muted-foreground">Free space needed while it installs: about {needGb(verdict.requiredBytes)} GB (the total, 20 percent more, and room to unpack). Free space on this computer: {free === null ? "unknown" : `${freeGb(free)} GB`}.</p>
      <Alert variant={verdict.state === "red" ? "destructive" : verdict.state === "amber" ? "warning" : "default"} data-check-state={verdict.state}>
        <Icon aria-hidden />
        <AlertDescription>{verdict.text}{verdict.state === "red" && rows.some((row) => row.selectable && selected.has(row.id)) ? " You can also turn off an extra above." : ""}</AlertDescription>
      </Alert>
    </div>
  );
}
