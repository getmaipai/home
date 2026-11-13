// MP-U4: the player's seek bar drawn as the song's waveform (ace-step-ui has a plain bar; Suno draws the sound). The peaks come from the hub's
// waveform route (about 600 values, 0 to 1); the played part is the same bars in the primary colour, clipped at the playhead. A song with no
// peaks (a sound, a route that failed, still loading) gets the kit's plain slider. Colours are theme tokens; nothing animates.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fetchGivenPeaks } from "@maipai/ui/src/elements/track-studio-media";
import { peaksUrlOf, type Track } from "./musicQueue";

const BARS = 96;
const cache = new Map<string, number[]>();

/** `peaks` cut to `count` bars (the loudest value in each slice), or null while there are none. */
export function barsOf(peaks: readonly number[] | null, count: number): number[] | null {
  if (!peaks || peaks.length < 2) return null;
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * peaks.length) / count), to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count));
    let top = 0;
    for (let at = from; at < to && at < peaks.length; at++) top = Math.max(top, peaks[at]!);
    return top;
  });
}

/** The song's peaks from the hub, or null while loading, for a sound and when the route says no. */
export function usePeaks(track: Pick<Track, "jobId" | "key" | "duration"> | null): number[] | null {
  const url = track ? peaksUrlOf(track) : null;
  const [got, setGot] = useState<{ url: string; peaks: number[] } | null>(null);
  useEffect(() => {
    if (!url) return;
    const hit = cache.get(url);
    if (hit) return;
    const abort = new AbortController();
    fetchGivenPeaks(url, track?.duration ?? 0, abort.signal).then((made) => { cache.set(url, made.peaks); setGot({ url, peaks: made.peaks }); }).catch(() => undefined);
    return () => abort.abort();
  }, [url, track?.duration]);
  if (!url) return null;
  return cache.get(url) ?? (got?.url === url ? got.peaks : null);
}

/** The waveform seek bar. Draw it only when the song has peaks; without them the caller draws the kit slider. */
export function WaveformSeek({ peaks, time, duration, onSeek, label }: { peaks: number[]; time: number; duration: number; onSeek: (seconds: number) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const bars = barsOf(peaks, BARS);
  if (!bars) return null;
  const ready = duration > 0 && Number.isFinite(duration);
  const ratio = ready ? Math.min(1, Math.max(0, time / duration)) : 0;
  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !ready || rect.width <= 0) return;
    onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * duration);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ready) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); onSeek(time + (event.key === "ArrowLeft" ? -5 : 5)); }
    else if (event.key === "Home") { event.preventDefault(); onSeek(0); }
    else if (event.key === "End") { event.preventDefault(); onSeek(duration); }
  };
  const drawn = (tone: string) => <div aria-hidden="true" className={`pointer-events-none absolute inset-0 flex items-center gap-px ${tone}`}>
    {bars.map((height, i) => <span key={i} className="min-w-px flex-1 rounded-full bg-current" style={{ height: `${Math.max(12, Math.round(height * 100))}%` }} />)}
  </div>;
  return <div ref={box} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} aria-valuetext={`${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`} aria-disabled={!ready} data-testid="music-waveform"
    onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); seekAt(event); }} onPointerMove={(event) => { if (event.buttons) seekAt(event); }} onKeyDown={onKey}
    className={`relative h-8 w-full cursor-pointer touch-none select-none`}>
    {drawn("text-muted-foreground/40")}
    <div className="pointer-events-none absolute inset-0" style={{ clipPath: `inset(0 ${(1 - ratio) * 100}% 0 0)` }}>{drawn("text-primary")}</div>
  </div>;
}
