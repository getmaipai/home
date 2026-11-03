// MUSIC-WAVEFORM-01: a waveform drawn from the real audio file. The file is fetched with the person's own session, decoded with the browser's
// Web Audio and cut into peaks, so every bar is the loudness of that slice of the song; nothing is faked. Colors come from the kit's hue
// tokens through the `--track` custom property, so a track's color is one token and the bars carry no raw color.
import { useEffect, useState, type CSSProperties } from "react";

/** The peaks (0 to 1) of an audio file, `count` of them, or null while it decodes. `failed` is true when the file could not be decoded. */
export function usePeaks(url: string | null, count = 160): { peaks: number[] | null; failed: boolean; seconds: number | null } {
  const [state, setState] = useState<{ url: string | null; peaks: number[] | null; failed: boolean; seconds: number | null }>({ url: null, peaks: null, failed: false, seconds: null });
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) { setState({ url, peaks: null, failed: true, seconds: null }); return; }
    const context = new Context();
    fetch(url, { signal: abort.signal, credentials: "same-origin" })
      .then((response) => { if (!response.ok) throw new Error("audio"); return response.arrayBuffer(); })
      .then((bytes) => context.decodeAudioData(bytes))
      .then((audio) => setState({ url, peaks: peaksOf(audio.getChannelData(0), count), failed: false, seconds: audio.duration }))
      .catch(() => { if (!abort.signal.aborted) setState({ url, peaks: null, failed: true, seconds: null }); })
      .finally(() => { void context.close().catch(() => undefined); });
    return () => abort.abort();
  }, [url, count]);
  return state.url === url ? { peaks: state.peaks, failed: state.failed, seconds: state.seconds } : { peaks: null, failed: false, seconds: null };
}

/** The loudest sample in each of `count` equal slices, scaled so the loudest slice is 1. */
export function peaksOf(samples: ArrayLike<number>, count: number): number[] {
  if (samples.length === 0 || count <= 0) return [];
  const size = Math.max(1, Math.floor(samples.length / count));
  const out: number[] = [];
  for (let slice = 0; slice < count; slice += 1) {
    let loudest = 0;
    const end = Math.min(samples.length, (slice + 1) * size);
    for (let at = slice * size; at < end; at += 1) loudest = Math.max(loudest, Math.abs(samples[at] ?? 0));
    out.push(loudest);
  }
  const top = Math.max(...out, 0.0001);
  return out.map((peak) => peak / top);
}

/** Mirrored bars. `played` (0 to 1) fills the bars before the playhead in full color and dims the rest. */
export function Waveform({ peaks, played = 0, hue = "var(--primary)", label }: { peaks: number[]; played?: number; hue?: string; label: string }) {
  return <div role="img" aria-label={label} className="flex h-full w-full items-center gap-px" style={{ "--track": hue } as CSSProperties}>
    {peaks.map((peak, index) => <span key={index} className={`h-(--bar) min-w-px flex-1 rounded-full bg-(--track) ${index / peaks.length < played ? "" : "opacity-50"}`} style={{ "--bar": `${Math.max(4, Math.round(peak * 100))}%` } as CSSProperties} />)}
  </div>;
}
