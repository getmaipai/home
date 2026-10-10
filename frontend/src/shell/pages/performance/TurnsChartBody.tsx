import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@maipai/ui/src/dashboard/components/ui/chart";
import type { PerformanceTurnDayStats } from "@/lib/api";


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
 * replies"). The page draws the `Card` around this body. */
export function TurnsChartBody({ byDay }: { byDay: readonly PerformanceTurnDayStats[] }) {
  return (
    <div>
      <ChartContainer config={chartConfig}>
        <LineChart data={byDay as PerformanceTurnDayStats[]} margin={{ top: 8, right: 4, bottom: 0, left: -10 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickFormatter={(v: string) => v.slice(5)} />
          <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} allowDecimals={false} />
          <ChartTooltip cursor={{ stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 4" }} content={<ChartTooltipContent />} />
          <Line dataKey="median_ttft_ms" type="linear" stroke="var(--color-primary)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: "var(--color-primary)", strokeWidth: 0 }} isAnimationActive animationDuration={700} animationEasing="ease-out" connectNulls={false} />
          <Line dataKey="median_total_ms" type="linear" stroke="var(--color-muted-foreground)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: "var(--color-muted-foreground)", strokeWidth: 0 }} isAnimationActive animationDuration={700} animationEasing="ease-out" connectNulls={false} />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
