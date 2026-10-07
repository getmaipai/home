import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable } from "@/shell/components/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { api, ApiError, isOwnerOrAdminRole, type Issue, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

/** /next/repairs: SHELL-07's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/repairs` through Home's
 * shared table: severity, title, detail and the fix's own label, the
 * same fields `RepairsSection.tsx` shows.
 *
 * Named gap: running a fix or dismissing an issue are real actions on
 * the old page (`RepairsSection.tsx`'s own `Button` per row, a real
 * `onClick`) - Home's shared table is deliberately read-only, so running fixes and
 * dismissing issues stay on the old route. Gated to owner/admin like
 * the old page and the backend both agree on here (`GET /api/repairs`
 * itself is `requireRole("owner", "admin")`, unlike Updates' looser
 * read gate). */
// Exported: CHAT-HEADER-02's own pageHeaderTitle.tsx imports this
// directly for the header's left slot rather than re-declaring the
// icon name a second time - one definition, this page's own.
export const RepairsIcon = getIcon("wrench");

interface Row extends Record<string, unknown> {
  title: string;
  status: string;
  detail: string;
  fix: string;
  id: string;
}

function toRow(issue: Issue): Row {
  const row = {
    title: issue.title,
    status: issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1),
    detail: issue.detail,
    fix: issue.fix?.label ?? "-",
  };
  Object.defineProperty(row, "id", { value: issue.id });
  return row as Row;
}

export function RepairsPage({ person }: { person: Roster }) {
  useTabItem("Repairs");
  const canManage = isOwnerOrAdminRole(person.role);
  const query = useQuery<Issue[]>({ queryKey: ["repairs"], queryFn: () => api.repairs(), enabled: canManage });
  const queryClient = useQueryClient();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  async function runFix(id: string) {
    setPendingIds((previous) => new Set(previous).add(id));
    try {
      await api.fixIssue(id);
      await queryClient.invalidateQueries({ queryKey: ["repairs"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not fix that repair.");
    } finally {
      setPendingIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }

  async function dismissIssue(id: string) {
    setPendingIds((previous) => new Set(previous).add(id));
    try {
      await api.dismissIssue(id);
      await queryClient.invalidateQueries({ queryKey: ["repairs"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not dismiss that repair.");
    } finally {
      setPendingIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2">
          <RepairsIcon size={16} className="text-muted-foreground" />
          Repairs
        </CardTitle>
      </CardHeader>

      {!canManage ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Only an owner or admin can manage repairs.</p>
          </CardContent>
        </Card>
      ) : (
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load repairs."}
          loadingLabel="Loading repairs"
        >
          {(issues: Issue[]) => (
            <DataTable
              data={issues.map(toRow)}
              rowKey={(row) => row.id}
              rowActions={(row) => {
                const issue = issues.find((candidate) => candidate.id === row.id);
                if (!issue) return [];
                const isPending = pendingIds.has(issue.id);
                return [
                  ...(issue.fix ? [{ label: issue.fix.label, onClick: () => runFix(issue.id), disabled: isPending }] : []),
                  {
                    label: "Dismiss",
                    destructive: true,
                    confirmLabel: `Dismiss "${issue.title}"?`,
                    onClick: () => dismissIssue(issue.id),
                    disabled: isPending,
                  },
                ];
              }}
            />
          )}
        </AsyncState>
      )}
    </div>
  );
}
