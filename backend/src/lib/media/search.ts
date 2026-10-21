import { or, sql, type SQL } from "drizzle-orm";
import { mediaItems } from "@/db/schema";
import type { PersonRow } from "@/types";
import { MEDIA_APP_IDS, madeFiles, queryItems, type MediaAppId } from "@/lib/media/appHost";

export interface MediaSearchRow {
  id: string;
  app: MediaAppId;
  kind: string;
  title: string;
  subtitle: string | null;
  artwork_url: string | null;
  href: string;
  percent: number | null;
  at: string;
}

export interface MediaSearchGroup {
  app: MediaAppId;
  heading: string;
  rows: MediaSearchRow[];
}

const HEADINGS: Record<MediaAppId, string> = {
  videos: "Videos",
  shows: "Shows and Films",
  music: "Music",
  podcasts: "Podcasts",
  books: "Books",
};

const FIELDS = [mediaItems.title, mediaItems.subtitle, mediaItems.artist, mediaItems.album, mediaItems.albumArtist,
  mediaItems.series, mediaItems.author, mediaItems.narrator, mediaItems.genre];

function escapedLike(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

function titleMatch(query: string): SQL {
  const pattern = escapedLike(query);
  return or(...FIELDS.map((field) => sql`lower(${field}) LIKE lower(${pattern}) ESCAPE '\\'`))!;
}

/** Search the same readable catalog the media apps use, plus Library-made songs and clips. */
export function searchMedia(person: PersonRow, query: string, perApp = 8): MediaSearchGroup[] {
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const where = titleMatch(normalized);
  const groups: MediaSearchGroup[] = [];
  for (const app of MEDIA_APP_IDS) {
    const catalogRows: MediaSearchRow[] = queryItems(person, app, { where, limit: perApp }).map((item) => ({
      id: item.id,
      app,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle ?? null,
      artwork_url: item.artwork ? `/api/media/items/${encodeURIComponent(item.id)}/artwork` : null,
      href: `/media/${encodeURIComponent(item.id)}`,
      percent: null,
      at: item.added_at,
    }));
    const rows: MediaSearchRow[] = [];
    if (app === "music" || app === "videos") {
      for (const file of madeFiles(person, app)) {
        if (!file.name.toLowerCase().includes(normalized.toLowerCase())) continue;
        rows.push({
          id: file.id,
          app,
          kind: app === "music" ? "track" : "video",
          title: file.name,
          subtitle: null,
          artwork_url: file.thumb_url,
          href: `/apps/${app}/${app === "music" ? "play" : "watch"}?id=${encodeURIComponent(file.id)}`,
          percent: null,
          at: file.created_at,
        });
        if (rows.length >= perApp) break;
      }
    }
    rows.push(...catalogRows.slice(0, Math.max(0, perApp - rows.length)));
    if (rows.length) groups.push({ app, heading: HEADINGS[app], rows: rows.slice(0, perApp) });
  }
  return groups;
}
