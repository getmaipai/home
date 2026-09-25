import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { NextDataTable } from "@/next/components/NextDataTable";
import { CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { kindStyle, packageState } from "@/apps/library/AppsPage";
import { api, ApiError, type InstalledPackage } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** /next/tools: SHELL-03's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - GET /api/plugins (the same real listing
 * `AppsPage.tsx`'s own `pluginsQuery` reads), rendered with Home's
 * shared read-only table. `kindStyle()` and `packageState()` are
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
}

function toRow(pkg: InstalledPackage): AppRow {
  return {
    name: pkg.display,
    category: pkg.category,
    type: kindStyle(pkg.kind).label,
    version: pkg.installed_version,
    status: packageState(pkg),
  };
}

export function NextAppsPage() {
  useDocumentTitle("Tools");
  const query = useQuery<InstalledPackage[]>({ queryKey: ["plugins"], queryFn: () => api.plugins() });

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
          <NextDataTable data={rows.map(toRow)} />
        </div>
      )}
    </AsyncState>
  );
}
