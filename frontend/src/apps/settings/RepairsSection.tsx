import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { List } from "@/kit/primitives/List";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { Button } from "@/kit/ui/button";
import { Badge } from "@/kit/ui/badge";
import { useToast } from "@/kit/primitives/Toast";
import { api, ApiError, type Issue } from "@/lib/api";

const SEVERITY_VARIANT: Record<Issue["severity"], "destructive" | "outline" | "secondary"> = {
  error: "destructive",
  warning: "outline",
  info: "secondary",
};

// GET /api/repairs (backend/src/routes/repairs.ts): real and fully
// landed (F step 1) - the flagship Step 3 page, unlike Health/Updates/
// Storage/the store below it in docs/BACKLOG.md, none of which have a
// real backend yet. Not a schema `list` node: an Issue's `fix` and
// `learn_more` are both nullable per-row (a generic row_action can't
// conditionally disappear per row), so this stays hand-written the same
// way People/Privacy/Settings already did for a comparable reason
// (docs/dev.md's A2UI entry).
const REPAIRS_QUERY_KEY = ["repairs"];

export function RepairsSection() {
  const query = useQuery<Issue[]>({ queryKey: REPAIRS_QUERY_KEY, queryFn: () => api.repairs() });
  const queryClient = useQueryClient();
  const { push } = useToast();
  // Every row currently mid-fix/dismiss, so the click that started one
  // can't be pressed a second time while it's still running, WITHOUT
  // also re-enabling every other row's buttons the moment a second row
  // is clicked - a `Set`, not a single id (a code review, 2026-09-06,
  // caught the single-id version: clicking row B while row A's action
  // was still in flight re-enabled row A, reachable for a real double
  // fire).
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  async function runAction(id: string, action: (id: string) => Promise<unknown>, failureVerb: string) {
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      await action(id);
      // invalidateQueries, not this query's own `refetch()` (the
      // pattern PeoplePage.tsx's `invalidateRoster` already
      // established): a future second surface reading `["repairs"]`
      // gets refreshed too, not just this component's own instance.
      await queryClient.invalidateQueries({ queryKey: REPAIRS_QUERY_KEY });
    } catch (e) {
      push(e instanceof ApiError ? e.message : `Could not ${failureVerb} that repair.`);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => query.refetch()}
      errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load repairs."}
      loadingLabel="Loading repairs"
    >
      {/* Deliberately no `isEmpty` prop here: AsyncState renders its own
          generic EmptyState the instant `isEmpty` is true, before
          `children` ever runs - this step's own text wants a specific
          "healthy hub" empty state (icon, copy), not the generic
          "Nothing here yet.", so the empty-vs-list branch stays inside
          `children` instead. */}
      {(issues) =>
        issues.length === 0 ? (
          <EmptyState icon="check" text="Everything looks good. No repairs needed." />
        ) : (
          <List
            items={issues}
            getKey={(issue) => issue.id}
            label="Repairs"
            renderItem={(issue) => (
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                <div className="flex items-center gap-2">
                  <Badge variant={SEVERITY_VARIANT[issue.severity]}>{issue.severity}</Badge>
                  <span className="truncate text-base font-medium">{issue.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">{issue.detail}</p>
                {issue.learn_more ? (
                  // A plain anchor, not react-router's `Link`: this
                  // points into `docs/user/`/`docs/dev/` (Issue's own
                  // schema comment), a separate static site F builds
                  // (getmaipai/.github/CLAUDE.md's Documentation
                  // section), not a route this SPA's own App.tsx
                  // declares - a code review, 2026-09-06, found `Link`
                  // navigating to a path matched by no `<Route>` at all,
                  // landing on a silently blank Shell.
                  <a href={issue.learn_more} className="text-sm text-primary underline">
                    Learn more
                  </a>
                ) : null}
              </div>
            )}
            renderAction={(issue) => (
              <div className="flex shrink-0 items-center gap-2">
                {issue.fix ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pendingIds.has(issue.id)}
                    onClick={() => runAction(issue.id, api.fixIssue, "fix")}
                  >
                    {issue.fix.label}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pendingIds.has(issue.id)}
                  onClick={() => runAction(issue.id, api.dismissIssue, "dismiss")}
                >
                  Dismiss
                </Button>
              </div>
            )}
          />
        )
      }
    </AsyncState>
  );
}
