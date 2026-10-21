import type { AppRow } from "@/lib/api";

export interface MediaNavApp { id: string; label: string; icon: string; to: string }
export const MEDIA_APP_ORDER: readonly string[] = ["videos", "shows", "music", "podcasts", "books"];

/** The media apps as `GET /api/apps` lists them, in MEDIA_APP_ORDER. An app the hub does not list is absent;
 * every route is the row's own `to`. */
export function mediaNav(rows: AppRow[] | undefined): MediaNavApp[] {
  const byPackage = new Map<string, AppRow>();
  for (const row of rows ?? []) byPackage.set(row.package, row);
  return MEDIA_APP_ORDER.flatMap((id) => {
    const row = byPackage.get(id);
    if (!row) return [];
    return [{
      id,
      label: row.label,
      icon: row.icon,
      to: row.to,
    }];
  });
}
