import { getIcon } from "@maipai/ui/src/icons";
import { NextDataTable } from "@/next/components/NextDataTable";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import type { PerformanceLabels } from "@/lib/api";

const FilterIcon = getIcon("filter");

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
export function LabelsCard({ labels }: { labels: PerformanceLabels }) {
  const rows: HitRow[] = [
    ...labels.guard_hits.map((h) => ({ kind: "guard", key: h.key, count: h.count })),
    ...labels.rule_hits.map((h) => ({ kind: "rule", key: h.key, count: h.count })),
    ...labels.rungs.map((h) => ({ kind: "rung", key: h.key, count: h.count })),
  ];
  return (
    <Card className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <FilterIcon size={16} className="text-muted-foreground" />
          Label harvest ({labels.turns} turn{labels.turns === 1 ? "" : "s"})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0! flex flex-col gap-4">
        <NextDataTable data={rows} />
        {labels.retire_eligible.length > 0 && (
          <p className="px-4 pb-4 text-sm text-muted-foreground">Zero hits this window, retire-eligible: {labels.retire_eligible.join(", ")}</p>
        )}
      </CardContent>
    </Card>
  );
}
