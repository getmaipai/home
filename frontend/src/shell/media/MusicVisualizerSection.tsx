import { i18n } from "@lingui/core";
// MEDIA-VIZ-02/03: what the Music play page adds beside the kit Player (which stays untouched, RULES rule 9), ported from the
// pre-rebuild hub's Now Playing page: the visualizer moving behind a flat page (PRO look: no gradient wash, no blurred cover), a row of controls (Minimize, visualizer scene, sleep timer, volume, Full screen; shuffle, repeat and Up next are the kit Now Playing's own, fed by the host), and the same Now
// playing stage the mini player opens. It reads the media host's element, so it never starts or restarts anything, and it draws
// only while the host holds this song.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Slider } from "@maipai/ui/src/dashboard/components/ui/slider";
import { getIcon } from "@maipai/ui/src/icons";
import { useMediaDock } from "@/shell/mediaHost";
import { AudioVisualizer, useVisualizerEnabled, useVisualizerPref } from "@/shell/media/AudioVisualizer";
import { MinimizeButton } from "@/shell/media/MinimizeButton";
import { NowPlayingStage } from "@/shell/media/NowPlayingStage";
import { EqualizerMenu } from "@/shell/media/EqualizerMenu";
import { SleepMenu } from "@/shell/media/SleepMenu";
import { useIsPlaying, useMediaAnalyser, useProgress } from "@/shell/media/useMediaAnalyser";
import { VisualizerMenu } from "@/shell/media/VisualizerMenu";
import { useStageRequest, type StageView } from "@/shell/media/stageRequest";
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
  const mine = held !== null && held.appId === "audio" && held.id === id && held.kind === "audio" ? held : null;
  const [stage, setStage] = useState(false);
  const [stageView, setStageView] = useState<StageView>("scene");
  // NOW-PLAYING-01: the kit's Up next button asks the host, and the host asks here; only an ask made while this section is on screen opens the stage.
  const asked = useStageRequest();
  const seen = useRef(asked.seq);
  useEffect(() => {
    if (asked.seq === seen.current) return;
    seen.current = asked.seq;
    setStageView(asked.view);
    setStage(true);
  }, [asked]);
  const variant = useVisualizerPref();
  const vizOn = useVisualizerEnabled();
  const palette = useArtPalette(mine?.poster ?? null);
  const getAnalyser = useMediaAnalyser(mine?.el ?? null, mine !== null && vizOn);
  const playing = useIsPlaying(mine?.el ?? null);
  const progress = useProgress(mine?.el ?? null);
  const { volume } = useMediaFlags(mine?.el ?? null);
  const closeStage = useCallback(() => setStage(false), []);
  if (!mine) return null;
  const FullIcon = getIcon("maximize"), MuteIcon = volume === 0 ? getIcon("volume-x") : getIcon("volume-2");
  return (
    <>
      <div aria-hidden="true" data-testid="music-page-backdrop" className="pointer-events-none fixed inset-x-0 bottom-0 top-13 z-0 overflow-hidden md:start-14">
        {vizOn ? <AudioVisualizer variant={variant} mode="full" getAnalyser={getAnalyser} palette={palette} active={playing} progress={progress} opacity={0.25} className="absolute inset-0 size-full grayscale" /> : null}
      </div>
      <section aria-label={i18n._({ id: "Player options", message: "Player options" })} data-testid="music-visualizer-section" className="relative z-10 flex w-full shrink-0 items-center gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&>*]:shrink-0">
        <MinimizeButton appHome="/apps/audio" />
        <VisualizerMenu withLabel />
        <SleepMenu withLabel />
        <EqualizerMenu withLabel />
        <span className="flex items-center gap-2 px-2">
          <MuteIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <div className="w-24"><Slider aria-label={i18n._({ id: "Volume", message: "Volume" })} min={0} max={1} step={0.01} value={[volume]} onValueChange={(value) => { const next = Array.isArray(value) ? value[0] : value; if (typeof next === "number") mine.el.volume = next; }} /></div>
        </span>
        <span aria-hidden="true" className="flex-1" />
        <Button size="sm" variant="ghost" aria-label={i18n._({ id: "Full screen visualizer", message: "Full screen visualizer" })} onClick={() => { setStageView("scene"); setStage(true); }}><FullIcon aria-hidden="true" />{i18n._({ id: "Full screen", message: "Full screen" })}</Button>
        {stage ? <NowPlayingStage media={mine} initialView={stageView} onClose={closeStage} /> : null}
      </section>
    </>
  );
}
