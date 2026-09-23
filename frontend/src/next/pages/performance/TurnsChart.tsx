import { getIcon } from "@maipai/ui/src/icons";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@maipai/ui/src/dashboard/components/ui/chart";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import type { PerformanceTurnDayStats } from "@/lib/api";

const GaugeIcon = getIcon("gauge");

const chartConfig = {
  median_ttft_ms: { label: "Median first token (ms)", color: "var(--color-primary)" },
  median_total_ms: { label: "Median total (ms)", color: "var(--color-muted-foreground)" },
} satisfies ChartConfig;

/** ADMIN-PERF-01: mirrors `dashboard/TurnsPerDayChart.tsx`'s own shape
 * (itself a mirror of the vendored `total-sales.tsx`) - one
 * `ChartContainer`/`LineChart`, two lines instead of one since the
 * panel's own job is comparing first-token time against total time,
 * not a single count. A day with no turns has `null` medians, which
 * recharts simply skips (a gap in the line, not a dip to zero - the
 * honest reading for "nothing happened," never mistaken for "instant
 * replies"). DASH-LOOK-01: plain `Card`, never `DashboardCard`. */
export function TurnsChart({ byDay }: { byDay: readonly PerformanceTurnDayStats[] }) {
  return (
    <Card className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <GaugeIcon size={16} className="text-muted-foreground" />
          Reply time per day
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 flex flex-col gap-6">
        <ChartContainer config={chartConfig} className="h-53.75! w-full">
          <LineChart data={byDay as PerformanceTurnDayStats[]} margin={{ top: 8, right: 4, bottom: 0, left: -10 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickFormatter={(v: string) => v.slice(5)} />
            <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} allowDecimals={false} />
            <ChartTooltip cursor={{ stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 4" }} content={<ChartTooltipContent />} />
            <Line dataKey="median_ttft_ms" type="linear" stroke="var(--color-primary)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: "var(--color-primary)", strokeWidth: 0 }} isAnimationActive animationDuration={700} animationEasing="ease-out" connectNulls={false} />
            <Line dataKey="median_total_ms" type="linear" stroke="var(--color-muted-foreground)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: "var(--color-muted-foreground)", strokeWidth: 0 }} isAnimationActive animationDuration={700} animationEasing="ease-out" connectNulls={false} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
