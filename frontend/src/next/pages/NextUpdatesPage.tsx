import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { NextDataTable } from "@/next/components/NextDataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { rowsFrom, hasUpdate, type UpdateRow } from "@/apps/settings/UpdatesSection";
import { api, ApiError, isOwnerOrAdminRole, type UpdateProjection, type Roster } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** /next/updates: SHELL-07's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/updates` through Home's
 * shared table, reusing `UpdatesSection.tsx`'s own `rowsFrom()`/
 * `hasUpdate()` (exported, pure data logic) rather than a second
 * definition of "does this row have a real update" - one row for Home
 * itself, one per Stack engine and model when a Stack is configured,
 * exactly what the old page shows.
 *
 * Named gap: applying an engine update and rolling one back are real
 * actions on the old page (`UpdatesSection.tsx`'s own `ThingsTable`
 * `rowActions`, a kit block with a real callback surface) - Home's shared table is deliberately read-only, so applying updates
 * and rolling them back stay on the old route. Gated to owner/admin like the old page
 * (`UpdatesPage.tsx`'s own `AdminGatedContent`) even though `GET /api/
 * updates` itself is `requireAuth` only - matching the old page's own
 * visible gate is the parity this row asks for, not a new rule. */
// Exported: CHAT-HEADER-02's own nextPageHeaderTitle.tsx imports this
// directly for the header's left slot rather than re-declaring the
// icon name a second time - one definition, this page's own.
export const UpdatesIcon = getIcon("refresh-cw");

interface Row extends Record<string, unknown> {
  name: string;
  installed: string;
  available: string;
  lastChecked: string;
  status: string;
}

function toRow(row: UpdateRow): Row {
  return {
    name: row.name,
    installed: row.installed ?? "-",
    available: row.available ?? (row.kind === "engine" ? "Unknown" : "-"),
    lastChecked: row.lastChecked ? new Date(row.lastChecked).toLocaleString() : "Never",
    status: hasUpdate(row) ? "Update available" : "Up to date",
  };
}

export function NextUpdatesPage({ person }: { person: Roster }) {
  useDocumentTitle("Updates");
  const canManage = isOwnerOrAdminRole(person.role);
  const query = useQuery<UpdateProjection>({ queryKey: ["updates"], queryFn: () => api.updates(), enabled: canManage });

  return (
    <div className="flex flex-col gap-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2">
          <UpdatesIcon size={16} className="text-muted-foreground" />
          Updates
        </CardTitle>
      </CardHeader>

      {!canManage ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Only an owner or admin can manage updates.</p>
          </CardContent>
        </Card>
      ) : (
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load updates."}
          loadingLabel="Loading updates"
        >
          {(projection: UpdateProjection) => <NextDataTable data={rowsFrom(projection).map(toRow)} />}
        </AsyncState>
      )}
      {canManage && query.data?.referenceError && (
        <p className="text-sm text-destructive">Couldn't read installed reference sets for updates: {query.data.referenceError}</p>
      )}
    </div>
  );
}
