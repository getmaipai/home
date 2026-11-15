// SF-08d: the like heart on the Music bar. It writes the person's own liked collection through the Audio app's existing like action
// (POST /api/plugins/audio/like, the same one the Now playing stage uses) and reads which titles are liked from GET /api/media/collections.
// The heart turns at once and goes back if the hub says no.
import { useEffect, useSyncExternalStore } from "react";
import type { Track } from "./musicQueue";

type Ask = <T>(path: string, init?: RequestInit) => Promise<T>;

/** The id a track is liked under: its media id when it has one, else its file id (the key). */
export const likeIdOf = (track: Track): string => track.mediaId ?? track.key;

/** The shell's request helper, loaded when first needed so the store itself stays light. */
const shellRequest: Ask = async (path, init) => (await import("@/lib/api")).request(path, init);

export function createLikeStore(ask: Ask = shellRequest) {
  let liked = new Set<string>();
  const overrides = new Map<string, boolean>();
  let loaded = false;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  let version = 0;
  const publish = () => { version++; listeners.forEach((listener) => listener()); };
  const store = {
    isLiked: (id: string) => liked.has(id),
    version: () => version,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Reads the person's liked titles once. A failure leaves every heart empty and is tried again next time. */
    load(): Promise<void> {
      if (loaded) return Promise.resolve();
      if (loading) return loading;
      loading = (async () => {
        try {
          const lists = await ask<Array<{ kind: string; items: Array<{ media_id: string }> }>>("/api/media/collections?kind=liked");
          liked = new Set(lists.flatMap((list) => (list.kind === "liked" ? list.items.map((item) => item.media_id) : [])));
          for (const [id, on] of overrides) { if (on) liked.add(id); else liked.delete(id); }
          loaded = true;
          publish();
        } catch { /* hearts stay empty */ }
        finally { loading = null; }
      })();
      return loading;
    },
    /** Flips the heart for `track`. Resolves true when the hub kept it, false when it was rolled back. */
    async toggle(track: Track): Promise<boolean> {
      const id = likeIdOf(track);
      const wasOn = liked.has(id);
      const on = !liked.has(id);
      const set = (value: boolean) => { liked = new Set(liked); if (value) liked.add(id); else liked.delete(id); publish(); };
      overrides.set(id, on);
      set(on);
      try {
        await ask("/api/plugins/audio/like", { method: "POST", body: JSON.stringify({ media_id: id, on }) });
        return true;
      } catch { overrides.set(id, wasOn); set(wasOn); return false; }
    },
    /** Test seam. */
    _reset() { liked = new Set(); overrides.clear(); loaded = false; loading = null; publish(); },
  };
  return store;
}
export type LikeStore = ReturnType<typeof createLikeStore>;

export const likes: LikeStore = createLikeStore();

/** Whether `track` is liked, and the toggle. Loads the person's list the first time a heart is drawn. */
export function useLike(track: Track | null, store: LikeStore = likes): { liked: boolean; toggle: () => Promise<boolean> } {
  useSyncExternalStore(store.subscribe, store.version, store.version);
  useEffect(() => { void store.load(); }, [store]);
  return { liked: track ? store.isLiked(likeIdOf(track)) : false, toggle: () => (track ? store.toggle(track) : Promise.resolve(false)) };
}
