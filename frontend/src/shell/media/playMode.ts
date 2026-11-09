// MUSIC-STAGE-01: shuffle and repeat for the music queue, kept on this device. The stage's buttons set them; the host's Next and its
// song-ended advance read them. Shuffle picks any later song of the queue; repeat "one" loops the song; repeat "all" starts the queue
// again from its first song when the last one ends.
import { useSyncExternalStore } from "react";

export type RepeatMode = "off" | "all" | "one";
export interface PlayMode { shuffle: boolean; repeat: RepeatMode }

const KEY = "music.playmode";
const read = (): PlayMode => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<PlayMode> | null;
    return { shuffle: saved?.shuffle === true, repeat: saved?.repeat === "all" || saved?.repeat === "one" ? saved.repeat : "off" };
  } catch { return { shuffle: false, repeat: "off" }; }
};

let mode: PlayMode = read();
const listeners = new Set<() => void>();

export const getPlayMode = (): PlayMode => mode;
export function setPlayMode(patch: Partial<PlayMode>): void {
  mode = { ...mode, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(mode)); } catch { /* the choice lasts until reload */ }
  listeners.forEach((listener) => listener());
}
export const nextRepeat = (repeat: RepeatMode): RepeatMode => (repeat === "off" ? "all" : repeat === "all" ? "one" : "off");
export function usePlayMode(): PlayMode {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getPlayMode, getPlayMode);
}

/** Which song comes next: with shuffle, any other song still ahead in the queue; otherwise the queue's own next song. With repeat "all"
 * and nothing ahead, the first song played this session (or the current one, replayed). */
export function chooseNext(opts: { nextId: string | null; ahead: readonly string[]; currentId: string; first?: string; mode: PlayMode; random?: () => number }): string | null {
  const { nextId, ahead, currentId, first, mode: m, random = Math.random } = opts;
  const others = ahead.filter((id) => id !== currentId);
  if (m.shuffle && others.length) return others[Math.floor(random() * others.length)] ?? null;
  if (nextId) return nextId;
  return m.repeat === "all" ? first ?? currentId : null;
}
