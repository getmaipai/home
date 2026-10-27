// MEDIA-VIZ-02: the visualizer on the Music play page, ported from the pre-rebuild hub's Now Playing page: an ambient scene along the
// bottom of the page (as its overlay's bottom band did), the scene picker, and a Full screen button that opens the same Now playing
// stage the mini player opens. It reads the
// media host's element (the kit Player on this page plays in it), so it never starts or restarts anything, and it draws only while
// that element holds this song. The kit Player itself is untouched (RULES rule 9); this sits beside it in the page.
import { useCallback, useState } from "react";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { useMediaDock } from "@/shell/mediaHost";
import { AudioVisualizer, VISUALIZERS, setVisualizerPref, useVisualizerPref } from "@/shell/media/AudioVisualizer";
import { NowPlayingStage } from "@/shell/media/NowPlayingStage";
import { useIsPlaying, useMediaAnalyser, useProgress } from "@/shell/media/useMediaAnalyser";
import { useArtPalette } from "@/lib/media/artPalette";

const HIDDEN_KEY = "media.musicPage.visualizer.hidden";
const readHidden = (): boolean => { try { return localStorage.getItem(HIDDEN_KEY) === "1"; } catch { return false; } };

export function MusicVisualizerSection({ id }: { id: string }) {
  const held = useMediaDock().current;
  const mine = held !== null && held.appId === "music" && held.id === id && held.kind === "audio" ? held : null;
  const [hidden, setHidden] = useState(readHidden);
  const [stage, setStage] = useState(false);
  const variant = useVisualizerPref();
  const palette = useArtPalette(mine?.poster ?? null);
  const getAnalyser = useMediaAnalyser(mine?.el ?? null, mine !== null && !hidden);
  const playing = useIsPlaying(mine?.el ?? null);
  const progress = useProgress(mine?.el ?? null);
  const closeStage = useCallback(() => setStage(false), []);
  if (!mine) return null;
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, next ? "1" : "0"); } catch { /* the choice lasts until reload */ }
  };
  const FullIcon = getIcon("maximize"), WaveIcon = getIcon("audio-waveform");
  return (
    <section aria-label="Visualizer" data-testid="music-visualizer-section" className="flex w-full flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" aria-pressed={!hidden} onClick={toggle}><WaveIcon aria-hidden="true" />{hidden ? "Show visualizer" : "Hide visualizer"}</Button>
        {hidden ? null : VISUALIZERS.map((v) => (
          <Button key={v.id} size="sm" variant={v.id === variant ? "secondary" : "ghost"} aria-pressed={v.id === variant} onClick={() => setVisualizerPref(v.id)}>{v.label}</Button>
        ))}
        <span aria-hidden="true" className="flex-1" />
        <Button size="sm" variant="ghost" aria-label="Full screen visualizer" onClick={() => setStage(true)}><FullIcon aria-hidden="true" />Full screen</Button>
      </div>
      {hidden ? null : (
        <div aria-hidden="true" data-testid="music-visualizer-strip" className="pointer-events-none fixed inset-x-0 bottom-0 z-0 h-40 md:start-14">
          <AudioVisualizer variant={variant} mode="strip" getAnalyser={getAnalyser} palette={palette} active={playing} progress={progress} opacity={0.6} fade className="size-full" />
        </div>
      )}
      {stage ? <NowPlayingStage media={mine} onClose={closeStage} /> : null}
    </section>
  );
}
