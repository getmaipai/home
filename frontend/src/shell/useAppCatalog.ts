import { useQuery } from "@tanstack/react-query";
import { api, type AppRow } from "@/lib/api";
import { mergeAppCatalog, type AppEntry } from "@/shell/appCatalog";
import { useIncognitoContext } from "@/shell/incognitoContext";

/** The package apps this person may open (`GET /api/apps`), one query shared by the search, the favorites and every
 * app page. Install, uninstall, update and role changes invalidate `["apps"]`; it also refetches on window focus. A
 * failed or pending read is an empty list, never an error: the core apps are always there. */
export function useAppRows(): AppRow[] | undefined {
  const data = useAppsQuery().data;
  return Array.isArray(data) ? data : undefined;
}

/** The same shared `["apps"]` query with its state, for a page that must tell "still loading" from "not an app". */
export function useAppsQuery() {
  return useQuery({ queryKey: ["apps"], queryFn: api.apps, retry: false, refetchOnWindowFocus: true });
}

/** The core apps merged with the package apps (`mergeAppCatalog`). */
export function useAppCatalog(): AppEntry[] {
  const { on: incognito } = useIncognitoContext();
  const rows = useAppRows();
  return mergeAppCatalog(rows, incognito);
}
