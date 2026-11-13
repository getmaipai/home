// MP-06: the song a person chose to "Use in a video". It is remembered for this browser tab so the pickers that offer songs (the Library's Add music,
// the Studio's add-music picker) list it first and Add music opens with it chosen. Nothing here sends anything; it only orders a list.
const KEY = "maipai.music-bed-song";

export function rememberBedSong(id: string): void {
  try { sessionStorage.setItem(KEY, id); } catch { /* private window: the pickers just keep their own order */ }
}
export function bedSongId(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
/** The remembered song first, everything else in its own order. A song that is not in the list changes nothing. */
export function bedSongFirst<T extends { id: string }>(items: readonly T[], id: string | null = bedSongId()): T[] {
  const at = id ? items.findIndex((item) => item.id === id) : -1;
  return at <= 0 ? [...items] : [items[at]!, ...items.slice(0, at), ...items.slice(at + 1)];
}
