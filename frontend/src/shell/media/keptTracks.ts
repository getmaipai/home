// MEDIA-PARITY-02: Music's "Save for offline" and the Library's Downloaded filter, on the offline mechanism the app already has
// (lib/offlineMedia.ts: the person's own bucket in the browser cache, filled straight from the hub and served by the service worker).
// This file adds no storage. After a copy is kept or removed, and when the app starts, the device tells the hub which songs it keeps
// (POST /api/plugins/music/offline), so the Library can mark them and filter to them. Safari and other WebKit browsers cannot keep
// copies (keepOnDevice says so in its own words); the phone app is the way there.
import { i18n } from "@lingui/core";
import { keepOnDevice, listKept, removeFromDevice } from "@/lib/offlineMedia";
import { request } from "@/lib/api";

/** The media id a Library row's Save for offline asks about: `offline:<song id>`. Null for any other id. */
export const offlineIdOf = (mediaId: string): string | null => (mediaId.startsWith("offline:") && mediaId.length > "offline:".length ? mediaId.slice("offline:".length) : null);

/** The media kept on this device (a song is kept as `media`, like a video or an episode); the hub keeps only the ids that are songs this person may read. */
export interface KeptDeps { listKept: typeof listKept; keepOnDevice: typeof keepOnDevice; removeFromDevice: typeof removeFromDevice }
const real: KeptDeps = { listKept, keepOnDevice, removeFromDevice };

export async function keptSongIds(deps: KeptDeps = real): Promise<string[]> {
  return (await deps.listKept()).filter((manifest) => manifest.kind === "media").map((manifest) => manifest.id);
}

/** Tell the hub which songs this device keeps. Quiet when offline or signed out: the next call tries again. */
export async function reportKeptSongs(deps: KeptDeps = real): Promise<void> {
  try {
    await request("/api/plugins/music/offline", { method: "POST", body: JSON.stringify({ ids: await keptSongIds(deps) }) });
  } catch { /* the hub is unreachable; the list is sent the next time */ }
}

/** Save the song for offline, or remove the copy when this device already keeps it. Returns the plain line to show. */
export async function toggleKeptSong(id: string, deps: KeptDeps = real): Promise<string> {
  const kept = (await keptSongIds(deps)).includes(id);
  if (kept) {
    await deps.removeFromDevice({ kind: "media", id });
    await reportKeptSongs(deps);
    return i18n._({ id: "Removed from this device.", message: "Removed from this device." });
  }
  const result = await deps.keepOnDevice({ kind: "media", id });
  if (!result.ok) return result.message;
  await reportKeptSongs(deps);
  return i18n._({ id: "Saved on this device. It plays here without a connection.", message: "Saved on this device. It plays here without a connection." });
}
