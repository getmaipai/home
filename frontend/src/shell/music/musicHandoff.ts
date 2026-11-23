import type { Track } from "./musicQueue";
import { artworkUrlOf } from "./artworkUrl";

export interface AudioItemView {
  id: string;
  src?: string;
  title?: string;
  subtitle?: string | null;
  poster?: string | null;
  thumbnail?: string | null;
  duration_s?: number | null;
  kind?: string;
}

export function musicTrackOf(item: AudioItemView): Track | null {
  if (!item.src || !item.id || !item.title) return null;
  return {
    key: item.id,
    mediaId: item.id,
    url: item.src,
    title: item.title,
    ...(item.subtitle ? { subtitle: item.subtitle } : {}),
    artworkUrl: artworkUrlOf(item),
    duration: item.duration_s,
    state: "done",
    hasFile: true,
    mediaType: "audio/mp4",
  };
}

export interface MusicListContext {
  pathname: string;
  search: string;
  pageState?: Record<string, unknown>;
  item: Record<string, unknown>;
  mediaId: string;
}

/** Finds the audio package list behind the pressed row or collection action. */
export function musicListOf({ pathname, search, pageState, item, mediaId }: MusicListContext): { dataId: string; id?: string; query?: string; scope?: string; sort?: string; kind?: string; name?: string } | null {
  const clean = mediaId.startsWith("shuffle:") ? mediaId.slice("shuffle:".length) : mediaId.startsWith("radio:artist:") ? mediaId.slice("radio:artist:".length) : mediaId;
  const queueMode = typeof item.queue_mode === "string" ? item.queue_mode : undefined;
  if (queueMode === "album") return { dataId: "album", id: clean, name: typeof item.title === "string" ? item.title : undefined };
  if (queueMode === "artist") return { dataId: "artist", id: clean, name: typeof item.title === "string" ? item.title : undefined };
  if (queueMode === "playlist") return { dataId: "playlist", id: clean, name: typeof item.title === "string" ? item.title : undefined };
  const page = pathname.split("/").filter(Boolean).at(-1);
  const stateId = typeof pageState?.id === "string" ? pageState.id : undefined;
  if (page === "album" && stateId) return { dataId: "album", id: stateId, name: typeof pageState?.title === "string" ? pageState.title : undefined };
  if (page === "artist" && stateId) return { dataId: "artist", id: stateId, name: typeof pageState?.title === "string" ? pageState.title : undefined };
  if (page === "playlist" && stateId) return { dataId: "playlist", id: stateId, name: typeof pageState?.title === "string" ? pageState.title : undefined };
  if (typeof item.playlist_id === "string") return { dataId: "playlist", id: item.playlist_id, name: typeof pageState?.title === "string" ? pageState.title : undefined };
  if (page === "search") {
    const params = new URLSearchParams(search);
    const query = typeof pageState?.q === "string" ? pageState.q : typeof pageState?.query === "string" ? pageState.query : params.get("q") ?? undefined;
    if (query) return { dataId: "songs", query };
  }
  if (page === "library") return { dataId: "songs", scope: "library", sort: typeof pageState?.sort === "string" ? pageState.sort : undefined, kind: typeof pageState?.library_kind === "string" ? pageState.library_kind : undefined };
  if (["songs", "liked", "history"].includes(page ?? "")) return { dataId: page!, name: typeof pageState?.title === "string" ? pageState.title : undefined };
  if (typeof item.album_id === "string") return { dataId: "album", id: item.album_id, name: typeof item.album === "string" ? item.album : undefined };
  return null;
}


/** A clicked shelf row as the mini player can show it before any audio loads: what the person pressed, until the real track arrives. */
export interface PendingTrack {
  key: string;
  title: string;
  subtitle?: string;
  artworkUrl: string | null;
}

/** The clicked item becomes the pending track: its title, the artist line (the channel, else the subtitle) and the same artwork pick the shelves use. An item without a title gives nothing to show. */
export function pendingTrackOf(item: { title?: string | null; subtitle?: string | null; channel?: string | null; thumbnail?: string | null; poster?: string | null }, key: string): PendingTrack | null {
  const title = item.title?.trim();
  if (!title) return null;
  const subtitle = item.channel?.trim() || item.subtitle?.trim() || undefined;
  return {
    key: key.startsWith("shuffle:") ? key.slice("shuffle:".length) : key,
    title,
    ...(subtitle ? { subtitle } : {}),
    artworkUrl: artworkUrlOf({ thumbnail: item.thumbnail, poster: item.poster }),
  };
}
