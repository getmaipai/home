// RADIO-03: a radio station plays in the shell's one host-owned element from the hub's stream route. Such an item has no length, so the
// mini bar shows the kit's Live badge and no seek; the song the station says is on comes from the hub every ~15 s, only while the
// stream is playing and the tab is visible; and Pause then Play rejoins the live edge by loading the stream again, never by resuming a
// stale buffer. Nothing is stored; the title lives in the held item's subtitle.
import { request } from "@/lib/api";

const STREAM_PREFIX = "/api/plugins/music/radio/stream/";
export const NOW_POLL_MS = 15_000;
/** The first look comes a few seconds after sound starts, once the station has sent its first metadata block. */
export const NOW_FIRST_MS = 4_000;

/** The station id when `src` is a station's stream on this hub, else null. */
export function liveStationIdOf(src: string): string | null {
  if (!src.startsWith(STREAM_PREFIX)) return null;
  const id = src.slice(STREAM_PREFIX.length).split(/[?#]/)[0] ?? "";
  try { return id === "" ? null : decodeURIComponent(id); } catch { return null; }
}

/** What the station says is on now, or null (none sent, the station left the list, or the hub did not answer). */
export async function fetchNowPlaying(stationId: string): Promise<string | null> {
  try {
    const found = await request<{ title: string | null }>(`/api/plugins/music/radio/now/${encodeURIComponent(stationId)}`);
    return typeof found.title === "string" && found.title !== "" ? found.title : null;
  } catch {
    return null;
  }
}

/** Pause then Play on a live stream loads the source again so it joins the live edge. Returns the cleanup. */
export function rejoinLiveOnResume(el: HTMLMediaElement): () => void {
  let pausedAt: number | null = null;
  let reloading = false;
  const paused = () => { if (!reloading && !el.ended) pausedAt = Date.now(); };
  const played = () => {
    if (reloading || pausedAt === null) return;
    pausedAt = null;
    reloading = true;
    el.load();
    void el.play().catch(() => undefined).finally(() => { reloading = false; });
  };
  el.addEventListener("pause", paused);
  el.addEventListener("play", played);
  return () => { el.removeEventListener("pause", paused); el.removeEventListener("play", played); };
}
