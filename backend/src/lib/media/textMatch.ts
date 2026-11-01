import { or, sql, type SQL } from "drizzle-orm";
import { mediaItems } from "@/db/schema";

const FIELDS = [mediaItems.title, mediaItems.subtitle, mediaItems.artist, mediaItems.album, mediaItems.albumArtist,
  mediaItems.series, mediaItems.author, mediaItems.narrator, mediaItems.genre];

function escapedLike(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

export function titleMatch(query: string): SQL {
  const pattern = escapedLike(query);
  return or(...FIELDS.map((field) => sql`lower(${field}) LIKE lower(${pattern}) ESCAPE '\\'`))!;
}
