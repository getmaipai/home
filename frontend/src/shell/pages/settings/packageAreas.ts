// WEATHER-APP-01: a package's own settings area (`contributes.settings_area`, SPEC-SETAREA-01) as the shell
// draws it. The hub lists it on the app row (`GET /api/apps`); this merges those with the spec's central areas
// so `/settings/<id>` opens one. Home holds no layout of its own: the area is the package's declared object.
import type { AppRow } from "@/lib/api";
import type { SettingsAreaDef } from "@maipai/ui/src/settings/settingsAudience";
import { useAppsQuery } from "@/shell/useAppCatalog";
import { settingsArea } from "@/shell/pages/settings/settingsAreas";

/** The package areas on these app rows. A central area id is never overridden (the hub refuses one at install). */
export function packageAreasFrom(rows: readonly AppRow[] | undefined): SettingsAreaDef[] {
  const out: SettingsAreaDef[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const area = row.settings_area as unknown as SettingsAreaDef | undefined;
    if (area && !settingsArea(area.id) && !out.some((seen) => seen.id === area.id)) out.push(area);
  }
  return out;
}

/** Area id to the app route it belongs to (`area.app`), for the rail selection and the way back. */
export function packageAreaApps(areas: readonly SettingsAreaDef[]): Record<string, string> {
  return Object.fromEntries(areas.filter((area) => area.app).map((area) => [area.id, area.app!]));
}

/** The package areas from the shared `["apps"]` query. `ready` is false only while that list is still loading. */
export function usePackageAreas(): { areas: SettingsAreaDef[]; ready: boolean } {
  const query = useAppsQuery();
  return { areas: packageAreasFrom(query.data), ready: !query.isPending };
}
