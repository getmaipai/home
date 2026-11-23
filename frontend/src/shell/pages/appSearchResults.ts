import type { SearchGroup } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderSearch";

/** Which app data an in-palette search reads, and the page that plays a hit. */
export const APP_SEARCH_DATA: Record<string, { data: string; playPage: string }> = {
  audio: { data: "songs", playPage: "play" },
  video: { data: "library", playPage: "watch" },
};

export interface AppSearchRow {
  id: string;
  title: string;
  channel?: string | null;
  thumbnail?: string | null;
}

/** The app's matching songs as the palette's own rows, with a last row to the app's full search page. */
export function appSearchGroups(
  app: { to: string; label: string; searchTo: string },
  query: string,
  rows: ReadonlyArray<AppSearchRow>,
  playPage: string = "play",
): SearchGroup[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const results = rows.slice(0, 8).map((row) => ({
    kind: "track",
    id: row.id,
    title: row.title,
    ...(row.channel ? { subtitle: row.channel } : {}),
    ...(row.thumbnail ? { thumbnail: row.thumbnail } : {}),
    href: `${app.to}/${playPage}?id=${encodeURIComponent(row.id)}`,
  }));
  results.push({
    kind: "app",
    id: "search",
    title: `See all results for "${q}"`,
    href: `${app.searchTo}?q=${encodeURIComponent(q)}`,
  });
  return [{ kind: "app", heading: app.label, results }];
}
