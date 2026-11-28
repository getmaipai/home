import type { SearchGroup } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderSearch";

/** Which app data an in-palette search reads, and the page that plays a hit. */
export const APP_SEARCH_DATA: Record<string, { data: string; playPage: string }> = {
  audio: { data: "songs", playPage: "play" },
  video: { data: "library", playPage: "watch" },
  podcasts: { data: "directory", playPage: "show" },
};

export interface AppSearchRow {
  id: string;
  title: string;
  channel?: string | null;
  thumbnail?: string | null;
  feed_url?: string;
  action_label?: string;
}

/** The app's matching songs as the palette's own rows; no row links to a separate search page. */
export function appSearchGroups(
  app: { to: string; label: string },
  query: string,
  rows: ReadonlyArray<AppSearchRow>,
  playPage: string = "play",
): SearchGroup[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const results = rows.slice(0, 20).map((row) => ({
    kind: row.feed_url ? "app" : "track",
    id: row.id,
    title: row.title,
    ...(row.channel ? { subtitle: row.channel } : {}),
    ...(row.thumbnail ? { thumbnail: row.thumbnail } : {}),
    href: `${app.to}/${playPage}?id=${encodeURIComponent(row.feed_url || row.id)}`,
    ...(row.feed_url ? { action: row.action_label ?? "Follow" } : {}),
  }));
  if (results.length === 0) return [];
  return [{ kind: "app", heading: app.label, results }];
}
