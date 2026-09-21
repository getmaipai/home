import { getIcon } from "@maipai/ui/src/icons";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@maipai/ui/src/dashboard/components/ui/chart";
import { CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { DashboardCard } from "@maipai/ui/src/dashboard/components/shared/dashboard-card";
import type { DashboardTurnsPerDay } from "@/lib/api";

// No "trending" icon in the kit's curated registry (@maipai/ui/src/icons) -
// "history" (a record over time) is the closest available match.
const HistoryIcon = getIcon("history");

const chartConfig = {
  count: { label: "Turns", color: "var(--color-primary)" },
} satisfies ChartConfig;

/** Mirrors `@maipai/ui/src/dashboard/components/dashboards/modern/total-sales.tsx`:
 * the same Card shell, header row and chart config shape (one
 * `ChartContainer`/`LineChart`, `CartesianGrid`/`XAxis`/`YAxis`/
 * `ChartTooltip` exactly as shipped). Dropped: the period selector (the
 * wire's own `turns_per_day` is always the fixed 30-day window, nothing
 * to select between) and the vendored file's own hand-rolled animated
 * tooltip content, in favor of the shipped `ChartTooltipContent`
 * primitive - a closer match to "as shipped" than reproducing custom
 * tooltip logic a second time. */
export function TurnsPerDayChart({ series }: { series: readonly DashboardTurnsPerDay[] }) {
  return (
    <DashboardCard className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon size={16} className="text-muted-foreground" />
          Turns per day
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 flex flex-col gap-6">
        <ChartContainer config={chartConfig} className="h-[215px]! w-full">
          <LineChart data={series as DashboardTurnsPerDay[]} margin={{ top: 8, right: 4, bottom: 0, left: -10 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis tickLine={false} axisLine={false} tickMargin={4} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} allowDecimals={false} />
            <ChartTooltip cursor={{ stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 4" }} content={<ChartTooltipContent />} />
            <Line dataKey="count" type="linear" stroke="var(--color-primary)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: "var(--color-primary)", strokeWidth: 0 }} isAnimationActive animationDuration={700} animationEasing="ease-out" />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </DashboardCard>
  );
}
