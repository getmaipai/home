// Derived identities and local similarity. Callers supply only authorized library tracks.
import type { MediaItem } from "./model";
export const albumKey = (item: MediaItem): string => JSON.stringify([item.album_artist ?? item.artist ?? "Unknown artist", item.album ?? "Unknown album"]);
export const artistKey = (item: MediaItem): string => item.artist ?? "Unknown artist";
export function albumOrder(items: readonly MediaItem[]): MediaItem[] {
  return [...items].sort((a, b) => (a.disc_no ?? 1) - (b.disc_no ?? 1) || (a.track_no ?? Number.MAX_SAFE_INTEGER) - (b.track_no ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
export function groupTracks(items: readonly MediaItem[], by: "album" | "artist"): Map<string, MediaItem[]> {
  const groups = new Map<string, MediaItem[]>();
  for (const item of items) {
    const key = by === "album" ? albumKey(item) : artistKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
export function radioTracks(items: readonly MediaItem[], seed: MediaItem): MediaItem[] {
  const same = (a: string | null, b: string | null) => !!a && !!b && a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const tier = (item: MediaItem) => item.id === seed.id ? 0 : same(item.artist, seed.artist) ? 1 : same(item.album_artist, seed.album_artist) ? 2 : same(item.genre, seed.genre) ? 3 : item.year && seed.year && Math.floor(item.year / 10) === Math.floor(seed.year / 10) ? 4 : 5;
  return items.filter((item) => tier(item) < 5).sort((a, b) => tier(a) - tier(b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
