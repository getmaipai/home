import { DataTable } from "@maipai/ui/src/elements/data-table";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { DataTableControls } from "@/shell/components/DataTableControls";
import type { PerformanceLabels } from "@/lib/api";

interface HitRow extends Record<string, unknown> {
  kind: string;
  key: string;
  count: number;
}

/** ADMIN-PERF-01: RVW-1's label harvest (`backend/scripts/bench/
 * labels.ts`), read live over the window rather than off its weekly
 * export file - see docs/dev.md and `lib/performance.ts`'s own header
 * for why. Guard hits, rule hits and rungs share one table (a "kind"
 * column) rather than three - the same numbers `formatReport()`
 * prints as three sections, composed here from one shared table instead
 * of three. `retire_eligible` (the org rule: a rule with zero hits over
 * the window is a candidate to retire) is a plain list underneath,
 * since it names rules, not counts. */
export function LabelsBody({ labels }: { labels: PerformanceLabels }) {
  const rows: HitRow[] = [
    ...labels.guard_hits.map((h) => ({ kind: "guard", key: h.key, count: h.count })),
    ...labels.rule_hits.map((h) => ({ kind: "rule", key: h.key, count: h.count })),
    ...labels.rungs.map((h) => ({ kind: "rung", key: h.key, count: h.count })),
  ];
  const model = useDataTableModel(rows, tableColumns<HitRow>(["kind", "key", "count"], { kind: 100, key: 300, count: 80 }));
  return (
    <>
      <DataTable {...model} toolbar={<DataTableControls model={model} />} caption="Label harvest counts" getRowId={(row) => `${row.kind}-${row.key}`} />
      {labels.retire_eligible.length > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">Zero hits this window, retire-eligible: {labels.retire_eligible.join(", ")}</p>
      )}
    </>
  );
}
