// MEDIA-VIZ-02/03: what the Music play page adds beside the kit Player (which stays untouched, RULES rule 9), ported from the
// pre-rebuild hub's Now Playing page: the cover's colors and a soft blurred cover over the whole page with the visualizer moving
// behind everything, a row of controls (Minimize, visualizer scene, sleep timer, repeat, volume, Full screen), and the same Now
// playing stage the mini player opens. It reads the media host's element, so it never starts or restarts anything, and it draws
// only while the host holds this song.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Slider } from "@maipai/ui/src/dashboard/components/ui/slider";
import { getIcon } from "@maipai/ui/src/icons";
import { useMediaDock } from "@/shell/mediaHost";
import { AudioVisualizer, useVisualizerEnabled, useVisualizerPref } from "@/shell/media/AudioVisualizer";
import { MinimizeButton } from "@/shell/media/MinimizeButton";
import { NowPlayingStage } from "@/shell/media/NowPlayingStage";
import { SleepMenu } from "@/shell/media/SleepMenu";
import { useIsPlaying, useMediaAnalyser, useProgress } from "@/shell/media/useMediaAnalyser";
import { VisualizerMenu } from "@/shell/media/VisualizerMenu";
import { useArtPalette } from "@/lib/media/artPalette";

function useMediaFlags(el: HTMLMediaElement | null): { loop: boolean; volume: number } {
  const read = () => ({ loop: el?.loop ?? false, volume: el?.volume ?? 1 });
  const [flags, setFlags] = useState(read);
  useEffect(() => {
    const sync = () => setFlags(read());
    if (!el) { sync(); return; }
    el.addEventListener("volumechange", sync);
    sync();
    return () => el.removeEventListener("volumechange", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read only closes over el
  }, [el]);
  return flags;
}

export function MusicVisualizerSection({ id }: { id: string }) {
  const held = useMediaDock().current;
  const mine = held !== null && held.appId === "music" && held.id === id && held.kind === "audio" ? held : null;
  const [stage, setStage] = useState(false);
  const [loop, setLoop] = useState(false);
  const variant = useVisualizerPref();
  const vizOn = useVisualizerEnabled();
  const palette = useArtPalette(mine?.poster ?? null);
  const getAnalyser = useMediaAnalyser(mine?.el ?? null, mine !== null && vizOn);
  const playing = useIsPlaying(mine?.el ?? null);
  const progress = useProgress(mine?.el ?? null);
  const { volume } = useMediaFlags(mine?.el ?? null);
  const closeStage = useCallback(() => setStage(false), []);
  useEffect(() => { setLoop(mine?.el.loop ?? false); }, [mine?.el]);
  if (!mine) return null;
  const FullIcon = getIcon("maximize"), MuteIcon = volume === 0 ? getIcon("volume-x") : getIcon("volume-2");
  const toggleLoop = () => { mine.el.loop = !mine.el.loop; setLoop(mine.el.loop); };
  return (
    <>
      <div aria-hidden="true" data-testid="music-page-backdrop" className="pointer-events-none fixed inset-x-0 bottom-0 top-10 z-0 overflow-hidden md:start-14">
        {mine.poster ? <img src={mine.poster} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-20 blur-3xl" /> : null}
        <div className="absolute inset-0 opacity-20 dark:opacity-25" style={{ background: `linear-gradient(135deg, ${palette.corners[0]}, ${palette.corners[1]} 40%, ${palette.corners[2]} 70%, ${palette.corners[3]})` }} />
        {vizOn ? <AudioVisualizer variant={variant} mode="full" getAnalyser={getAnalyser} palette={palette} active={playing} progress={progress} opacity={0.4} className="absolute inset-0 size-full" /> : null}
      </div>
      <section aria-label="Player options" data-testid="music-visualizer-section" className="relative z-10 flex w-full flex-wrap items-center gap-1 py-2">
        <MinimizeButton appHome="/apps/music" />
        <VisualizerMenu withLabel />
        <SleepMenu withLabel />
        <Button size="sm" variant={loop ? "secondary" : "ghost"} aria-pressed={loop} onClick={toggleLoop}>Repeat</Button>
        <span className="flex items-center gap-2 px-2">
          <MuteIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <div className="w-24"><Slider aria-label="Volume" min={0} max={1} step={0.01} value={[volume]} onValueChange={(value) => { const next = Array.isArray(value) ? value[0] : value; if (typeof next === "number") mine.el.volume = next; }} /></div>
        </span>
        <span aria-hidden="true" className="flex-1" />
        <Button size="sm" variant="ghost" aria-label="Full screen visualizer" onClick={() => setStage(true)}><FullIcon aria-hidden="true" />Full screen</Button>
        {stage ? <NowPlayingStage media={mine} onClose={closeStage} /> : null}
      </section>
    </>
  );
}
