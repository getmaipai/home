import type { AppRow } from "@/lib/api";

export interface MediaNavSection { page: string; label: string; icon: string | null; to: string }
export interface MediaNavApp { id: string; label: string; icon: string; to: string; sections: MediaNavSection[] }
export const MEDIA_APP_ORDER: readonly string[] = ["videos", "shows", "music", "podcasts", "books"];

/** The media apps as `GET /api/apps` lists them, in MEDIA_APP_ORDER. An app the hub does not list is absent;
 * every route is the media shell's own, `/media/<id>`, never the package's own `to`. */
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
      to: `/media/${id}`,
      sections: row.sections.map((section) => ({
        page: section.page,
        label: section.label,
        icon: section.icon,
        to: `/media/${id}/${section.page}`,
      })),
    }];
  });
}
