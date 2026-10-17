import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import type { PlanDiskView } from "@/lib/api";
import { diskVerdict, freeGb, needGb, selectionTotals, sizeGb, type DiskRow } from "../../../../shared/diskPlanMath";

const OkIcon = getIcon("check");
const WarnIcon = getIcon("alert-triangle");
const BadIcon = getIcon("circle-alert");

/** The live disk verdict for a choice: the same function the installer and the setup checks run. */
export function liveVerdict(disk: PlanDiskView, selected: ReadonlySet<string>) {
  return diskVerdict(disk.plan, selected, disk.volumes, { missingOnly: disk.source === "stack" });
}

const NEED_WORD: Record<DiskRow["need"], string> = { required: "Needed", recommended: "Recommended", optional: "Optional" };

/** INSTALL-DISK-01: every install with its size, the total for the choice, the free space and a green, amber or red check that says what to do. Turning an extra off updates all of it. */
export function PlanDiskList({ disk, selected, onToggle }: { disk: PlanDiskView; selected: ReadonlySet<string>; onToggle: (id: string, on: boolean) => void }) {
  const rows = disk.plan.rows.filter((row) => row.kind !== "engine");
  const missingOnly = disk.source === "stack";
  const totals = selectionTotals(disk.plan, selected, { missingOnly });
  const engines = disk.plan.rows.filter((row) => row.kind === "engine" && rows.some((row2) => selected.has(row2.id) && !(missingOnly && row2.installed) && row2.engines.includes(row.id)));
  const engineBytes = engines.reduce((sum, row) => sum + row.installed_bytes, 0);
  const verdict = liveVerdict(disk, selected);
  const free = verdict.freeBytes;
  const Icon = verdict.state === "red" ? BadIcon : verdict.state === "amber" ? WarnIcon : OkIcon;
  return (
    <div className="flex flex-col gap-3" data-testid="plan-disk">
      <h4 className="text-base font-semibold">What gets installed</h4>
      <ul className="flex flex-col gap-2" aria-label="What gets installed">
        {rows.map((row) => {
          const on = selected.has(row.id) || row.need === "required";
          const size = <span className="whitespace-nowrap tabular-nums text-muted-foreground">{row.installed ? "Installed" : sizeGb(row.installed_bytes)}</span>;
          if (!row.selectable) {
            return (
              <li key={row.id} className="flex items-baseline justify-between gap-3">
                <span>{row.label}<span className="text-muted-foreground"> ({NEED_WORD[row.need].toLowerCase()})</span></span>{size}
              </li>
            );
          }
          return (
            <li key={row.id}>
              <Field orientation="horizontal">
                <Checkbox id={`disk-${row.id}`} checked={on} onCheckedChange={(value) => onToggle(row.id, value === true)} />
                <FieldContent>
                  <FieldLabel htmlFor={`disk-${row.id}`}>{row.label}</FieldLabel>
                  <FieldDescription>{NEED_WORD[row.need]}. {row.note}</FieldDescription>
                </FieldContent>
                {size}
              </Field>
            </li>
          );
        })}
        {engines.length ? <li className="flex items-baseline justify-between gap-3"><span>Engine tools the choices above run on</span><span className="whitespace-nowrap tabular-nums text-muted-foreground">{sizeGb(engineBytes)}</span></li> : null}
      </ul>
      <p className="flex items-baseline justify-between gap-3 font-medium"><span>Total on disk</span><span className="tabular-nums">{sizeGb(totals.installed_bytes)}</span></p>
      <p className="text-muted-foreground">Free space needed while it installs: about {needGb(verdict.requiredBytes)} GB (the total, 20 percent more, and room to unpack). Free space on this computer: {free === null ? "unknown" : `${freeGb(free)} GB`}.</p>
      <Alert variant={verdict.state === "red" ? "destructive" : verdict.state === "amber" ? "warning" : "default"} data-check-state={verdict.state}>
        <Icon aria-hidden />
        <AlertDescription>{verdict.text}{verdict.state === "red" && rows.some((row) => row.selectable && selected.has(row.id)) ? " You can also turn off an extra above." : ""}</AlertDescription>
      </Alert>
    </div>
  );
}
