// MP-U2: what the song list decides without drawing anything: which rows a filter chip and the search box leave, how the style line
// splits into tags, how long a row reads, and what the take strip offers. The hub returns one card per song; a song asked for as
// several takes is already one card whose versions are the takes (MP-05), so nothing here regroups.
import type { MusicCard, MusicVersion, SavedSound } from "@/lib/musicApi";

export type LibraryFilter = "all" | "songs" | "sounds";
export type LibraryRow = { kind: "song"; key: string; card: MusicCard } | { kind: "sound"; key: string; sound: SavedSound };

/** The hub answers one tile instead of any locked song: no id, no title, nothing to read. */
export const isLockedTile = (card: unknown): card is { locked: true; making: boolean } => !!card && typeof card === "object" && (card as { locked?: unknown }).locked === true;

export const isMaking = (card: MusicCard): boolean => card.state === "queued" || card.state === "running";

/** `3:07`, or an empty string when the length is not known. */
export function clockOf(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return "";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The style line as tags: split on commas, trimmed, no empties, no repeats, at most `max`. A line with no comma stays whole. */
export function styleTags(description: string | null | undefined, max = 8): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of (description ?? "").split(/[,;\n]/)) {
    const tag = part.replace(/\s+/g, " ").trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length >= max) break;
  }
  return tags;
}

/** The takes of one card, in order, each with the label the hub gave it; empty for a song with one version. */
export function takeStrip(card: MusicCard): Array<{ id: string; number: number; label: string; seed: number | null }> {
  if (!card.takes || card.versions.length < 2) return [];
  return card.versions.map((version: MusicVersion, index: number) => ({ id: version.id, number: index + 1, label: version.label, seed: version.seed ?? null }));
}

/** The version a row plays: the chosen take when it is still there, else the current version, else the newest. */
export function playableVersion(card: MusicCard, takeId?: string | null): MusicVersion | undefined {
  return card.versions.find((version) => version.id === takeId) ?? card.versions.find((version) => version.id === card.current_id) ?? card.versions.at(-1);
}

const norm = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

/** One list from the songs and the saved sounds, filtered by the chip and the search words (title, style line, any tag).
 * The hub's one locked tile is never a row: it has nothing to read (see `isLockedTile`). */
export function libraryRows(cards: readonly MusicCard[], sounds: readonly SavedSound[], filter: LibraryFilter, query: string): LibraryRow[] {
  const q = norm(query);
  const songRows: LibraryRow[] = filter === "sounds" ? [] : cards.filter((card) => !isLockedTile(card) && !card.sound && (!q || norm(`${card.title ?? ""} ${card.description ?? ""}`).includes(q))).map((card) => ({ kind: "song", key: card.id, card }));
  const soundRows: LibraryRow[] = filter === "songs" ? [] : sounds.filter((sound) => !q || norm(sound.title).includes(q)).map((sound) => ({ kind: "sound", key: `sound-${sound.id}`, sound }));
  return [...songRows, ...soundRows];
}
