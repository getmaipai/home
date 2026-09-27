import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { NextDataTable } from "@/next/components/NextDataTable";
import { CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { kindStyle, packageState } from "@/apps/library/AppsPage";
import { api, ApiError, isOwnerOrAdminRole, type InstalledPackage, type Roster } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** /next/tools: SHELL-03's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - GET /api/plugins (the same real listing
 * `AppsPage.tsx`'s own `pluginsQuery` reads), rendered with Home's
 * shared table with a real Remove action. `kindStyle()` and `packageState()` are
 * imported from `AppsPage.tsx` rather than redefined here, so both
 * routes read the identical kind label and Ready/Attention rule. The
 * shared table keeps the vendored table's sorting, search, pagination
 * and CSV behavior, without its demo title or inert Action column. */
const AppsIcon = getIcon("package");

interface AppRow extends Record<string, unknown> {
  name: string;
  category: string;
  type: string;
  version: string;
  status: string;
  id: string;
}

function toRow(pkg: InstalledPackage): AppRow {
  const row = {
    name: pkg.display,
    category: pkg.category,
    type: kindStyle(pkg.kind).label,
    version: pkg.installed_version,
    status: packageState(pkg),
  };
  Object.defineProperty(row, "id", { value: pkg.id });
  return row as AppRow;
}

export function NextAppsPage({ person }: { person: Roster }) {
  useDocumentTitle("Tools");
  const query = useQuery<InstalledPackage[]>({ queryKey: ["plugins"], queryFn: () => api.plugins() });
  const queryClient = useQueryClient();

  async function removePackage(id: string) {
    try {
      await api.uninstallPackage(id);
      await queryClient.invalidateQueries({ queryKey: ["plugins"] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not remove that package.");
    }
  }

  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => query.refetch()}
      errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load your apps."}
      loadingLabel="Loading your apps"
    >
      {(rows: InstalledPackage[]) => (
        <div className="flex flex-col gap-4">
          <CardHeader className="p-0">
            <CardTitle className="flex items-center gap-2">
              <AppsIcon size={16} className="text-muted-foreground" />
              Tools
            </CardTitle>
          </CardHeader>
          <NextDataTable
            data={rows.map(toRow)}
            rowKey={(row) => row.id}
            rowActions={(row) => [{
              label: "Remove",
              destructive: true,
              confirmLabel: `Remove ${row.name}? This uninstalls it from the hub.`,
              disabled: !isOwnerOrAdminRole(person.role),
              onClick: () => removePackage(row.id),
            }]}
          />
        </div>
      )}
    </AsyncState>
  );
}
