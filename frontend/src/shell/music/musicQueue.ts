// MP-U4: what the Music player decides without playing anything: the queue, which song comes next and which came before, with shuffle and
// repeat. Shuffle and repeat are the one play mode the Audio app's Now playing already keeps (media/playMode.ts); this file only reads it.
import type { TimedLyricLine } from "@maipai/ui/src/elements/lyrics-list";
import type { PlayMode } from "@/shell/media/playMode";

/** One playable thing in the queue: a version (take) of a song, or a saved sound. */
export interface Track {
  /** The file id of the version, or `sound-<id>`. Unique in the queue. */
  key: string;
  url: string;
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
