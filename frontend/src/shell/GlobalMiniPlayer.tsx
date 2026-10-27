// MEDIA-VIZ-01: the one mini player for all media (music, videos, podcasts, books), pinned to the bottom of everything right of the rail
// on every page, not only inside a media app. It shows what the media host holds once the person has started it, except on the page that
// is playing that same item. Audio gets a soft audio-reactive strip and a Now playing stage; video gets Picture in picture and Full screen.
// The kit Player's `mini` layout is the bar itself, as shipped; this file only places it and adds the actions. The kit's docked bar sits
// at z-30, so the art wash and the visualizer strip draw above it (z-40) and let clicks through.
import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Player } from "@maipai/ui/src/primitives/Player";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { api } from "@/lib/api";
import { isMediaPlayPage, mediaAppOfPath, playPageOf } from "@/shell/mediaApps";
import { storyIdOfListen } from "@/shell/newsListen";
import { useMediaDock, type HoistedMedia } from "@/shell/mediaHost";
import { AudioVisualizer, useVisualizerEnabled, useVisualizerPref } from "@/shell/media/AudioVisualizer";
import { NowPlayingStage } from "@/shell/media/NowPlayingStage";
import { useIsPlaying, useMediaAnalyser, useMediaTime } from "@/shell/media/useMediaAnalyser";
import { Slider } from "@maipai/ui/src/dashboard/components/ui/slider";
import { VisualizerMenu } from "@/shell/media/VisualizerMenu";
import { SleepMenu } from "@/shell/media/SleepMenu";
import { clock } from "@/shell/media/NowPlayingStage";
import { useArtPalette } from "@/lib/media/artPalette";

/** True when the person is on the page that plays `held` right now (its watch, play, listen or read page). */
export function onPlayPageOf(held: HoistedMedia, pathname: string, search: string, stateId: string | undefined): boolean {
  const app = mediaAppOfPath(pathname);
  if (app !== held.appId) return false;
  const page = pathname.split("/")[3] || "index";
  if (!isMediaPlayPage(app, page)) return false;
  const id = new URLSearchParams(search).get("id") ?? stateId;
  return id === held.id || (app === "books" && page === "listen");
}

/** Video plays in a hidden element under the mini layout; for Picture in picture or Full screen it is shown for as long as the browser holds it. */
async function withVideoShown(el: HTMLMediaElement, enter: () => Promise<unknown>, leaveEvent: "leavepictureinpicture" | "fullscreenchange") {
  const before = el.style.display;
  el.style.display = "";
  const restore = () => {
    if (leaveEvent === "fullscreenchange" && document.fullscreenElement) return;
    el.style.display = before;
    el.removeEventListener(leaveEvent, restore);
    if (leaveEvent === "fullscreenchange") document.removeEventListener("fullscreenchange", restore);
  };
  try {
    await enter();
    if (leaveEvent === "fullscreenchange") document.addEventListener("fullscreenchange", restore);
    else el.addEventListener(leaveEvent, restore);
  } catch {
    el.style.display = before;
  }
}

export function GlobalMiniPlayer() {
  const dock = useMediaDock();
  const held = dock.current;
  const { pathname, search, state } = useLocation();
  const navigate = useNavigate();
  const [stage, setStage] = useState(false);
  const variant = useVisualizerPref();
  const vizOn = useVisualizerEnabled();
  const isAudio = held?.kind === "audio";
  const palette = useArtPalette(isAudio ? held?.poster ?? null : null);
  const getAnalyser = useMediaAnalyser(held?.el ?? null, isAudio);
  const playing = useIsPlaying(held?.el ?? null);
  const { position, duration } = useMediaTime(held?.el ?? null);
  const closeStage = useCallback(() => setStage(false), []);
  const stateId = (state as { pageState?: { id?: string } } | null)?.pageState?.id;
  if (!held || !held.started || onPlayPageOf(held, pathname, search, stateId)) return null;

  const CloseIcon = getIcon("x"), PipIcon = getIcon("picture-in-picture"), FullIcon = getIcon("maximize");
  const el = held.el;
  const pictureInPicture = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled && el instanceof HTMLVideoElement;
  // News Listen (NEWS-04) holds a story being read aloud: expanding opens the story, and its place is not a media position to save.
  const listenStory = storyIdOfListen(held.appId, held.id);
  const listening = listenStory !== null;
  const openPlayPage = () => navigate(listening ? `/apps/news/story?id=${encodeURIComponent(listenStory!)}` : `/apps/${held.appId}/${playPageOf(held.appId)}?id=${encodeURIComponent(held.id)}`, listening ? undefined : { state: { pageState: { id: held.id } } });

  return (
    <div data-slot="global-mini-player" data-testid="global-mini-player" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 md:start-14 print:hidden">
      <div className="pointer-events-auto relative">
        <Player
          key={held.id}
          media={el}
          src={held.src}
          kind={held.kind}
          layout="mini"
          placement="dock"
          title={held.title}
          subtitle={held.subtitle}
          poster={held.poster}
          mediaSession={false}
          onExpand={openPlayPage}
          {...(held.appId === "music" ? { onNext: () => { void dock.next(); } } : {})}
          onProgress={listening ? undefined : (p) => {
            api.mediaProgress(held.appId, { media_id: held.id, position_s: p.position_s, duration_s: p.duration_s, reason: p.reason }, p.reason === "unload").catch(() => {});
          }}
          actionsSlot={
            <>
              {duration > 0 ? (
                <span className="flex items-center gap-2 pe-2 text-base tabular-nums text-muted-foreground" data-testid="mini-time">
                  <span>{clock(position)}</span>
                  <div className="w-28 lg:w-40">
                    <Slider aria-label="Seek" min={0} max={duration} step={1} value={[Math.min(position, duration)]} onValueChange={(value) => { const next = Array.isArray(value) ? value[0] : value; if (typeof next === "number") el.currentTime = next; }} />
                  </div>
                  <span>{clock(duration)}</span>
                </span>
              ) : null}
              {isAudio ? <VisualizerMenu /> : null}
              {isAudio ? <SleepMenu /> : null}
              {isAudio ? <Button variant="ghost" size="icon" aria-label="Full screen visualizer" onClick={() => setStage(true)}><FullIcon aria-hidden="true" /></Button> : null}
              {pictureInPicture ? <Button variant="ghost" size="icon" aria-label="Picture in picture" onClick={() => void withVideoShown(el, () => (el as HTMLVideoElement).requestPictureInPicture(), "leavepictureinpicture")}><PipIcon aria-hidden="true" /></Button> : null}
              {held.kind === "video" ? <Button variant="ghost" size="icon" aria-label="Full screen" onClick={() => void withVideoShown(el, () => el.requestFullscreen(), "fullscreenchange")}><FullIcon aria-hidden="true" /></Button> : null}
              <Button variant="ghost" size="icon" aria-label={`Close the player: ${held.title}`} onClick={dock.clear}><CloseIcon aria-hidden="true" /></Button>
            </>
          }
        />
        {isAudio ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-40 opacity-15 dark:opacity-20" style={{ background: `linear-gradient(90deg, ${palette.corners[0]}, ${palette.corners[1]} 35%, transparent 60%, ${palette.corners[3]})` }} /> : null}
        {isAudio && vizOn ? <AudioVisualizer variant={variant} mode="strip" getAnalyser={getAnalyser} palette={palette} active={playing} opacity={0.6} fade className="pointer-events-none absolute inset-0 z-40 size-full" /> : null}
      </div>
      {stage ? <NowPlayingStage media={held} onClose={closeStage} /> : null}
    </div>
  );
}
