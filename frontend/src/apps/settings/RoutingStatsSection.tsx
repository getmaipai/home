import { useEffect, useState } from "react";
import { Section } from "@/kit/primitives/Section";
import { Progress } from "@/kit/primitives/Progress";
import { api, ApiError, type RoutingStats } from "@/lib/api";

// The plan's own next step after shipping real plugins (4.5): "count
// fall-throughs to chat using conversation history... and decide on
// tier 2 from the eval number." No new logging needed - every turn
// already records its source - this is the first place that number is
// ever actually shown to anyone, rather than sitting unread in the
// database.
export function RoutingStatsSection() {
  const [stats, setStats] = useState<RoutingStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .routingStats()
      .then(setStats)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load routing stats."));
  }, []);

  return (
    <Section heading="Plugin routing">
      <p className="text-base text-[hsl(var(--muted-foreground))]">
        How often a chat message matches a plugin directly versus falling through to the model.
      </p>
      {error ? (
        <p className="text-base text-[hsl(var(--destructive))]">{error}</p>
      ) : stats === null ? (
        <Progress mode="spinner" label="Loading routing stats" />
      ) : stats.total === 0 ? (
        <p className="text-base text-[hsl(var(--muted-foreground))]">No chat turns yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-base">
            <span>Fall-through rate</span>
            <span className="text-[hsl(var(--muted-foreground))]">
              {stats.fallthroughRate === null ? "—" : `${Math.round(stats.fallthroughRate * 100)}%`}
            </span>
          </div>
          <div className="flex items-center justify-between text-base">
            <span>Matched a plugin</span>
            <span className="text-[hsl(var(--muted-foreground))]">{stats.plugin}</span>
          </div>
          <div className="flex items-center justify-between text-base">
            <span>Matched a command</span>
            <span className="text-[hsl(var(--muted-foreground))]">{stats.command}</span>
          </div>
          <div className="flex items-center justify-between text-base">
            <span>Answered by the model</span>
            <span className="text-[hsl(var(--muted-foreground))]">{stats.model}</span>
          </div>
          {stats.pluginError > 0 ? (
            <div className="flex items-center justify-between text-base">
              <span>Matched a plugin but failed to run</span>
              <span className="text-[hsl(var(--muted-foreground))]">{stats.pluginError}</span>
            </div>
          ) : null}
          {stats.commandError > 0 ? (
            <div className="flex items-center justify-between text-base">
              <span>Matched a command but failed to run</span>
              <span className="text-[hsl(var(--muted-foreground))]">{stats.commandError}</span>
            </div>
          ) : null}
          {stats.byPlugin.length > 0 ? (
            <div className="flex flex-col divide-y divide-[hsl(var(--border))]">
              {stats.byPlugin.map((s) => (
                <div key={s.pluginId} className="flex items-center justify-between py-2 text-base">
                  <span>{s.pluginId}</span>
                  <span className="text-[hsl(var(--muted-foreground))]">{s.count}</span>
                </div>
              ))}
            </div>
          ) : null}
          {stats.byCommand.length > 0 ? (
            <div className="flex flex-col divide-y divide-[hsl(var(--border))]">
              {stats.byCommand.map((s) => (
                <div key={s.commandId} className="flex items-center justify-between py-2 text-base">
                  <span>{s.commandId}</span>
                  <span className="text-[hsl(var(--muted-foreground))]">{s.count}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}
