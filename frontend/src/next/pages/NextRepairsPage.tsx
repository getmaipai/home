import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { NextDataTable } from "@/next/components/NextDataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { api, ApiError, isOwnerOrAdminRole, type Issue, type Roster } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

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
// Exported: CHAT-HEADER-02's own nextPageHeaderTitle.tsx imports this
// directly for the header's left slot rather than re-declaring the
// icon name a second time - one definition, this page's own.
export const RepairsIcon = getIcon("wrench");

interface Row extends Record<string, unknown> {
  title: string;
  status: string;
  detail: string;
  fix: string;
}

function toRow(issue: Issue): Row {
  return {
    title: issue.title,
    status: issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1),
    detail: issue.detail,
    fix: issue.fix?.label ?? "-",
  };
}

export function NextRepairsPage({ person }: { person: Roster }) {
  useDocumentTitle("Repairs");
  const canManage = isOwnerOrAdminRole(person.role);
  const query = useQuery<Issue[]>({ queryKey: ["repairs"], queryFn: () => api.repairs(), enabled: canManage });

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
          {(issues: Issue[]) => <NextDataTable data={issues.map(toRow)} />}
        </AsyncState>
      )}
    </div>
  );
}
