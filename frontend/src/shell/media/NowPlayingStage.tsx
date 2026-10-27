// MEDIA-VIZ-01: the full-screen Now playing stage for the media host's audio: the cover (or one of the audio-reactive scenes ported from
// the pre-rebuild hub) over a soft blur of the cover, with the title, a seek bar and the transport. It drives the host's element
// directly, so closing it never restarts anything. The stage always uses the dark theme's tokens (the visualizers draw light colors on
// dark); every color is a theme token or comes from the cover art itself.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Slider } from "@maipai/ui/src/dashboard/components/ui/slider";
import { getIcon } from "@maipai/ui/src/icons";
import { cn } from "@maipai/ui/src/utils";
import type { HoistedMedia } from "@/shell/mediaHost";
import { AudioVisualizer, VISUALIZERS, setVisualizerPref, useVisualizerPref } from "@/shell/media/AudioVisualizer";
import { useMediaAnalyser } from "@/shell/media/useMediaAnalyser";
import { accentOf, useArtPalette } from "@/lib/media/artPalette";

const SCENE_KEY = "media.stage.scene";
const readScene = (): boolean => { try { return localStorage.getItem(SCENE_KEY) !== "art"; } catch { return true; } };

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function NowPlayingStage({ media, onClose }: { media: HoistedMedia; onClose: () => void }) {
  const el = media.el;
  const root = useRef<HTMLDivElement>(null);
  const [showScene, setShowScene] = useState(readScene);
  const variant = useVisualizerPref();
  const palette = useArtPalette(media.poster ?? null);
  const accent = accentOf(palette);
  const getAnalyser = useMediaAnalyser(el, true);
  const [playing, setPlaying] = useState(!el.paused);
  const [position, setPosition] = useState(el.currentTime || 0);
  const [duration, setDuration] = useState(Number.isFinite(el.duration) ? el.duration : 0);

  useEffect(() => {
    const sync = () => {
      setPlaying(!el.paused);
      setPosition(el.currentTime || 0);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    };
    const events = ["play", "pause", "timeupdate", "durationchange", "seeked", "loadedmetadata"] as const;
    events.forEach((name) => el.addEventListener(name, sync));
    sync();
    return () => events.forEach((name) => el.removeEventListener(name, sync));
  }, [el]);

  // The browser's full screen when it allows it; Escape closes the stage either way.
  useEffect(() => {
    const node = root.current;
    void node?.requestFullscreen?.().catch(() => {});
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const onFullscreen = () => { if (!document.fullscreenElement) onClose(); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    };
  }, [onClose]);

  const choose = (scene: "art" | (typeof VISUALIZERS)[number]["id"]) => {
    if (scene === "art") setShowScene(false);
    else { setVisualizerPref(scene); setShowScene(true); }
    try { localStorage.setItem(SCENE_KEY, scene === "art" ? "art" : "scene"); } catch { /* the choice lasts until reload */ }
  };

  const CloseIcon = getIcon("x"), PlayIcon = getIcon("play"), PauseIcon = getIcon("pause"), BackIcon = getIcon("skip-back"), ForwardIcon = getIcon("skip-forward"), MusicIcon = getIcon("music");
  const toggle = () => { if (el.paused) void el.play().catch(() => {}); else el.pause(); };

  return createPortal(
    <div ref={root} role="dialog" aria-modal="true" aria-label={`Now playing: ${media.title}`} data-testid="now-playing-stage" className="dark fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background text-foreground">
      {media.poster ? <img src={media.poster} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-25 blur-3xl" /> : null}
      <div className="relative z-10 flex items-center gap-2 p-4">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label="What is on stage">
          <Button size="sm" variant={showScene ? "ghost" : "secondary"} aria-pressed={!showScene} onClick={() => choose("art")}>Cover</Button>
          {VISUALIZERS.map((v) => (
            <Button key={v.id} size="sm" variant={showScene && v.id === variant ? "secondary" : "ghost"} aria-pressed={showScene && v.id === variant} onClick={() => choose(v.id)}>{v.label}</Button>
          ))}
        </div>
        <Button variant="ghost" size="icon" aria-label="Close Now playing" onClick={onClose}><CloseIcon aria-hidden="true" /></Button>
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center">
        {showScene ? (
          <AudioVisualizer variant={variant} mode="full" getAnalyser={getAnalyser} palette={palette} active={playing} progress={duration > 0 ? position / duration : 0} className="absolute inset-0" />
        ) : media.poster ? (
          <img src={media.poster} alt="" className="aspect-square w-[min(46vh,80vw)] rounded-xl object-cover shadow-2xl" />
        ) : (
          <div className="grid aspect-square w-[min(46vh,80vw)] place-items-center rounded-xl bg-muted"><MusicIcon aria-hidden="true" className="size-16 text-muted-foreground" /></div>
        )}
      </div>
      <div className={cn("relative z-10 flex flex-col gap-3 bg-gradient-to-t from-background to-transparent p-6 pb-8")}>
        <div className="mx-auto w-full max-w-3xl min-w-0">
          <div className="truncate text-2xl font-semibold md:text-4xl">{media.title}</div>
          {media.subtitle ? <div className="mt-1 truncate text-base text-muted-foreground md:text-xl">{media.subtitle}</div> : null}
        </div>
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 text-xs tabular-nums text-muted-foreground">
          <span>{clock(position)}</span>
          <Slider aria-label="Seek" min={0} max={Math.max(duration, 1)} step={1} value={[Math.min(position, Math.max(duration, 1))]} disabled={duration <= 0} onValueChange={(value) => { const next = Array.isArray(value) ? value[0] : value; if (typeof next === "number") { el.currentTime = next; setPosition(next); } }} />
          <span>{clock(duration)}</span>
        </div>
        <div className="mx-auto flex items-center gap-4">
          <Button variant="ghost" size="icon" aria-label="Back 10 seconds" onClick={() => { el.currentTime = Math.max(0, el.currentTime - 10); }}><BackIcon aria-hidden="true" /></Button>
          <Button size="icon" aria-label={playing ? "Pause" : "Play"} onClick={toggle} style={{ background: accent }}>{playing ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}</Button>
          <Button variant="ghost" size="icon" aria-label="Forward 30 seconds" onClick={() => { el.currentTime = Math.min(Number.isFinite(el.duration) ? el.duration : el.currentTime + 30, el.currentTime + 30); }}><ForwardIcon aria-hidden="true" /></Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
