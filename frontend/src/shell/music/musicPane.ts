// SF-08c: the Music right pane's open state. The shell's ONE right pane (rule S2) carries Queue and Recent as two of its tabs; the player bar's
// queue button asks for one of them here. When the shell has no pane to host them (a phone, or no companion), the bar opens the same content
// in a kit drawer instead, so `hosted` says which one answers. Plain store, no storage: closing the pane forgets it.
import { useSyncExternalStore } from "react";

export const QUEUE_TAB = "music-queue";
export const RECENT_TAB = "music-recent";
export type MusicPaneTab = typeof QUEUE_TAB | typeof RECENT_TAB;
export const isMusicTab = (id: string): id is MusicPaneTab => id === QUEUE_TAB || id === RECENT_TAB;

export interface MusicPaneState {
  /** The Music tab showing in the shell pane, or null when another tab (or no Music tab) shows. */
  tab: MusicPaneTab | null;
  /** Changes on every ask, so asking for the tab that is already chosen still opens the pane. */
  nonce: number;
  /** True while the shell has a right pane that can carry the tabs (a wide screen with a companion pane). */
  hosted: boolean;
}

export interface MusicPaneStore {
  get(): MusicPaneState;
  subscribe(listener: () => void): () => void;
  /** The bar's queue button: asks the shell pane for this tab. */
  request(tab: MusicPaneTab): void;
  /** The pane switched to another tab, or closed. */
  release(): void;
  /** The tab the person picked inside the pane. */
  select(tab: MusicPaneTab): void;
  setHosted(hosted: boolean): void;
}

export function createMusicPane(): MusicPaneStore {
  let state: MusicPaneState = { tab: null, nonce: 0, hosted: false };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<MusicPaneState>) => {
    const next = { ...state, ...patch };
    if (next.tab === state.tab && next.nonce === state.nonce && next.hosted === state.hosted) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    request: (tab) => set({ tab, nonce: state.nonce + 1 }),
    release: () => set({ tab: null }),
    select: (tab) => set({ tab }),
    setHosted: (hosted) => set({ hosted }),
  };
}

export const musicPane: MusicPaneStore = createMusicPane();

export function useMusicPane(store: MusicPaneStore = musicPane): MusicPaneState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
