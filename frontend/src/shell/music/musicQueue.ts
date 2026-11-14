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
}

/** The hub's waveform route for a track, or null when it has none (a sound). */
export const peaksUrlOf = (track: Pick<Track, "jobId" | "key">): string | null =>
  track.jobId ? `/api/music/jobs/${encodeURIComponent(track.jobId)}/files/${encodeURIComponent(track.key)}/peaks` : null;

/** The queue a play press starts from: the pressed track must be in it, or it plays alone. */
export function queueFor(track: Track, queue: readonly Track[] | undefined): Track[] {
  const list = (queue ?? []).filter((one, at, all) => all.findIndex((other) => other.key === one.key) === at);
  return list.some((one) => one.key === track.key) ? list : [track];
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
}

/** The index to play after this one, or null when the queue is over. */
export function pickNext({ queue, index, mode, played, ended, random = Math.random }: NextArgs): number | null {
  const n = queue.length;
  if (n === 0) return null;
  if (ended && mode.repeat === "one") return index;
  const wraps = mode.repeat !== "off";
  if (mode.shuffle) {
    const fresh = queue.map((_, at) => at).filter((at) => at !== index && !played.has(queue[at]!.key));
    if (fresh.length) return fresh[Math.floor(random() * fresh.length)]!;
    if (!wraps) return null;
    const others = queue.map((_, at) => at).filter((at) => at !== index);
    return others.length ? others[Math.floor(random() * others.length)]! : index;
  }
  if (index + 1 < n) return index + 1;
  return wraps ? 0 : null;
}

export interface PreviousArgs {
  queue: readonly Track[];
  index: number;
  mode: PlayMode;
  /** Seconds into the song now. */
  time: number;
  /** Keys played before this one, newest last (shuffle goes back through them). */
  history: readonly string[];
}

/** Where Previous goes: "restart" when the song has played a few seconds or nothing came before it, else an index. */
export function pickPrevious({ queue, index, mode, time, history }: PreviousArgs): number | "restart" {
  if (time > 3) return "restart";
  if (mode.shuffle) {
    const before = history.at(-1);
    const at = before === undefined ? -1 : queue.findIndex((one) => one.key === before);
    return at >= 0 ? at : "restart";
  }
  if (index > 0) return index - 1;
  return mode.repeat !== "off" && queue.length > 1 ? queue.length - 1 : "restart";
}
