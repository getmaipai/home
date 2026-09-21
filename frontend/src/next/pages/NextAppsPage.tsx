import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import DataTable from "@maipai/ui/src/dashboard/components/tables/data-table/DataTable";
import { CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { getIcon } from "@maipai/ui/src/icons";
import { kindStyle, packageState } from "@/apps/library/AppsPage";
import { api, ApiError, type InstalledPackage } from "@/lib/api";

/** /next/apps: SHELL-03's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - GET /api/plugins (the same real listing
 * `AppsPage.tsx`'s own `pluginsQuery` reads) through the template's
 * shipped `DataTable` (`@maipai/ui/src/dashboard/components/tables/
 * data-table/DataTable.tsx`), as shipped: unlike the dashboard's demo
 * widgets, this component genuinely takes a `data` prop and derives its
 * own columns from the row shape it's handed, so no gap-composition was
 * needed here - the row shape below is exactly the lever "as shipped"
 * leaves for choosing what shows. `kindStyle()` and `packageState()`
 * are imported from `AppsPage.tsx` rather than redefined here, so both
 * routes read the identical kind label and Ready/Attention rule.
 *
 * Two named gaps, the same way SHELL-01 named its own before writing a
 * line: `DataTable`'s own header is a literal "Employee Data Table"
 * string baked into its JSX, no title prop to override it - a real
 * `CardHeader`/`CardTitle` (the same shipped primitives every other
 * `/next` page's own card header already uses) above it is the fix
 * that doesn't touch the vendored file, so the page's real title reads
 * correctly even though the table's own internal one still doesn't.
 * Second, its per-row "Action" column (a pencil and a trash icon) has
 * no click handler of any kind wired to it in the vendored file - not a
 * prop this page can pass in, since adding one would be forking a
 * vendored component. Real install/remove stays on `AppsPage.tsx` (the
 * old shell's own route, with its own `DetailsPane` and a real Remove
 * action) until a shipped table with an actions callback exists to
 * move it to; this row is the read-only listing only. */
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
              Apps
            </CardTitle>
          </CardHeader>
          <DataTable data={rows.map(toRow)} />
        </div>
      )}
    </AsyncState>
  );
}
