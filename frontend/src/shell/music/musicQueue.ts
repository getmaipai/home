// MP-U4: what the Music player decides without playing anything: the queue, which song comes next and which came before, with shuffle and
// repeat. Shuffle and repeat are the one play mode the Audio app's Now playing already keeps (media/playMode.ts); this file only reads it.
import type { TimedLyricLine } from "@maipai/ui/src/elements/lyrics-list";
import type { PlayMode } from "@/shell/media/playMode";

/** One playable thing in the queue: a version (take) of a song, or a saved sound. */
export interface Track {
  /** The file id of the version, or `sound-<id>`. Unique in the queue. */
  key: string;
  url: string;
  /** The hub's media id for the song, when the caller knows it; the like heart uses it (else the key). */
  mediaId?: string;
  title: string;
  /** The style line under the title. */
  subtitle?: string;
  artworkUrl?: string | null;
  /** The song the track belongs to (its Studio and details address); absent for a sound. */
  songId?: string;
  /** The song's job id and this file's id: together they name the hub's waveform route. Absent for a sound. */
  jobId?: string;
  duration?: number | null;
  lyrics?: string;
  timed?: readonly TimedLyricLine[];
  loop?: boolean;
  /** Music-library eligibility. Sounds use the same values when they join a queue. */
  state?: "queued" | "running" | "done" | "failed" | "cancelled";
  hasFile?: boolean;
  mediaType?: string;
}

const MEDIA_TYPE_CANDIDATES: Record<string, readonly string[]> = {
  "audio/mp4": ['audio/mp4; codecs="mp4a.40.2"', "audio/mp4"],
  "audio/m4a": ['audio/mp4; codecs="mp4a.40.2"', "audio/mp4"],
  "audio/x-m4a": ['audio/mp4; codecs="mp4a.40.2"', "audio/mp4"],
  "audio/mpeg": ["audio/mpeg"],
  "audio/mp3": ["audio/mpeg", "audio/mp3"],
  "audio/aac": ["audio/aac", 'audio/mp4; codecs="mp4a.40.2"'],
  "audio/x-aac": ["audio/aac", 'audio/mp4; codecs="mp4a.40.2"'],
  "audio/wav": ["audio/wav", "audio/x-wav"],
  "audio/x-wav": ["audio/wav", "audio/x-wav"],
  "audio/ogg": ['audio/ogg; codecs="vorbis"', "audio/ogg"],
  "application/ogg": ['audio/ogg; codecs="vorbis"', "audio/ogg"],
};

/** Whether this browser can play the file's declared audio type. */
export function canPlayMediaType(mediaType: string | undefined, canPlayType: (type: string) => string): boolean {
  const candidates = MEDIA_TYPE_CANDIDATES[(mediaType ?? "").split(";")[0]!.trim().toLowerCase()];
  return !!candidates?.some((candidate) => { const result = canPlayType(candidate); return result !== "" && result.toLowerCase() !== "no"; });
}

export function trackIsPlayable(track: Track, canPlayType: (type: string) => string = browserCanPlayType): boolean {
  return track.state === "done" && track.hasFile === true && canPlayMediaType(track.mediaType, canPlayType);
}

export function trackUnavailableLine(track: Track, canPlayType: (type: string) => string = browserCanPlayType): string | null {
  if (track.state === "queued" || track.state === "running") return "Still being made.";
  if (track.state === "failed" || track.state === "cancelled") return "This song could not be made. Open it to try again.";
  if (track.hasFile === false) return "This song's file is missing. Make it again.";
  if (track.mediaType && !canPlayMediaType(track.mediaType, canPlayType)) return "This file type cannot play in this browser.";
  return null;
}

function browserCanPlayType(type: string): string {
  if (typeof document === "undefined") return "";
  return document.createElement("audio").canPlayType(type);
}

/** The hub's waveform route for a track, or null when it has none (a sound). */
export const peaksUrlOf = (track: Pick<Track, "jobId" | "key">): string | null =>
  track.jobId ? `/api/music/jobs/${encodeURIComponent(track.jobId)}/files/${encodeURIComponent(track.key)}/peaks` : null;

/** The queue a play press starts from: the pressed track must be in it, or it plays alone. */
export function queueFor(track: Track, queue: readonly Track[] | undefined, canPlayType?: (type: string) => string): Track[] {
  const playable = (one: Track) => trackIsPlayable(one, canPlayType);
  const list = (queue ?? []).filter((one, at, all) => playable(one) && all.findIndex((other) => playable(other) && other.key === one.key) === at);
  return list.some((one) => one.key === track.key) ? list : playable(track) ? [track] : [];
}

export interface NextArgs {
  queue: readonly Track[];
  /** The index of the song playing now. */
  index: number;
  mode: PlayMode;
  /** Keys already played in this round; shuffle plays every song once before it goes round again. */
  played: ReadonlySet<string>;
  /** True when the song ended by itself (repeat one then replays it); false for the Next button. */
  ended: boolean;
  random?: () => number;
  canPlayType?: (type: string) => string;
}

/** The index to play after this one, or null when the queue is over. */
export function pickNext({ queue, index, mode, played, ended, random = Math.random, canPlayType }: NextArgs): number | null {
  const playable = queue.map((track, at) => trackIsPlayable(track, canPlayType) ? at : -1).filter((at) => at >= 0);
  const n = playable.length;
  if (n === 0) return null;
  const position = playable.indexOf(index);
  if (position < 0) return playable[0]!;
  if (ended && mode.repeat === "one") return index;
  const wraps = mode.repeat !== "off";
  if (mode.shuffle) {
    const fresh = playable.filter((at) => at !== index && !played.has(queue[at]!.key));
    if (fresh.length) return fresh[Math.floor(random() * fresh.length)]!;
    if (!wraps) return null;
    const others = playable.filter((at) => at !== index);
    return others.length ? others[Math.floor(random() * others.length)]! : index;
  }
  if (position + 1 < n) return playable[position + 1]!;
  return wraps ? playable[0]! : null;
}

export interface PreviousArgs {
  queue: readonly Track[];
  index: number;
  mode: PlayMode;
  /** Seconds into the song now. */
  time: number;
  /** Keys played before this one, newest last (shuffle goes back through them). */
  history: readonly string[];
  canPlayType?: (type: string) => string;
}

/** Where Previous goes: "restart" when the song has played a few seconds or nothing came before it, else an index. */
export function pickPrevious({ queue, index, mode, time, history, canPlayType }: PreviousArgs): number | "restart" {
  const playable = queue.map((track, at) => trackIsPlayable(track, canPlayType) ? at : -1).filter((at) => at >= 0);
  if (!playable.length) return "restart";
  if (time > 3) return "restart";
  if (mode.shuffle) {
    const before = history.at(-1);
    const found = before === undefined ? -1 : queue.findIndex((one) => one.key === before);
    const at = playable.includes(found) ? found : -1;
    return at >= 0 ? at : "restart";
  }
  const position = playable.indexOf(index);
  if (position > 0) return playable[position - 1]!;
  return mode.repeat !== "off" && playable.length > 1 ? playable.at(-1)! : "restart";
}

// SF-08c: the Queue pane's model. Pure functions over the one in-browser queue (never a third queue): the player store applies them, the pane draws them.

/** Where the queue came from: the list, album, band or playlist a play press started in. Absent means the person's own songs. */
export interface QueueSource { name: string }

/** The line after "Playing from": the source's name, else "Your songs". */
export function sourceLabelOf(source: QueueSource | null | undefined, fallback = "Your songs"): string {
  const name = source?.name?.trim();
  return name ? name : fallback;
}

export interface QueuePaneModel {
  nowPlaying: Track | null;
  /** The songs the person placed by hand (Play next, Add to queue), in queue order. */
  playNext: Track[];
  /** The rest of the list that comes after the song playing. */
  nextUp: Track[];
}

/** Splits the songs after the playing one into the two tiers. `manual` is the keys placed by hand. */
export function paneModel(queue: readonly Track[], index: number, manual: readonly string[]): QueuePaneModel {
  const nowPlaying = queue[index] ?? null;
  const after = nowPlaying ? queue.slice(index + 1) : [];
  const hand = new Set(manual);
  return { nowPlaying, playNext: after.filter((one) => hand.has(one.key)), nextUp: after.filter((one) => !hand.has(one.key)) };
}

export interface QueueEdit { queue: Track[]; index: number; manual: string[] }

// The Play next tier is always the first songs after the one playing, so a tier is a count: `manual` names those songs in order.

/** Puts `track` right after the song playing, after the songs already placed by hand. A song already queued moves. */
export function insertNext(queue: readonly Track[], index: number, manual: readonly string[], track: Track): QueueEdit {
  const playing = queue[index];
  if (playing?.key === track.key) return { queue: [...queue], index, manual: [...manual] };
  const without = queue.filter((one) => one.key !== track.key);
  const at = playing ? without.findIndex((one) => one.key === playing.key) : -1;
  const keep = manual.filter((key) => key !== track.key && without.findIndex((one) => one.key === key) > at);
  without.splice(at + keep.length + 1, 0, track);
  return { queue: without, index: at, manual: [...keep, track.key] };
}

/** Puts `track` at the end of the queue, in the Next up tier. */
export function appendToQueue(queue: readonly Track[], index: number, manual: readonly string[], track: Track): QueueEdit {
  const playing = queue[index];
  if (playing?.key === track.key) return { queue: [...queue], index, manual: [...manual] };
  const without = queue.filter((one) => one.key !== track.key);
  return { queue: [...without, track], index: playing ? without.findIndex((one) => one.key === playing.key) : -1, manual: manual.filter((key) => key !== track.key) };
}

/** Takes an upcoming song out. The song playing and the ones already played cannot be removed this way. */
export function removeUpcoming(queue: readonly Track[], index: number, manual: readonly string[], key: string): QueueEdit {
  const at = queue.findIndex((one) => one.key === key);
  if (at <= index) return { queue: [...queue], index, manual: [...manual] };
  return { queue: queue.filter((_, i) => i !== at), index, manual: manual.filter((one) => one !== key) };
}

/** Drops every upcoming song: the song playing and the ones already played stay. */
export function clearUpcoming(queue: readonly Track[], index: number, manual: readonly string[]): QueueEdit {
  const keep = queue.slice(0, Math.max(index + 1, 0));
  return { queue: keep, index, manual: manual.filter((key) => keep.some((one) => one.key === key)) };
}

/** Drops only the Play next tier. */
export function clearPlayNext(queue: readonly Track[], index: number, manual: readonly string[]): QueueEdit {
  const hand = new Set(manual);
  return { queue: queue.filter((one, at) => at <= index || !hand.has(one.key)), index, manual: [] };
}

/**
 * Moves the upcoming song `key` to sit before the upcoming song `beforeKey` (null: the end). The song playing and the played songs never
 * move. Dropped inside the Play next tier the song joins it; dropped below it the song leaves it; dropped on the line between the two
 * tiers it stays in the tier it came from.
 */
export function moveUpcoming(queue: readonly Track[], index: number, manual: readonly string[], key: string, beforeKey: string | null): QueueEdit {
  const same = { queue: [...queue], index, manual: [...manual] };
  const upcoming = queue.slice(index + 1);
  const from = upcoming.findIndex((one) => one.key === key);
  if (from < 0 || key === beforeKey) return same;
  const m = manual.filter((one) => upcoming.some((song) => song.key === one)).length;
  const fromHand = from < m;
  const rest = upcoming.filter((one) => one.key !== key);
  const to = beforeKey === null ? rest.length : rest.findIndex((one) => one.key === beforeKey);
  if (to < 0) return same;
  const handLeft = m - (fromHand ? 1 : 0);
  const handNow = to < handLeft ? handLeft + 1 : to > handLeft ? handLeft : fromHand ? handLeft + 1 : handLeft;
  rest.splice(to, 0, upcoming[from]!);
  return { queue: [...queue.slice(0, index + 1), ...rest], index, manual: rest.slice(0, handNow).map((one) => one.key) };
}

/** The name a saved queue gets: its source when it has one, else "Your songs", then the date. */
export function queuePlaylistName(source: QueueSource | null | undefined, today: Date, fallback = "Your songs"): string {
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return `${sourceLabelOf(source, fallback)} ${day}`.slice(0, 100);
}

/** The songs a "Save as playlist" writes: the song playing, then what comes after, once each (the played ones are history, not the list). */
export function playlistSongs(queue: readonly Track[], index: number): Track[] {
  return queue.slice(Math.max(index, 0)).filter((one, at, all) => all.findIndex((other) => other.key === one.key) === at);
}

/** The id the hub knows a song by in a playlist: the song, else the file. A sound has none and is left out. */
export const playlistIdOf = (track: Track): string | null => (track.key.startsWith("sound-") ? null : track.songId ?? track.key);
