// MEDIA-LIB-01: the duplicate finder. The same size, the same length (to the second) and the same title in two or more places is
// reported once, with where each copy lives. It only reports: nothing is hidden, merged or deleted, the person decides.
import { isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { itemFromRow, type MediaItem } from "./model";
import { matchKey } from "./parsers/text";

export interface DuplicateGroup {
  key: string;
  title: string;
  size: number;
  duration_s: number | null;
  items: Array<{ id: string; kind: MediaItem["kind"]; location: MediaItem["location"]; source_id: string; source_label: string | null }>;
}

export function findDuplicates(): DuplicateGroup[] {
  const labels = new Map(db.select({ id: mediaSources.id, label: mediaSources.label }).from(mediaSources).where(isNull(mediaSources.deletedAt)).all().map((row) => [row.id, row.label]));
  const groups = new Map<string, MediaItem[]>();
  for (const row of db.select().from(mediaItems).where(isNull(mediaItems.deletedAt)).all()) {
    if (row.size === null || row.size === 0 || row.kind === "chapter" || !labels.has(row.sourceId)) continue;
    const key = `${row.size}|${row.durationS === null ? "?" : Math.round(row.durationS)}|${matchKey(row.title)}`;
    const list = groups.get(key) ?? [];
    list.push(itemFromRow(row));
    groups.set(key, list);
  }
  const found: DuplicateGroup[] = [];
  for (const [key, items] of groups) {
    // Two copies in one folder tree are not "across roots"; a duplicate needs two different places.
    if (items.length < 2) continue;
    const places = new Set(items.map((item) => JSON.stringify(item.location)));
    if (places.size < 2) continue;
    found.push({
      key, title: items[0]!.title, size: items[0]!.size ?? 0, duration_s: items[0]!.duration_s,
      items: items.map((item) => ({ id: item.id, kind: item.kind, location: item.location, source_id: item.source_id, source_label: labels.get(item.source_id) ?? null })),
    });
  }
  return found.sort((a, b) => b.size - a.size);
}
