// SF-08c: "Save as playlist" for the Queue pane. It writes a media_collections playlist through the hub's existing collection routes
// (POST /api/media/collections, then POST .../items for each song), the same code the Playlists page uses; it adds no store.
import { playlistIdOf, playlistSongs, queuePlaylistName, type QueueSource, type Track } from "./musicQueue";

type Send = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface SaveResult {
  id: string;
  title: string;
  /** Songs written to the playlist. */
  saved: number;
  /** Songs the hub did not accept (a sound, or a song it does not list as a library song). */
  skipped: number;
}

/** Makes the playlist and adds the songs in order. Throws with a plain sentence when the playlist itself could not be made. */
export async function saveQueueAsPlaylist(send: Send, queue: readonly Track[], index: number, source: QueueSource | null, today = new Date()): Promise<SaveResult> {
  const songs = playlistSongs(queue, index);
  const ids = songs.map(playlistIdOf);
  if (ids.every((id) => id === null)) throw new Error("There are no songs to save yet. Play a song first, then save the queue.");
  const title = queuePlaylistName(source, today);
  const made = await send<{ id: string; title: string }>("/api/media/collections", { method: "POST", body: JSON.stringify({ kind: "playlist", title }) });
  let saved = 0, skipped = songs.length - ids.filter((id) => id !== null).length;
  for (const id of ids) {
    if (id === null) continue;
    try {
      await send(`/api/media/collections/${encodeURIComponent(made.id)}/items`, { method: "POST", body: JSON.stringify({ media_id: id }) });
      saved += 1;
    } catch { skipped += 1; }
  }
  return { id: made.id, title: made.title, saved, skipped };
}
