import { useEffect, useState } from "react";
import { Section } from "@/kit/primitives/Section";
import { Progress } from "@/kit/primitives/Progress";
import { api, ApiError, type RoutingStats } from "@/lib/api";

// The plan's own next step after shipping real skills (4.5): "count
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
    <Section heading="Skill routing">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        How often a chat message matches a skill directly versus falling through to the model.
      </p>
      {error ? (
        <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>
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
            <span>Matched a skill</span>
            <span className="text-[hsl(var(--muted-foreground))]">{stats.skill}</span>
          </div>
          <div className="flex items-center justify-between text-base">
            <span>Answered by the model</span>
            <span className="text-[hsl(var(--muted-foreground))]">{stats.model}</span>
          </div>
          {stats.skillError > 0 ? (
            <div className="flex items-center justify-between text-base">
              <span>Matched but failed to run</span>
              <span className="text-[hsl(var(--muted-foreground))]">{stats.skillError}</span>
            </div>
          ) : null}
          {stats.bySkill.length > 0 ? (
            <div className="flex flex-col divide-y divide-[hsl(var(--border))]">
              {stats.bySkill.map((s) => (
                <div key={s.skillId} className="flex items-center justify-between py-2 text-base">
                  <span>{s.skillId}</span>
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
